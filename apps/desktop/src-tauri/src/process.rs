//! What every process the app starts has in common: finding the program,
//! keeping its console out of sight, and making sure it — and anything it
//! starts — ends when the app says so.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

/// Finds the program to start.
///
/// On Windows, `npm`, `npx` and most other Node tools are `.cmd` files,
/// which `Command::new("npm")` cannot find — it only ever looks for
/// `.exe`. Without this, an allowlisted `npm test` could never run, and
/// neither could the `npx` line most MCP servers are configured with.
///
/// A bare name is looked up on `PATH` only, never in the project folder.
/// Windows would otherwise prefer a `npm.cmd` sitting in the repository
/// over the real one, and the repository is not necessarily the user's.
/// A name with a path in it is taken relative to the project, since that
/// is where the process runs.
pub fn resolve_program(program: &str, project: &Path) -> Result<PathBuf, String> {
    resolve_with(
        program,
        project,
        std::env::var_os("PATH").as_deref(),
        std::env::var_os("PATHEXT").as_deref(),
    )
}

fn resolve_with(
    program: &str,
    project: &Path,
    path_var: Option<&OsStr>,
    pathext: Option<&OsStr>,
) -> Result<PathBuf, String> {
    let requested = Path::new(program);
    let has_directory = program.contains('/') || program.contains('\\');

    if requested.is_absolute() || has_directory {
        let candidate = if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            project.join(requested)
        };
        // Missing files are left for the spawn to report, with its own
        // wording; this only fills in an extension Windows would.
        return Ok(with_extension(&candidate, pathext).unwrap_or(candidate));
    }

    if !cfg!(windows) {
        // Everywhere else the standard library searches PATH correctly.
        return Ok(requested.to_path_buf());
    }

    let directories = path_var.map(|value| std::env::split_paths(value).collect::<Vec<_>>());
    for directory in directories.unwrap_or_default() {
        if let Some(found) = with_extension(&directory.join(program), pathext) {
            return Ok(found);
        }
    }
    Err(format!(
        "Couldn't find \"{program}\" on this computer. Check that it's installed and that its folder is on your PATH."
    ))
}

/// The file Windows would run for `candidate`: itself when it already
/// has a runnable extension, otherwise the first of `PATHEXT` that exists.
fn with_extension(candidate: &Path, pathext: Option<&OsStr>) -> Option<PathBuf> {
    if !cfg!(windows) {
        return candidate.is_file().then(|| candidate.to_path_buf());
    }
    let extensions = runnable_extensions(pathext);
    let current = candidate
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy()).to_ascii_uppercase());
    if let Some(current) = current {
        if extensions.contains(&current) && candidate.is_file() {
            return Some(candidate.to_path_buf());
        }
    }
    extensions.iter().find_map(|ext| {
        let mut name = candidate.as_os_str().to_owned();
        name.push(ext.to_ascii_lowercase());
        let path = PathBuf::from(name);
        path.is_file().then_some(path)
    })
}

/// `PATHEXT`, limited to what `CreateProcess` can actually start. A
/// `.ps1` or `.js` in there would be found and then fail to launch.
fn runnable_extensions(pathext: Option<&OsStr>) -> Vec<String> {
    const STARTABLE: [&str; 4] = [".COM", ".EXE", ".BAT", ".CMD"];
    let listed = pathext
        .map(|value| value.to_string_lossy().to_ascii_uppercase())
        .unwrap_or_else(|| STARTABLE.join(";"));
    listed
        .split(';')
        .map(str::trim)
        .filter(|ext| STARTABLE.contains(ext))
        .map(str::to_string)
        .collect()
}

/// Settings every child the app starts needs, applied before it spawns.
///
/// On Windows, keeps a console program from opening a window of its own.
/// A release build has no console, so Windows gives each console child a
/// new one: a black window flashing up for every test run, and one
/// sitting open for as long as an MCP server runs.
///
/// Elsewhere, puts the child in a process group of its own, which is what
/// lets `ProcessGroup::kill` end it and everything it started.
pub fn prepare_child(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
}

