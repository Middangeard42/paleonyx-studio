//! Runs MCP servers: local programs that speak JSON-RPC, one message per
//! line, over their standard streams.
//!
//! Mechanism only. Which servers may start, and which of their tools the
//! agent may use, is decided in TypeScript (`@paleonyx/mcp-client` and
//! agent-core) against what the user approved — the same split as
//! `run_command` and the allowlist (CLAUDE.md §6). This module starts a
//! program without a shell, passes lines back and forth, and makes sure
//! the program is gone when asked, or when the app is.

use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

use crate::commands::ProjectState;
use crate::process::{prepare_child, resolve_program, ProcessGroup};

/// A message larger than this is dropped whole rather than buffered
/// without limit.
const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
/// How much of a server's error stream is kept to explain a failure.
const LOG_LINES: usize = 40;
const MAX_LOG_LINE_CHARS: usize = 500;
/// How long a server gets to exit once its input is closed.
const STOP_GRACE: Duration = Duration::from_secs(3);
const POLL: Duration = Duration::from_millis(50);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum McpEvent {
    /// One line the server wrote to its output.
    Message { line: String },
    /// A line too large to pass on; only its size is reported.
    Oversized { bytes: usize },
    /// The server has exited. Always the last event.
    #[serde(rename_all = "camelCase")]
    Closed { exit_code: Option<i32>, log: String },
}

type Sink = Arc<dyn Fn(McpEvent) + Send + Sync>;

struct Server {
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    stop: Arc<AtomicBool>,
    /// Shared with the thread supervising the server, so that the app can
    /// end the whole tree as it exits without waiting for that thread.
    group: Arc<ProcessGroup>,
}

impl Server {
    /// Closes the server's input, which is how MCP asks a server to stop,
    /// and starts the grace period after which it is ended regardless.
    fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        // A write blocked on a server that stopped reading holds this
        // lock. Then the pipe stays open, and the grace period ends it.
        if let Ok(mut stdin) = self.stdin.try_lock() {
            stdin.take();
        }
    }
}

#[derive(Default)]
pub struct McpState {
    next_id: AtomicU64,
    servers: Arc<Mutex<HashMap<u64, Server>>>,
}

impl McpState {
    /// Asks every server to stop. Used when a project closes and when the
    /// app exits; on Windows, exiting also ends them through their jobs.
    pub fn stop_all(&self) {
        if let Ok(servers) = self.servers.lock() {
            for server in servers.values() {
                server.request_stop();
            }
        }
    }

    /// What the app does as it exits: asks every server to stop, gives them
    /// `wait` to do it, and ends whatever is left, with everything each one
    /// started.
    ///
    /// Asking is not enough on its own. The app exits right after, taking
    /// the threads that would have ended a server once its grace period ran
    /// out. On Windows the job objects end the servers anyway; elsewhere
    /// nothing else would, and a server that ignores the request (or one
    /// started through `npx`, whose child keeps running) outlived the app.
    pub fn shutdown(&self, wait: Duration) {
        self.stop_all();
        let deadline = Instant::now() + wait;
        while Instant::now() < deadline {
            if self.servers.lock().map(|s| s.is_empty()).unwrap_or(true) {
                return;
            }
            std::thread::sleep(POLL);
        }
        if let Ok(servers) = self.servers.lock() {
            for server in servers.values() {
                server.group.kill();
            }
        }
    }

    fn start(
        &self,
        program: &str,
        args: &[String],
        env: &HashMap<String, String>,
        project: &Path,
        grace: Duration,
        sink: Sink,
    ) -> Result<u64, String> {
        let resolved = resolve_program(program, project)?;
        let mut command = Command::new(&resolved);
        command
            .args(args)
            .envs(env)
            .current_dir(project)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        prepare_child(&mut command);

        let mut child = command
            .spawn()
            .map_err(|e| format!("Could not start \"{program}\": {e}"))?;
        let group = match ProcessGroup::adopt(&child) {
            Ok(group) => group,
            Err(error) => {
                // Untracked, it could outlive the app. Better not to run it.
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };

        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            group.kill();
            let _ = child.wait();
            return Err("Could not connect to the server's input and output.".into());
        };

        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let stop = Arc::new(AtomicBool::new(false));
        let group = Arc::new(group);
        self.servers.lock().map_err(|e| e.to_string())?.insert(
            id,
            Server {
                stdin: Arc::new(Mutex::new(Some(stdin))),
                stop: stop.clone(),
                group: group.clone(),
            },
        );

        let messages = {
            let sink = sink.clone();
            std::thread::spawn(move || relay_messages(stdout, &*sink))
        };
        let log = std::thread::spawn(move || collect_log(stderr));
        let servers = self.servers.clone();
        std::thread::spawn(move || {
            let exit_code = supervise(&mut child, &group, &stop, grace);
            // Anything the server started goes too, so the output pipe
            // closes and nothing is left running once the app forgets it.
            group.kill();
            let _ = messages.join();
            let log = log.join().map(Vec::from).unwrap_or_default().join("\n");
            if let Ok(mut servers) = servers.lock() {
                servers.remove(&id);
            }
            sink(McpEvent::Closed { exit_code, log });
        });

        Ok(id)
    }

