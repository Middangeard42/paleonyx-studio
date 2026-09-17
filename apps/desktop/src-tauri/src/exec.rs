use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::commands::ProjectState;
use crate::process::{hide_window, resolve_program, ProcessGroup};

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
///
/// Runs on a worker thread (`async`). A plain command runs on the main
/// thread, and a two-minute test suite would freeze the window for two
/// minutes.
#[tauri::command(async)]
pub fn run_command(
    program: String,
    args: Vec<String>,
    state: tauri::State<'_, ProjectState>,
) -> Result<CommandOutputDto, String> {
    let root = {
        let guard = state.root.lock().map_err(|e| e.to_string())?;
        guard.as_ref().cloned().ok_or("No project is open.")?
    };
    execute(&root, &program, &args, TIMEOUT)
}

fn execute(
    root: &Path,
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<CommandOutputDto, String> {
    let resolved = resolve_program(program, root)?;
    let started = Instant::now();
    let mut command = Command::new(&resolved);
    command
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not run '{program}': {e}"))?;
    let group = match ProcessGroup::adopt(&child) {
        Ok(group) => group,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };

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
                if started.elapsed() >= timeout {
                    // The whole tree: `npm test` is cmd.exe running node,
                    // and killing only the top leaves node holding the
                    // pipes, so the reads below would never finish.
                    group.kill();
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

    // Something the command started and left behind — a watcher, a
    // server — would keep the pipes open too.
    group.kill();
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs a command with a deadline on the test itself. The failures
    /// these tests look for are hangs, and a hung test would stop the
    /// whole run rather than fail.
    fn run(program: &str, args: &[&str], timeout: Duration) -> CommandOutputDto {
        let program = program.to_string();
        let args: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
        let (done, result) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = done.send(execute(&std::env::temp_dir(), &program, &args, timeout));
        });
        result
            .recv_timeout(Duration::from_secs(20))
            .expect("the command never returned")
            .expect("the command should start")
    }

    fn node(script: &str, timeout: Duration) -> CommandOutputDto {
        run("node", &["-e", script], timeout)
    }

    #[test]
    fn reports_output_and_exit_code() {
        let output = node(
            "console.log('out'); console.error('err'); process.exit(4)",
            Duration::from_secs(30),
        );
        assert_eq!(output.stdout.trim(), "out");
        assert_eq!(output.stderr.trim(), "err");
        assert_eq!(output.exit_code, Some(4));
        assert!(!output.timed_out);
    }

    /// The fix that made the default allowlist usable on Windows: `npm`
    /// is `npm.cmd`, which a bare `Command::new("npm")` cannot find.
    #[cfg(windows)]
    #[test]
    fn runs_npm_by_its_bare_name() {
        let output = run("npm", &["--version"], Duration::from_secs(60));
        assert_eq!(output.exit_code, Some(0), "{}", output.stderr);
        assert!(!output.stdout.trim().is_empty());
    }

    /// A command that starts something and exits — a test runner leaving
    /// a watcher behind — must not hold the agent loop open.
    ///
    /// The grandchild is `detached` because on Windows Node already ends
    /// its ordinary children when it exits; only a detached one shows
    /// whether this code ends the tree.
    #[cfg(windows)]
    #[test]
    fn returns_when_the_command_ends_even_if_it_left_something_running() {
        let output = node(
            // `unref` lets this process exit while its child runs on.
            "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit', detached: true }).unref(); console.log('started')",
            Duration::from_secs(60),
        );
        assert_eq!(output.stdout.trim(), "started");
        assert!(!output.timed_out);
    }

    #[cfg(windows)]
    #[test]
    fn a_timeout_ends_the_whole_tree() {
        let output = node(
            "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit', detached: true }); setInterval(() => {}, 1000)",
            Duration::from_millis(1500),
        );
        assert!(output.timed_out);
        assert_eq!(output.exit_code, None);
    }

    #[test]
    fn keeps_the_end_of_long_output() {
        let text = "a".repeat(MAX_OUTPUT_BYTES) + "the end";
        let (kept, cut) = cap(text);
        assert!(cut);
        assert!(kept.ends_with("the end"));
        assert!(kept.starts_with("[earlier output truncated]"));
    }
}