/// A process and everything it starts, ended together.
///
/// Killing only the process the app started is not enough: `npm test`
/// is `cmd.exe` running `node`, and `npx some-server` is several layers
/// deep. Killing the top one leaves the rest running — still holding the
/// output pipe open, so whatever reads it waits forever. On Windows the
/// tree is placed in a job object, which also ends it if the app itself
/// exits or crashes.
///
/// Known gap: a child the process starts in the instant before it is
/// added to the job is not in the job. Closing that gap means creating
/// the process suspended, which the standard library does not offer.
///
/// Elsewhere the tree is a process group, and `kill` signals the group.
/// That is weaker than a job object in two ways. A descendant that leaves
/// the group (a daemon calling `setsid`) is out of reach, and nothing ends
/// the group if the app itself is killed or crashes; the caller has to ask.
/// A normal exit does ask: `McpState::shutdown` ends every server's group.
pub struct ProcessGroup {
    #[cfg(windows)]
    job: windows::Win32::Foundation::HANDLE,
    /// The group's id, which is the id of the process that leads it.
    #[cfg(unix)]
    group: i32,
}

// A job handle is a reference to a kernel object; Windows lets any
// thread use it, including two at once: the calls made through it
// (`TerminateJobObject`) are safe to overlap. It is shared between the
// thread supervising a server and the app's exit.
#[cfg(windows)]
unsafe impl Send for ProcessGroup {}
#[cfg(windows)]
unsafe impl Sync for ProcessGroup {}

