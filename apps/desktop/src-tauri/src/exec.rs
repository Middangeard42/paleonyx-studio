use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::commands::ProjectState;

/// Commands that hang would otherwise hold the agent loop open forever.
const TIMEOUT: Duration = Duration::from_secs(120);

/// Output beyond this is truncated. A test suite that prints tens of
/// megabytes would blow the model's context long before it helped.
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutputDto {
    pub stdout: String,
    pub stderr: String,
    /// `None` when the process was killed for exceeding the timeout.
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub truncated: bool,
    pub duration_ms: u128,
}

/// Runs one command inside the opened project.
///
/// Takes the program and its arguments separately and never goes through
/// a shell. That is the whole point: with `sh -c` or `cmd /c`, a single
/// allowlisted-looking string could carry `;`, `&&`, or backticks and run
/// anything at all. Spawning the binary directly means arguments are
/// arguments, whatever they contain.
///
/// This command does not consult the allowlist. Deciding *whether* a
/// command may run is policy and lives in agent-core, which is the one
/// auditable place for it (CLAUDE.md §6); this is only the mechanism.
#[tauri::command]
pub fn run_command(
    program: String,
    args: Vec<String>,
    state: tauri::State<ProjectState>,
) -> Result<CommandOutputDto, String> {
    let root = {
        let guard = state.root.lock().map_err(|e| e.to_string())?;
        guard.as_ref().cloned().ok_or("No project is open.")?
    };

    let started = Instant::now();
    let mut child = Command::new(&program)
        .args(&args)
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run '{program}': {e}"))?;

    // Drain both pipes on their own threads. Polling for exit while
    // leaving them unread deadlocks as soon as a chatty command fills the
    // pipe buffer and blocks waiting for someone to read it.
    let stdout_rx = drain(child.stdout.take());
    let stderr_rx = drain(child.stderr.take());

    let mut timed_out = false;
    let exit_code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if started.elapsed() >= TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break None;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(format!("Failed while waiting for '{program}': {e}")),
        }
    };

    let stdout = stdout_rx.recv().unwrap_or_default();
    let stderr = stderr_rx.recv().unwrap_or_default();
    let (stdout, out_cut) = cap(stdout);
    let (stderr, err_cut) = cap(stderr);

    Ok(CommandOutputDto {
        stdout,
        stderr,
        exit_code,
        timed_out,
        truncated: out_cut || err_cut,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn drain<R: Read + Send + 'static>(source: Option<R>) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(mut source) = source {
            let _ = source.read_to_end(&mut buffer);
        }
        let _ = tx.send(String::from_utf8_lossy(&buffer).to_string());
    });
    rx
}

/// Keeps the tail rather than the head: when a build or test run fails,
/// the failure and summary are at the end, and that is what the agent
/// needs to read.
fn cap(text: String) -> (String, bool) {
    if text.len() <= MAX_OUTPUT_BYTES {
        return (text, false);
    }
    let start = text.len() - MAX_OUTPUT_BYTES;
    // Land on a character boundary so the slice is valid UTF-8.
    let start = (start..text.len())
        .find(|&i| text.is_char_boundary(i))
        .unwrap_or(text.len());
    (
        format!("[earlier output truncated]\n{}", &text[start..]),
        true,
    )
}