    fn send(&self, id: u64, line: &str) -> Result<(), String> {
        // Framing is one message per line; a line break inside one would
        // split it into two things the server cannot read.
        if line.contains('\n') || line.contains('\r') {
            return Err("A message to a server can't contain a line break.".into());
        }
        let stdin = {
            let servers = self.servers.lock().map_err(|e| e.to_string())?;
            servers
                .get(&id)
                .map(|server| server.stdin.clone())
                .ok_or("That server is not running.")?
        };
        let mut stdin = stdin.lock().map_err(|e| e.to_string())?;
        let pipe = stdin.as_mut().ok_or("That server is stopping.")?;
        let mut framed = Vec::with_capacity(line.len() + 1);
        framed.extend_from_slice(line.as_bytes());
        framed.push(b'\n');
        pipe.write_all(&framed)
            .and_then(|()| pipe.flush())
            .map_err(|e| format!("Could not write to the server: {e}"))
    }

    fn stop(&self, id: u64) {
        if let Ok(servers) = self.servers.lock() {
            if let Some(server) = servers.get(&id) {
                server.request_stop();
            }
        }
    }
}

/// Waits for the server to exit, ending it once a requested stop has had
/// its grace period.
fn supervise(
    child: &mut Child,
    group: &ProcessGroup,
    stop: &AtomicBool,
    grace: Duration,
) -> Option<i32> {
    let mut stop_requested: Option<Instant> = None;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) => {}
            Err(_) => {
                group.kill();
                let _ = child.kill();
                return child.wait().ok().and_then(|status| status.code());
            }
        }
        if stop.load(Ordering::SeqCst) {
            let since = *stop_requested.get_or_insert_with(Instant::now);
            if since.elapsed() >= grace {
                group.kill();
                let _ = child.kill();
                return child.wait().ok().and_then(|status| status.code());
            }
        }
        std::thread::sleep(POLL);
    }
}

enum Line<'a> {
    Complete(&'a [u8]),
    TooLong(usize),
}

/// Splits a stream into lines without ever holding more than `max` bytes
/// of one. A final line with no line ending is still delivered.
fn for_each_line(source: impl Read, max: usize, mut on_line: impl FnMut(Line)) {
    let mut reader = BufReader::new(source);
    let mut line: Vec<u8> = Vec::new();
    let mut dropped = 0usize;
    loop {
        let chunk = match reader.fill_buf() {
            Ok(chunk) if !chunk.is_empty() => chunk,
            // End of stream, or a broken pipe: either way nothing more
            // will arrive, and the supervisor reports how it ended.
            _ => break,
        };
        let (taken, ends_line) = match chunk.iter().position(|&byte| byte == b'\n') {
            Some(index) => (index + 1, true),
            None => (chunk.len(), false),
        };
        let piece = &chunk[..taken];
        if dropped > 0 || line.len() + piece.len() > max + 1 {
            dropped += line.len() + piece.len();
            line.clear();
        } else {
            line.extend_from_slice(piece);
        }
        reader.consume(taken);

        if ends_line {
            if dropped > 0 {
                on_line(Line::TooLong(dropped));
                dropped = 0;
            } else {
                on_line(Line::Complete(&line));
            }
            line.clear();
        }
    }
    if dropped > 0 {
        on_line(Line::TooLong(dropped));
    } else if !line.is_empty() {
        on_line(Line::Complete(&line));
    }
}

