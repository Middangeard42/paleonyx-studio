use serde::Serialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::commands::{resolve_within_root, ProjectState};

/// Serves the opened project so it can be previewed inside the app.
///
/// Written on `std::net` rather than pulling in a web framework: the
/// whole surface is GET, on loopback, for files the user already owns.
/// A framework would be a large dependency for a request parser that
/// fits on a screen.
///
/// The security properties that matter are few and explicit:
/// - bound to 127.0.0.1, never a routable address, so nothing off this
///   machine can reach it;
/// - GET and HEAD only, so it can never be asked to change anything;
/// - every path resolved through `resolve_within_root`, the same guard
///   the read and write commands use, so a request cannot walk out of
///   the project the user opened.
#[derive(Default)]
pub struct PreviewState {
    running: Mutex<Option<RunningPreview>>,
    /// Whether served pages get the selection script appended.
    ///
    /// Shared with the running server rather than read from `running`,
    /// because it is toggled while the server is already accepting and
    /// the handler threads need to see the change without a restart.
    design_mode: Arc<AtomicBool>,
}

struct RunningPreview {
    port: u16,
    root: PathBuf,
    shutdown: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInfo {
    pub port: u16,
}

/// How long a client may dawdle before we stop holding a thread for it.
const CLIENT_TIMEOUT: Duration = Duration::from_secs(10);

/// Cap on the request line plus headers. A preview client is our own
/// webview asking for files; anything larger is a bug or an abuse, and
/// either way is not worth buffering.
const MAX_REQUEST_BYTES: u64 = 8 * 1024;

#[tauri::command]
pub fn start_preview(
    project: tauri::State<ProjectState>,
    preview: tauri::State<PreviewState>,
) -> Result<PreviewInfo, String> {
    let root = {
        let guard = project.root.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "No project is open.".to_string())?
    };

    let mut running = preview.running.lock().map_err(|e| e.to_string())?;

    // Already serving this project: hand back the same port rather than
    // starting a second server. Opening the panel twice is ordinary.
    if let Some(current) = running.as_ref() {
        if current.root == root {
            return Ok(PreviewInfo { port: current.port });
        }
        // A different project is open now, so the old server is serving
        // the wrong thing and must go.
        current.shutdown.store(true, Ordering::SeqCst);
    }

    // Port 0 asks the OS for a free one. Binding to LOCALHOST rather
    // than UNSPECIFIED is the difference between "reachable from this
    // machine" and "reachable from the network".
    let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))
        .map_err(|e| format!("Could not start the preview server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Could not read the preview server's port: {e}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Could not configure the preview server: {e}"))?;

    let shutdown = Arc::new(AtomicBool::new(false));
    spawn_server(
        listener,
        root.clone(),
        Arc::clone(&shutdown),
        Arc::clone(&preview.design_mode),
    );

    *running = Some(RunningPreview {
        port,
        root,
        shutdown,
    });
    Ok(PreviewInfo { port })
}

