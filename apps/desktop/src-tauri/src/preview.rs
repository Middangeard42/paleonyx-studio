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
    spawn_server(listener, root.clone(), Arc::clone(&shutdown));

    *running = Some(RunningPreview {
        port,
        root,
        shutdown,
    });
    Ok(PreviewInfo { port })
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
fn spawn_server(listener: TcpListener, root: PathBuf, shutdown: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        while !shutdown.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let root = root.clone();
                    std::thread::spawn(move || {
                        // A failed connection is that client's problem;
                        // the server keeps serving.
                        let _ = handle_connection(stream, &root);
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

fn handle_connection(mut stream: TcpStream, root: &Path) -> std::io::Result<()> {
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

    let body = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(_) => return respond_status(&mut stream, 404, "Not Found"),
    };

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
fn read_request_line(stream: &TcpStream) -> Option<String> {
    let clone = stream.try_clone().ok()?;
    let mut reader = BufReader::new(clone.take(MAX_REQUEST_BYTES));
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

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("paleonyx-preview-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Starts a server over a real socket and returns its port, so the
    /// tests exercise the same accept/parse/serve path a browser hits
    /// rather than a stubbed version of it.
    fn serve(root: &Path) -> u16 {
        let listener =
            TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))).unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        spawn_server(listener, root.to_path_buf(), Arc::new(AtomicBool::new(false)));
        port
    }

    fn request(port: u16, raw: &str) -> String {
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