impl ProcessGroup {
    #[cfg(windows)]
    pub fn adopt(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let fail = |e: windows::core::Error| format!("Could not keep track of the process: {e}");
        // SAFETY: plain Win32 calls on handles owned here; `group` closes
        // the job on every early return.
        unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null()).map_err(fail)?;
            let group = ProcessGroup { job };
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .map_err(fail)?;
            AssignProcessToJobObject(job, HANDLE(child.as_raw_handle() as _)).map_err(fail)?;
            Ok(group)
        }
    }

    /// The child must have been started through `prepare_child`, so that it
    /// leads a group of its own. Without that, `kill` would signal the
    /// app's own group.
    #[cfg(unix)]
    pub fn adopt(child: &Child) -> Result<Self, String> {
        let group = i32::try_from(child.id()).map_err(|_| {
            "Could not keep track of the process: its id is out of range.".to_string()
        })?;
        Ok(ProcessGroup { group })
    }

    /// Ends every process still in the group.
    pub fn kill(&self) {
        #[cfg(unix)]
        // SAFETY: `kill` reads no memory of ours. A negative id addresses the
        // whole group. It fails with ESRCH once the group is empty, which is
        // the outcome being asked for. A group id stays reserved while any
        // member lives, so it cannot name an unrelated group until then.
        unsafe {
            let _ = libc::kill(-self.group, libc::SIGKILL);
        }
        #[cfg(windows)]
        // SAFETY: the handle is owned by `self` and still open.
        unsafe {
            // Fails only when there is nothing left to end, which is the
            // outcome being asked for.
            let _ = windows::Win32::System::JobObjects::TerminateJobObject(self.job, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        // SAFETY: closed exactly once, here. Closing the last handle ends
        // anything still in the job, by the limit set in `adopt`.
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ScratchDir;
    #[cfg(windows)]
    use std::ffi::OsString;
    use std::fs;

    fn scratch(name: &str) -> ScratchDir {
        ScratchDir::new(&format!("paleonyx-process-{name}"))
    }

    const PATHEXT: &str = ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.PS1";

    #[cfg(windows)]
    #[test]
    fn finds_a_cmd_file_on_the_path() {
        let bin = scratch("cmd-bin");
        fs::write(bin.join("tool.cmd"), "@echo off").unwrap();
        let path = OsString::from(bin.as_os_str());
        let found = resolve_with(
            "tool",
            Path::new("C:\\"),
            Some(&path),
            Some(OsStr::new(PATHEXT)),
        );
        assert_eq!(found.unwrap(), bin.join("tool.cmd"));
    }

    #[cfg(windows)]
    #[test]
    fn follows_pathext_order() {
        let bin = scratch("order-bin");
        fs::write(bin.join("tool.cmd"), "").unwrap();
        fs::write(bin.join("tool.exe"), "").unwrap();
        let path = OsString::from(bin.as_os_str());
        let found = resolve_with(
            "tool",
            Path::new("C:\\"),
            Some(&path),
            Some(OsStr::new(PATHEXT)),
        );
        assert_eq!(found.unwrap(), bin.join("tool.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn never_runs_something_that_cannot_be_started() {
        let bin = scratch("ps1-bin");
        fs::write(bin.join("tool.ps1"), "").unwrap();
        let path = OsString::from(bin.as_os_str());
        assert!(resolve_with(
            "tool",
            Path::new("C:\\"),
            Some(&path),
            Some(OsStr::new(PATHEXT))
        )
        .is_err());
    }

    /// The case that matters: a repository planting `npm.cmd` at its root
    /// must not have it run in place of the real one.
    #[cfg(windows)]
    #[test]
    fn does_not_look_in_the_project_for_a_bare_name() {
        let project = scratch("planted-project");
        fs::write(project.join("npm.cmd"), "@echo planted").unwrap();
        let empty_dir = scratch("planted-empty-path");
        let empty_path = OsString::from(empty_dir.as_os_str());
        let found = resolve_with(
            "npm",
            &project,
            Some(&empty_path),
            Some(OsStr::new(PATHEXT)),
        );
        assert!(found.is_err(), "resolved to {found:?}");
    }

    #[cfg(windows)]
    #[test]
    fn accepts_a_name_that_already_has_its_extension() {
        let bin = scratch("ext-bin");
        fs::write(bin.join("tool.cmd"), "").unwrap();
        let path = OsString::from(bin.as_os_str());
        let found = resolve_with(
            "tool.CMD",
            Path::new("C:\\"),
            Some(&path),
            Some(OsStr::new(PATHEXT)),
        );
        assert_eq!(found.unwrap(), bin.join("tool.CMD"));
    }

    #[test]
    fn takes_a_relative_path_from_the_project() {
        let project = scratch("relative-project");
        fs::create_dir_all(project.join("tools")).unwrap();
        let file = if cfg!(windows) {
            "server.exe"
        } else {
            "server"
        };
        fs::write(project.join("tools").join(file), "").unwrap();
        let found =
            resolve_with("tools/server", &project, None, Some(OsStr::new(PATHEXT))).unwrap();
        assert_eq!(found, project.join("tools").join(file));
    }

    #[cfg(windows)]
    #[test]
    fn says_what_it_could_not_find() {
        let empty_dir = scratch("missing-path");
        let empty = OsString::from(empty_dir.as_os_str());
        let error =
            resolve_with("nonexistent-tool", Path::new("C:\\"), Some(&empty), None).unwrap_err();
        assert!(error.contains("nonexistent-tool"), "{error}");
    }

    /// The hang this guards against: a grandchild keeps the output pipe
    /// open after its parent is killed, so reading to the end never ends.
    #[cfg(windows)]
    #[test]
    fn killing_the_group_ends_grandchildren_too() {
        use std::io::Read;
        use std::process::Stdio;
        use std::sync::mpsc;
        use std::time::Duration;

        let mut command = Command::new("cmd.exe");
        command
            .args(["/c", "ping -n 30 127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        prepare_child(&mut command);
        let mut child = command.spawn().unwrap();
        let group = ProcessGroup::adopt(&child).unwrap();
        let mut stdout = child.stdout.take().unwrap();

        let (done, finished) = mpsc::channel();
        std::thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = stdout.read_to_end(&mut sink);
            let _ = done.send(());
        });

        std::thread::sleep(Duration::from_millis(500));
        group.kill();
        // Checked before waiting on `cmd`: with only `cmd` killed, the
        // wait would last as long as `ping` does and hide the failure.
        let closed = finished.recv_timeout(Duration::from_secs(5)).is_ok();
        let _ = child.kill();
        let _ = child.wait();
        assert!(
            closed,
            "the output pipe stayed open, so something in the tree survived"
        );
    }
}