fn relay_messages(stdout: impl Read, sink: &(dyn Fn(McpEvent) + Send + Sync)) {
    for_each_line(stdout, MAX_MESSAGE_BYTES, |line| match line {
        Line::Complete(bytes) => {
            let text = String::from_utf8_lossy(bytes);
            let text = text.trim_end_matches(['\n', '\r']);
            // Blank lines carry nothing; passing them on would only be noise.
            if !text.trim().is_empty() {
                sink(McpEvent::Message {
                    line: text.to_string(),
                });
            }
        }
        Line::TooLong(bytes) => sink(McpEvent::Oversized { bytes }),
    });
}

/// The last lines of the server's error stream, which is where servers
/// explain why they would not start.
fn collect_log(stderr: impl Read) -> VecDeque<String> {
    let mut lines = VecDeque::with_capacity(LOG_LINES);
    for_each_line(stderr, 64 * 1024, |line| {
        let text = match line {
            Line::Complete(bytes) => {
                let text = String::from_utf8_lossy(bytes);
                let text = text.trim_end();
                if text.chars().count() > MAX_LOG_LINE_CHARS {
                    format!(
                        "{}…",
                        text.chars().take(MAX_LOG_LINE_CHARS).collect::<String>()
                    )
                } else {
                    text.to_string()
                }
            }
            Line::TooLong(bytes) => format!("(a {bytes}-byte line was left out)"),
        };
        if lines.len() == LOG_LINES {
            lines.pop_front();
        }
        lines.push_back(text);
    });
    lines
}

fn project_root(project: &ProjectState) -> Result<std::path::PathBuf, String> {
    let guard = project.root.lock().map_err(|e| e.to_string())?;
    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| "No project is open.".to_string())
}

/// Starts a server in the open project and returns its handle. Events —
/// its messages, then its exit — arrive on `events`.
///
/// Runs off the main thread (`async`): starting `npx` can take a moment,
/// and the window must not freeze while it does.
#[tauri::command(async)]
pub fn mcp_start(
    program: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    events: Channel<McpEvent>,
    project: tauri::State<'_, ProjectState>,
    state: tauri::State<'_, McpState>,
) -> Result<u64, String> {
    let root = project_root(&project)?;
    let sink: Sink = Arc::new(move |event| {
        // Fails only once the page that asked has gone away. The server is
        // still stopped — by the page's replacement, or at exit.
        let _ = events.send(event);
    });
    state.start(&program, &args, &env, &root, STOP_GRACE, sink)
}

#[tauri::command(async)]
pub fn mcp_send(id: u64, line: String, state: tauri::State<'_, McpState>) -> Result<(), String> {
    state.send(id, &line)
}

/// Asks a server to stop. Stopping one that has already gone is not an
/// error: the result the caller wanted is already true.
#[tauri::command(async)]
pub fn mcp_stop(id: u64, state: tauri::State<'_, McpState>) {
    state.stop(id);
}