/// Turns the selection script on or off for pages served from here.
///
/// Its own command rather than a query parameter on the page URL: the
/// previewed page must not be able to turn instrumentation on for
/// itself, and a flag the app owns cannot be reached from page content.
#[tauri::command]
pub fn set_design_mode(enabled: bool, preview: tauri::State<PreviewState>) -> Result<(), String> {
    preview.design_mode.store(enabled, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn stop_preview(preview: tauri::State<PreviewState>) -> Result<(), String> {
    let mut running = preview.running.lock().map_err(|e| e.to_string())?;
    if let Some(current) = running.take() {
        current.shutdown.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// The accept loop. Non-blocking with a short sleep rather than a
/// blocking accept, so shutdown is a flag check rather than needing a
/// self-connection to wake the thread up.
fn spawn_server(
    listener: TcpListener,
    root: PathBuf,
    shutdown: Arc<AtomicBool>,
    design_mode: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        while !shutdown.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let root = root.clone();
                    let design_mode = Arc::clone(&design_mode);
                    std::thread::spawn(move || {
                        // A failed connection is that client's problem;
                        // the server keeps serving.
                        let _ = handle_connection(stream, &root, &design_mode);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => break,
            }
        }
    });
}

fn handle_connection(
    mut stream: TcpStream,
    root: &Path,
    design_mode: &AtomicBool,
) -> std::io::Result<()> {
    // On Windows an accepted socket inherits the listener's non-blocking
    // mode, and a non-blocking read ignores the timeout below: a request
    // not yet arrived read as none at all, and the client was sent a 400
    // or a reset. Blocking, with a timeout, is what this code was written
    // for.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(CLIENT_TIMEOUT))?;
    stream.set_write_timeout(Some(CLIENT_TIMEOUT))?;

    let request_line = match read_request_line(&stream) {
        Some(line) => line,
        None => return respond_status(&mut stream, 400, "Bad Request"),
    };

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    // Read-only by construction. Nothing here can mutate the project, so
    // the preview can never become a second write path.
    if method != "GET" && method != "HEAD" {
        return respond_status(&mut stream, 405, "Method Not Allowed");
    }

    let relative = match request_target_to_path(target) {
        Some(path) => path,
        None => return respond_status(&mut stream, 400, "Bad Request"),
    };

    // The same confinement the file commands use. A request for
    // /../../secrets resolves outside the root and is refused here.
    let resolved = match resolve_within_root(root, &relative) {
        Ok(path) => path,
        Err(_) => return respond_status(&mut stream, 403, "Forbidden"),
    };

    let file = if resolved.is_dir() {
        resolved.join("index.html")
    } else {
        resolved
    };

    let mut body = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(_) => return respond_status(&mut stream, 404, "Not Found"),
    };

    // Design mode needs a listener inside the frame, and the app cannot
    // put one there: the preview is sandboxed without `allow-same-origin`
    // exactly so previewed code cannot reach back into Paleonyx, which
    // also means Paleonyx cannot reach into it. Appending the script as
    // the page is served is the only way in, and it happens only while
    // the mode is on and only for HTML.
    let is_html = matches!(content_type(&file), "text/html; charset=utf-8");
    if is_html && design_mode.load(Ordering::SeqCst) {
        body = inject_selection_script(body);
    }

    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        content_type(&file),
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    // HEAD gets the headers and nothing else, which is what makes it a
    // cheap liveness check for the panel.
    if method == "GET" {
        stream.write_all(&body)?;
    }
    stream.flush()
}

/// Reads the request line, refusing anything oversized rather than
/// buffering it. The remaining headers are ignored: nothing this server
/// does depends on them.
///
/// Reads through a shared reference rather than `try_clone`. On Windows a
/// cloned socket comes back inheritable, so any process the app started
/// meanwhile — a test run, an MCP server — kept the connection open for
/// as long as it lived, and reset it when it ended.
fn read_request_line(stream: &TcpStream) -> Option<String> {
    let mut reader = BufReader::new(Read::take(stream, MAX_REQUEST_BYTES));
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).ok()? == 0 {
        return None;
    }
    Some(request_line.trim_end().to_string())
}

/// Turns a request target into a project-relative path.
///
/// Strips the query and fragment, decodes percent escapes, and rejects
/// a NUL or a non-absolute target. Traversal is deliberately not handled
/// here — `resolve_within_root` is the single place that decides what is
/// inside the project, and a second implementation of that judgement
/// would be free to disagree with the first.
fn request_target_to_path(target: &str) -> Option<String> {
    if !target.starts_with('/') {
        return None;
    }
    let without_query = target.split(['?', '#']).next().unwrap_or("");
    let decoded = percent_decode(without_query)?;
    if decoded.contains('\0') {
        return None;
    }
    Some(decoded.trim_start_matches('/').to_string())
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = value.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// The script appended to served HTML while design mode is on.
///
/// It reports and highlights; it never changes the page's own content.
/// Clicks select instead of activating, because a link that navigates
/// takes the user away from the thing they were pointing at.
const SELECTION_SCRIPT: &str = r#"<script data-paleonyx="selection">
(function () {
  var HL = "paleonyx-design-highlight";
  var style = document.createElement("style");
  style.setAttribute("data-paleonyx", "selection");
  style.textContent = "." + HL + "{outline:2px solid #c9803f !important;outline-offset:2px !important;}";
  (document.head || document.documentElement).appendChild(style);

  function classesOf(el) {
    var raw = el.getAttribute("class") || "";
    return raw.trim().split(/\s+/).filter(function (c) {
      return c && c !== HL;
    });
  }

  // Ancestor chain, outermost first. Capped: past a few levels it stops
  // helping tell two elements apart and starts filling the prompt.
  function pathOf(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var name = node.tagName.toLowerCase();
      var first = classesOf(node)[0];
      parts.unshift(first ? name + "." + first : name);
      node = node.parentElement;
    }
    return parts;
  }

  var current = null;
  document.addEventListener(
    "click",
    function (ev) {
      var target = ev.target;
      if (!target || target.nodeType !== 1) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (current) current.classList.remove(HL);
      current = target;
      target.classList.add(HL);
      var rect = target.getBoundingClientRect();
      parent.postMessage(
        {
          source: "paleonyx-preview",
          kind: "select",
          tag: target.tagName,
          id: target.id || null,
          classes: classesOf(target),
          text: (target.textContent || "").trim().slice(0, 120),
          path: pathOf(target),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        },
        "*"
      );
    },
    true
  );

  parent.postMessage({ source: "paleonyx-preview", kind: "ready" }, "*");
})();
</script>"#;