/// Stops every server — for a page that has just loaded and cannot know
/// what an earlier copy of itself left running.
#[tauri::command(async)]
pub fn mcp_stop_all(state: tauri::State<'_, McpState>) {
    state.stop_all();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn lines_of(input: &[u8], max: usize) -> Vec<String> {
        let mut seen = Vec::new();
        for_each_line(input, max, |line| {
            seen.push(match line {
                Line::Complete(bytes) => format!("line:{}", String::from_utf8_lossy(bytes)),
                Line::TooLong(bytes) => format!("too long:{bytes}"),
            })
        });
        seen
    }

    #[test]
    fn splits_on_line_endings_and_keeps_an_unterminated_last_line() {
        assert_eq!(
            lines_of(b"one\ntwo\r\nthree", 100),
            vec!["line:one\n", "line:two\r\n", "line:three"]
        );
    }

    #[test]
    fn drops_a_line_that_is_too_long_and_carries_on() {
        let mut input = vec![b'x'; 50];
        input.extend_from_slice(b"\nok\n");
        assert_eq!(lines_of(&input, 10), vec!["too long:51", "line:ok\n"]);
    }

    #[test]
    fn a_line_exactly_at_the_limit_is_kept() {
        assert_eq!(lines_of(b"0123456789\n", 10), vec!["line:0123456789\n"]);
    }

    #[test]
    fn relays_messages_without_their_line_endings_or_blank_lines() {
        let seen = Mutex::new(Vec::new());
        relay_messages(
            &b"{\"a\":1}\r\n\n   \n{\"b\":2}\n"[..],
            &|event: McpEvent| seen.lock().unwrap().push(event),
        );
        assert_eq!(
            seen.into_inner().unwrap(),
            vec![
                McpEvent::Message {
                    line: "{\"a\":1}".into()
                },
                McpEvent::Message {
                    line: "{\"b\":2}".into()
                },
            ]
        );
    }

    #[test]
    fn keeps_only_the_end_of_a_long_log() {
        let text: String = (0..100).map(|i| format!("line {i}\n")).collect();
        let log = collect_log(text.as_bytes());
        assert_eq!(log.len(), LOG_LINES);
        assert_eq!(log.back().map(String::as_str), Some("line 99"));
    }

    /// Real processes from here on. Node is what these servers are most
    /// often written in, and the repository needs it anyway.
    ///
    /// Grandchildren in these tests are started `detached`. On Windows,
    /// Node already ends its ordinary children when it exits, so only a
    /// detached one — or a non-Node wrapper such as `cmd.exe` — shows
    /// whether the app itself ends the whole tree.
    fn project() -> std::path::PathBuf {
        std::env::temp_dir()
    }

    fn start(state: &McpState, script: &str, grace: Duration) -> (u64, mpsc::Receiver<McpEvent>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let sink: Sink = Arc::new(move |event| {
            let _ = tx.lock().unwrap().send(event);
        });
        let id = state
            .start(
                "node",
                &["-e".into(), script.into()],
                &HashMap::new(),
                &project(),
                grace,
                sink,
            )
            .expect("node should start");
        (id, rx)
    }

    fn closed(rx: &mpsc::Receiver<McpEvent>, within: Duration) -> (Option<i32>, String) {
        let deadline = Instant::now() + within;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(McpEvent::Closed { exit_code, log }) => return (exit_code, log),
                Ok(_) => continue,
                Err(_) => panic!("the server did not report closing within {within:?}"),
            }
        }
    }

    const ECHO: &str = "process.stdin.pipe(process.stdout)";

    #[test]
    fn passes_lines_both_ways_and_stops_when_its_input_closes() {
        let state = McpState::default();
        let (id, rx) = start(&state, ECHO, Duration::from_secs(10));
        state
            .send(id, "{\"jsonrpc\":\"2.0\",\"method\":\"ping\"}")
            .unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(10)).unwrap(),
            McpEvent::Message {
                line: "{\"jsonrpc\":\"2.0\",\"method\":\"ping\"}".into()
            }
        );

        let asked = Instant::now();
        state.stop(id);
        let (exit_code, _) = closed(&rx, Duration::from_secs(10));
        assert_eq!(exit_code, Some(0));
        // Exited on its own, well inside the grace period.
        assert!(asked.elapsed() < Duration::from_secs(8));
        assert!(
            state.send(id, "{}").is_err(),
            "a stopped server still accepted a message"
        );
    }

    #[test]
    fn ends_a_server_that_ignores_the_request_to_stop() {
        let state = McpState::default();
        let (id, rx) = start(
            &state,
            "setInterval(() => {}, 1000)",
            Duration::from_millis(300),
        );
        std::thread::sleep(Duration::from_millis(300));
        state.stop(id);
        closed(&rx, Duration::from_secs(10));
        assert!(state.servers.lock().unwrap().is_empty());
    }

    #[test]
    fn reports_how_a_server_that_gave_up_explained_itself() {
        let state = McpState::default();
        let (_, rx) = start(
            &state,
            "console.error('GITHUB_TOKEN is not set'); process.exit(3)",
            Duration::from_secs(10),
        );
        let (exit_code, log) = closed(&rx, Duration::from_secs(10));
        assert_eq!(exit_code, Some(3));
        assert!(log.contains("GITHUB_TOKEN is not set"), "{log}");
    }

    #[test]
    fn refuses_a_message_with_a_line_break() {
        let state = McpState::default();
        let (id, rx) = start(&state, ECHO, Duration::from_secs(10));
        assert!(state.send(id, "{}\n{}").is_err());
        assert!(state.send(id, "{}\r").is_err());
        state.stop(id);
        closed(&rx, Duration::from_secs(10));
    }

    #[test]
    fn reports_a_program_that_does_not_exist() {
        let state = McpState::default();
        let sink: Sink = Arc::new(|_| {});
        let error = state
            .start(
                "paleonyx-no-such-server",
                &[],
                &HashMap::new(),
                &project(),
                STOP_GRACE,
                sink,
            )
            .unwrap_err();
        assert!(error.contains("paleonyx-no-such-server"), "{error}");
    }

    /// A server started through `npx` is several processes deep. Stopping
    /// it must end all of them — here a grandchild holding the same output
    /// pipe, which would otherwise keep the close from ever being reported.
    #[cfg(windows)]
    #[test]
    fn stopping_a_server_ends_what_it_started() {
        let state = McpState::default();
        let script = "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit', detached: true }); setInterval(() => {}, 1000)";
        let (id, rx) = start(&state, script, Duration::from_millis(300));
        std::thread::sleep(Duration::from_millis(500));
        state.stop(id);
        closed(&rx, Duration::from_secs(10));
    }

    /// A server that exits on its own but leaves a child holding its
    /// output: the close must still be reported, or the app would show
    /// it as running forever.
    #[cfg(windows)]
    #[test]
    fn reports_a_server_that_exits_leaving_something_behind() {
        let state = McpState::default();
        let script = "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit', detached: true }); setTimeout(() => process.exit(0), 300)";
        let (_, rx) = start(&state, script, Duration::from_secs(10));
        let (exit_code, _) = closed(&rx, Duration::from_secs(8));
        assert_eq!(exit_code, Some(0));
    }

    /// The same two failures on Linux and macOS, with an ordinary
    /// grandchild: `detached` calls `setsid` on Unix, which leaves the
    /// process group the app can end.
    #[cfg(unix)]
    #[test]
    fn stopping_a_server_ends_what_it_started() {
        let state = McpState::default();
        let script = "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)";
        let (id, rx) = start(&state, script, Duration::from_millis(300));
        std::thread::sleep(Duration::from_millis(500));
        state.stop(id);
        closed(&rx, Duration::from_secs(10));
    }

    #[cfg(unix)]
    #[test]
    fn reports_a_server_that_exits_leaving_something_behind() {
        let state = McpState::default();
        let script = "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); setTimeout(() => process.exit(0), 300)";
        let (_, rx) = start(&state, script, Duration::from_secs(10));
        let (exit_code, _) = closed(&rx, Duration::from_secs(8));
        assert_eq!(exit_code, Some(0));
    }

    /// The app exiting must end its servers, even ones that ignore the
    /// request to stop. The grace period here is far longer than the test
    /// waits, so only `shutdown` itself can end them in time.
    #[cfg(unix)]
    #[test]
    fn shutting_down_ends_a_server_that_ignores_the_request_to_stop() {
        let state = McpState::default();
        let (_, rx) = start(
            &state,
            "setInterval(() => {}, 1000)",
            Duration::from_secs(60),
        );
        std::thread::sleep(Duration::from_millis(300));
        state.shutdown(Duration::from_millis(300));
        closed(&rx, Duration::from_secs(5));
    }

    /// Including what it started, which holds the server's output open.
    #[cfg(unix)]
    #[test]
    fn shutting_down_ends_what_the_server_started_too() {
        let state = McpState::default();
        let script = "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)";
        let (_, rx) = start(&state, script, Duration::from_secs(60));
        std::thread::sleep(Duration::from_millis(500));
        state.shutdown(Duration::from_millis(300));
        closed(&rx, Duration::from_secs(5));
    }

    /// A server that stops when asked is not made to wait out the limit.
    #[test]
    fn shutting_down_does_not_wait_for_a_server_that_stops_promptly() {
        let state = McpState::default();
        let (_, rx) = start(&state, ECHO, Duration::from_secs(60));
        let started = Instant::now();
        state.shutdown(Duration::from_secs(10));
        closed(&rx, Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn stop_all_reaches_every_server() {
        let state = McpState::default();
        let (_, first) = start(&state, ECHO, Duration::from_secs(10));
        let (_, second) = start(&state, ECHO, Duration::from_secs(10));
        state.stop_all();
        closed(&first, Duration::from_secs(10));
        closed(&second, Duration::from_secs(10));
    }
}