/// Appends the selection script to a served page.
///
/// Before `</body>` when there is one so the script runs after the
/// document it inspects, and at the end otherwise — a fragment without
/// a body tag is still a page a browser will render.
fn inject_selection_script(body: Vec<u8>) -> Vec<u8> {
    let html = match String::from_utf8(body) {
        Ok(html) => html,
        // Not decodable as UTF-8, so not something to splice a script
        // into. The error hands the bytes back, so it is served exactly
        // as it was found rather than corrupted or dropped.
        Err(original) => return original.into_bytes(),
    };

    let injected = match find_last_ignoring_case(&html, "</body>") {
        Some(at) => format!("{}{}{}", &html[..at], SELECTION_SCRIPT, &html[at..]),
        None => format!("{html}{SELECTION_SCRIPT}"),
    };
    injected.into_bytes()
}

fn find_last_ignoring_case(haystack: &str, needle: &str) -> Option<usize> {
    haystack.to_ascii_lowercase().rfind(needle)
}

fn respond_status(stream: &mut TcpStream, code: u16, reason: &str) -> std::io::Result<()> {
    let body = format!("{code} {reason}");
    let response = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) use crate::test_support::ScratchDir;

    pub(super) fn unique_dir(tag: &str) -> ScratchDir {
        ScratchDir::new(&format!("paleonyx-preview-{tag}"))
    }

    /// Starts a server over a real socket and returns its port, so the
    /// tests exercise the same accept/parse/serve path a browser hits
    /// rather than a stubbed version of it.
    pub(super) fn serve(root: &Path) -> u16 {
        serve_with_design(root, false)
    }

    pub(super) fn serve_with_design(root: &Path, design: bool) -> u16 {
        let listener =
            TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))).unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        spawn_server(
            listener,
            root.to_path_buf(),
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(design)),
        );
        port
    }

    pub(super) fn request(port: u16, raw: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.write_all(raw.as_bytes()).unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        String::from_utf8_lossy(&response).to_string()
    }

    #[test]
    fn serves_a_file_from_the_project() {
        let root = unique_dir("serve");
        std::fs::write(root.join("index.html"), "<h1>hello</h1>").unwrap();
        let port = serve(&root);

        let response = request(port, "GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        assert!(response.contains("text/html"), "{response}");
        assert!(response.contains("<h1>hello</h1>"), "{response}");
    }

    /// A browser does not always send its request the instant it
    /// connects — least of all on a machine busy running a model. The
    /// server has to wait for it, not answer whatever it finds at once.
    #[test]
    fn waits_for_a_request_that_arrives_late() {
        let root = unique_dir("late");
        std::fs::write(root.join("index.html"), "<p>late</p>").unwrap();
        let port = serve(&root);

        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        stream
            .write_all(b"GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n")
            .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        let response = String::from_utf8_lossy(&response);
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
    }

    /// A process the app starts must not walk off with a copy of a
    /// preview connection. When one did, the page waited for the
    /// connection to close until that process ended — and was reset if
    /// it was killed.
    ///
    /// Deterministic: half a request line holds the server inside its
    /// read, which is where the copy used to exist, and the process is
    /// started right then.
    #[cfg(windows)]
    #[test]
    fn a_process_started_mid_request_does_not_hold_the_connection() {
        use std::process::{Command, Stdio};
        use std::time::Instant;

        let root = unique_dir("inherit");
        std::fs::write(root.join("index.html"), "<p>ok</p>").unwrap();
        let port = serve(&root);

        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.write_all(b"GET /index.html HT").unwrap();
        std::thread::sleep(Duration::from_millis(300));

        // Lives about five seconds unless killed, and is killed below.
        let mut bystander = Command::new("ping")
            .args(["-n", "6", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        let started = Instant::now();
        stream.write_all(b"TP/1.1\r\nHost: x\r\n\r\n").unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut response = Vec::new();
        let read = stream.read_to_end(&mut response);
        let took = started.elapsed();
        let _ = bystander.kill();
        let _ = bystander.wait();

        read.unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200 OK"));
        assert!(
            took < Duration::from_secs(2),
            "the response took {took:?} to end, so the other process held the connection"
        );
    }

    #[test]
    fn serves_index_html_for_the_root_path() {
        let root = unique_dir("root");
        std::fs::write(root.join("index.html"), "<h1>root</h1>").unwrap();
        let port = serve(&root);

        let response = request(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(response.contains("<h1>root</h1>"), "{response}");
    }

    /// The property that matters most here. A preview server that can be
    /// walked out of turns "show me my project" into "read any file this
    /// user can read".
    #[test]
    fn refuses_to_walk_out_of_the_project() {
        let parent = unique_dir("escape");
        let root = parent.join("project");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(parent.join("secret.txt"), "TOP SECRET").unwrap();
        std::fs::write(root.join("index.html"), "<h1>ok</h1>").unwrap();
        let port = serve(&root);

        for target in [
            "/../secret.txt",
            "/%2e%2e/secret.txt",
            "/subdir/../../secret.txt",
        ] {
            let response = request(port, &format!("GET {target} HTTP/1.1\r\nHost: x\r\n\r\n"));
            assert!(
                !response.contains("TOP SECRET"),
                "{target} leaked the file: {response}"
            );
        }
    }

    #[test]
    fn missing_files_are_not_found() {
        let root = unique_dir("missing");
        let port = serve(&root);
        let response = request(port, "GET /nope.html HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 404"), "{response}");
    }

    /// Read-only by construction: a preview must never become a second
    /// way to change the project.
    #[test]
    fn refuses_anything_that_is_not_a_read() {
        let root = unique_dir("methods");
        std::fs::write(root.join("index.html"), "<h1>hi</h1>").unwrap();
        let port = serve(&root);

        for method in ["POST", "PUT", "DELETE", "PATCH"] {
            let response = request(
                port,
                &format!("{method} /index.html HTTP/1.1\r\nHost: x\r\n\r\n"),
            );
            assert!(
                response.starts_with("HTTP/1.1 405"),
                "{method} was not refused: {response}"
            );
        }
    }

    #[test]
    fn head_returns_headers_without_the_body() {
        let root = unique_dir("head");
        std::fs::write(root.join("index.html"), "<h1>body text</h1>").unwrap();
        let port = serve(&root);

        let response = request(port, "HEAD /index.html HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        assert!(!response.contains("body text"), "{response}");
    }

    #[test]
    fn ignores_the_query_string_when_resolving() {
        let root = unique_dir("query");
        std::fs::write(root.join("app.js"), "console.log(1)").unwrap();
        let port = serve(&root);

        // Cache-busting suffixes are ordinary; treating them as part of
        // the filename would 404 every reload.
        let response = request(port, "GET /app.js?v=123 HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        assert!(response.contains("text/javascript"), "{response}");
    }

    #[test]
    fn decodes_percent_escapes_in_names() {
        let root = unique_dir("escapes");
        std::fs::write(root.join("my page.html"), "<h1>spaced</h1>").unwrap();
        let port = serve(&root);

        let response = request(port, "GET /my%20page.html HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(response.contains("<h1>spaced</h1>"), "{response}");
    }

    #[test]
    fn rejects_a_target_that_is_not_a_path() {
        assert_eq!(request_target_to_path("index.html"), None);
        assert_eq!(request_target_to_path("http://elsewhere/"), None);
        assert_eq!(request_target_to_path("/ok.html"), Some("ok.html".into()));
        assert_eq!(request_target_to_path("/a.js?v=1#x"), Some("a.js".into()));
        // A NUL byte truncates paths in some syscalls; refuse rather
        // than hand it to the filesystem.
        assert_eq!(request_target_to_path("/a%00.js"), None);
    }

    #[test]
    fn responses_are_not_cached() {
        let root = unique_dir("cache");
        std::fs::write(root.join("index.html"), "<h1>v1</h1>").unwrap();
        let port = serve(&root);

        // The panel reloads to show edits; a cached response would show
        // the previous version and look like the change did not apply.
        let response = request(port, "GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(response.contains("Cache-Control: no-store"), "{response}");
    }
}

#[cfg(test)]
mod design_mode_tests {
    use super::tests::{request, serve_with_design, unique_dir};
    use super::*;

    /// Pulls the body out of a raw HTTP response, and the declared
    /// length, so the two can be compared.
    fn split_response(response: &str) -> (usize, &str) {
        let (head, body) = response.split_once("\r\n\r\n").expect("no header break");
        let declared = head
            .lines()
            .find_map(|line| line.strip_prefix("Content-Length: "))
            .expect("no Content-Length")
            .trim()
            .parse()
            .expect("unparseable Content-Length");
        (declared, body)
    }

    #[test]
    fn leaves_pages_alone_when_design_mode_is_off() {
        let root = unique_dir("design-off");
        std::fs::write(root.join("index.html"), "<body><h1>hi</h1></body>").unwrap();
        let port = serve_with_design(&root, false);

        let response = request(port, "GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(!response.contains("paleonyx-preview"), "{response}");
    }

    #[test]
    fn injects_the_selection_script_when_design_mode_is_on() {
        let root = unique_dir("design-on");
        std::fs::write(root.join("index.html"), "<body><h1>hi</h1></body>").unwrap();
        let port = serve_with_design(&root, true);

        let response = request(port, "GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(response.contains("paleonyx-preview"), "{response}");
        // Before the closing tag, so it runs against a built document.
        let script_at = response.find("data-paleonyx").expect("script missing");
        let body_end = response.rfind("</body>").expect("body end missing");
        assert!(script_at < body_end, "script landed after </body>");
    }

    /// A mismatch here truncates the page in the browser, which looks
    /// like the project is broken rather than like we miscounted.
    #[test]
    fn content_length_matches_the_injected_body() {
        let root = unique_dir("design-length");
        std::fs::write(root.join("index.html"), "<body><h1>hi</h1></body>").unwrap();
        let port = serve_with_design(&root, true);

        let response = request(port, "GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n");
        let (declared, body) = split_response(&response);
        assert_eq!(
            declared,
            body.len(),
            "declared {declared}, actual {}",
            body.len()
        );
    }

    #[test]
    fn appends_when_the_page_has_no_body_tag() {
        let root = unique_dir("design-nobody");
        std::fs::write(root.join("index.html"), "<h1>fragment</h1>").unwrap();
        let port = serve_with_design(&root, true);

        let response = request(port, "GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(response.contains("paleonyx-preview"), "{response}");
        let (declared, body) = split_response(&response);
        assert_eq!(declared, body.len());
    }

    /// Injecting into a script or stylesheet would corrupt it — the
    /// page would fail to load the very file it needs.
    #[test]
    fn never_injects_into_anything_that_is_not_html() {
        let root = unique_dir("design-assets");
        std::fs::write(root.join("app.js"), "console.log('hi')").unwrap();
        std::fs::write(root.join("style.css"), "body{color:red}").unwrap();
        std::fs::write(root.join("data.json"), "{\"a\":1}").unwrap();
        let port = serve_with_design(&root, true);

        for name in ["app.js", "style.css", "data.json"] {
            let response = request(port, &format!("GET /{name} HTTP/1.1\r\nHost: x\r\n\r\n"));
            assert!(
                !response.contains("paleonyx-preview"),
                "{name} was instrumented: {response}"
            );
        }
    }

    #[test]
    fn matches_a_closing_body_tag_in_any_case() {
        let root = unique_dir("design-case");
        std::fs::write(root.join("index.html"), "<BODY><h1>hi</h1></BODY>").unwrap();
        let port = serve_with_design(&root, true);

        let response = request(port, "GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n");
        let script_at = response.find("data-paleonyx").expect("script missing");
        let body_end = response.rfind("</BODY>").expect("body end missing");
        assert!(script_at < body_end, "script landed after </BODY>");
    }

    /// A file that is not valid UTF-8 must come back exactly as found.
    /// Returning nothing would serve an empty page and look like a
    /// missing file rather than a skipped injection.
    #[test]
    fn returns_undecodable_bodies_untouched() {
        let original = vec![0xff, 0xfe, 0x00, 0x41];
        assert_eq!(inject_selection_script(original.clone()), original);
    }
}
