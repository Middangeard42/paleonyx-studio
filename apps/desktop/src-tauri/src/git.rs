use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::commands::{resolve_within_root, ProjectState};
use crate::process::prepare_child;

/// Where agent history lives: a dedicated ref in the user's own
/// repository (CLAUDE.md §10 decision 3). Nothing here touches the
/// index, the working tree, or any branch the user might be on — the
/// plumbing below writes objects directly and moves only this ref, so
/// agent history can never interfere with an in-progress rebase, stash,
/// or merge.
const HISTORY_REF: &str = "refs/paleonyx/history";

/// Filename inside each history commit's tree. Arbitrary but fixed;
/// `read_history` looks it up by this name.
const RECORD_BLOB_NAME: &str = "change.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusDto {
    pub is_repository: bool,
    /// False when the repo exists but has no commits yet, which changes
    /// nothing for us but is worth surfacing rather than guessing at.
    pub has_commits: bool,
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.current_dir(root).args(args);
    prepare_child(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;

    if !output.status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Runs a git command that reads from stdin. Used for the object-writing
/// plumbing, where passing content as an argument would break on any
/// file large enough to exceed the command-line limit.
fn git_with_stdin(root: &Path, args: &[&str], input: &str) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_child(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;

    child
        .stdin
        .as_mut()
        .ok_or("Could not open a pipe to git")?
        .write_all(input.as_bytes())
        .map_err(|e| format!("Could not write to git: {e}"))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("git did not complete: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn project_root(state: &tauri::State<ProjectState>) -> Result<std::path::PathBuf, String> {
    let guard = state.root.lock().map_err(|e| e.to_string())?;
    guard
        .as_ref()
        .cloned()
        .ok_or("No project is open.".to_string())
}

#[tauri::command]
pub fn git_status(state: tauri::State<ProjectState>) -> Result<GitStatusDto, String> {
    repository_status(&project_root(&state)?)
}

fn repository_status(root: &Path) -> Result<GitStatusDto, String> {
    let is_repository = is_repository(root)?;

    let has_commits = is_repository && git(root, &["rev-parse", "--verify", "HEAD"]).is_ok();

    Ok(GitStatusDto {
        is_repository,
        has_commits,
    })
}

/// Whether `root` is inside a git work tree.
///
/// Not being one is an answer. Anything else git says (a repository owned
/// by another user, a format it cannot read, git not installed) is a
/// problem, and reporting it as "not a repository" would offer to create
/// a new repository on top of a real one.
///
/// Git exits with the same code for both, so the message tells them
/// apart. Git translates its messages, so this one is asked for in English.
fn is_repository(root: &Path) -> Result<bool, String> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .env("LC_ALL", "C");
    prepare_child(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;
    interpret_probe(
        output.status.success(),
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    )
}

fn interpret_probe(succeeded: bool, stdout: &str, stderr: &str) -> Result<bool, String> {
    if succeeded {
        // Inside the `.git` folder itself git succeeds and prints "false".
        return Ok(stdout.trim() == "true");
    }
    if stderr.contains("not a git repository") {
        return Ok(false);
    }
    let message = stderr.trim();
    Err(if message.is_empty() {
        "git could not check this folder.".to_string()
    } else {
        format!("git could not check this folder: {message}")
    })
}

/// Initializes a repository in the opened project.
///
/// Deliberately its own command rather than something the write path
/// calls on demand: creating a repo mutates the user's directory, and
/// CLAUDE.md §10 requires an explicit one-time notice before it happens.
/// Keeping it separate means the UI cannot accidentally trigger it
/// without having shown that notice first.
#[tauri::command]
pub fn git_init(state: tauri::State<ProjectState>) -> Result<(), String> {
    let root = project_root(&state)?;
    if is_repository(&root)? {
        return Err("This folder is already a git repository.".to_string());
    }
    git(&root, &["init"])?;
    Ok(())
}

/// Writes the agent's changes to disk.
///
/// Every path is re-resolved against the project root, so a path that
/// escapes the opened folder is rejected here exactly as it is on the
/// read side — the agent never gets a broader filesystem reach by way of
/// the write path (CLAUDE.md §2).
#[tauri::command]
pub fn write_project_files(
    files: std::collections::HashMap<String, String>,
    state: tauri::State<ProjectState>,
) -> Result<(), String> {
    let root = project_root(&state)?;

    // Resolve every path before writing any of them. A half-written
    // change is exactly the outcome packages/vcs works to prevent, and it
    // would be pointless for that guarantee to hold in the diff logic and
    // then be lost one layer down.
    let mut resolved = Vec::with_capacity(files.len());
    for (path, contents) in &files {
        resolved.push((resolve_within_root(&root, path)?, contents));
    }

    for (path, contents) in resolved {
        // A new file may sit in folders that do not exist yet. They are
        // inside the project by construction: `resolve_within_root`
        // refused anything that was not.
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
        }
        std::fs::write(&path, contents)
            .map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    }
    Ok(())
}

/// Removes files, only ever to undo a creation the agent made.
///
/// Paths are re-resolved against the project root exactly as reads and
/// writes are, so this can no more escape the opened folder than they
/// can. Whether a deletion is *permitted* is decided in packages/vcs,
/// which will only ever report one for a file the same change created
/// and that is untouched since.
#[tauri::command]
pub fn delete_project_files(
    paths: Vec<String>,
    state: tauri::State<ProjectState>,
) -> Result<(), String> {
    let root = project_root(&state)?;

    let mut resolved = Vec::with_capacity(paths.len());
    for path in &paths {
        resolved.push(resolve_within_root(&root, path)?);
    }

    for path in resolved {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            // Already gone is the requested end state, not a failure.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not remove {}: {e}", path.display())),
        }
    }
    Ok(())
}

/// Appends one agent change to the shadow history.
///
/// The record arrives as an opaque JSON string: its schema lives in
/// packages/shared-types, and duplicating that shape in Rust would give
/// it two definitions free to drift apart. Rust only needs to store the
/// bytes and hand them back.
///
/// Uses git's plumbing commands rather than `git commit`, which would
/// stage files and move the user's branch. This writes a blob, builds a
/// one-entry tree, commits it with the previous history entry as parent,
/// and moves only `refs/paleonyx/history`.
#[tauri::command]
pub fn record_agent_change(
    change_json: String,
    summary: String,
    state: tauri::State<ProjectState>,
) -> Result<String, String> {
    record_change(&project_root(&state)?, &change_json, &summary)
}

fn record_change(root: &Path, change_json: &str, summary: &str) -> Result<String, String> {
    let blob = git_with_stdin(root, &["hash-object", "-w", "--stdin"], change_json)?;
    let tree = git_with_stdin(
        root,
        &["mktree"],
        &format!("100644 blob {blob}\t{RECORD_BLOB_NAME}\n"),
    )?;

    let parent = history_tip(root)?;
    let mut args: Vec<String> = vec!["commit-tree".into(), tree, "-m".into(), summary.into()];
    if let Some(parent) = &parent {
        args.push("-p".into());
        args.push(parent.clone());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let commit = git(root, &arg_refs)?;

    move_history_ref(root, &commit, parent.as_deref())?;
    Ok(commit)
}

/// The commit the history ref points at, or `None` when nothing has been
/// recorded yet.
///
/// A missing ref is an ordinary state. A failure to read it is not, and
/// was once folded into "missing": history git could not read then showed
/// as "no changes yet". `for-each-ref` tells them apart by succeeding with
/// no output for a missing ref and failing for anything else.
fn history_tip(root: &Path) -> Result<Option<String>, String> {
    let listing = git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname) %(objectname)",
            HISTORY_REF,
        ],
    )?;
    let prefix = format!("{HISTORY_REF} ");
    Ok(listing
        .lines()
        .find_map(|line| line.strip_prefix(&prefix).map(str::to_string)))
}

/// Points the history ref at `commit`, but only if it still points where
/// it did when `commit` was built on top of it (`expected`, or nowhere for
/// a first change). Otherwise something else moved it in between, and
/// writing anyway would drop that change from the history.
fn move_history_ref(root: &Path, commit: &str, expected: Option<&str>) -> Result<(), String> {
    // An empty old value means "the ref must not exist yet".
    git(
        root,
        &["update-ref", HISTORY_REF, commit, expected.unwrap_or("")],
    )
    .map(|_| ())
}

/// Returns every recorded change, newest first, as the JSON strings that
/// were stored. Parsing is the frontend's job, where the schema lives.
#[tauri::command]
pub fn list_agent_changes(state: tauri::State<ProjectState>) -> Result<Vec<String>, String> {
    list_changes(&project_root(&state)?)
}

fn list_changes(root: &Path) -> Result<Vec<String>, String> {
    // An absent ref means no agent change has ever been recorded here,
    // which is an ordinary state and not an error.
    let Some(tip) = history_tip(root)? else {
        return Ok(Vec::new());
    };

    let revisions = git(root, &["rev-list", &tip])?;
    let mut records = Vec::new();
    for revision in revisions.lines() {
        let record = git(
            root,
            &["cat-file", "-p", &format!("{revision}:{RECORD_BLOB_NAME}")],
        )?;
        records.push(record);
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ScratchDir;

    fn scratch(name: &str) -> ScratchDir {
        ScratchDir::new(&format!("paleonyx-git-{name}"))
    }

    fn init(dir: &Path) {
        git(dir, &["init", "-q"]).unwrap();
    }

    #[test]
    fn a_plain_folder_is_not_a_repository() {
        let dir = scratch("plain");
        let status = repository_status(&dir).unwrap();
        assert!(!status.is_repository);
        assert!(!status.has_commits);
    }

    #[test]
    fn a_new_repository_has_no_commits_yet() {
        let dir = scratch("new");
        init(&dir);
        let status = repository_status(&dir).unwrap();
        assert!(status.is_repository);
        assert!(!status.has_commits);
    }

    #[test]
    fn a_repository_with_a_commit_says_so() {
        let dir = scratch("committed");
        init(&dir);
        git(
            &dir,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "first",
            ],
        )
        .unwrap();
        let status = repository_status(&dir).unwrap();
        assert!(status.is_repository);
        assert!(status.has_commits);
    }

    fn identified_repo(name: &str) -> ScratchDir {
        let dir = scratch(name);
        init(&dir);
        git(&dir, &["config", "user.name", "Test"]).unwrap();
        git(&dir, &["config", "user.email", "test@example.com"]).unwrap();
        dir
    }

    fn unreadable(dir: &Path) {
        let config = dir.join(".git").join("config");
        let text = std::fs::read_to_string(&config).unwrap();
        std::fs::write(
            &config,
            text.replace(
                "repositoryformatversion = 0",
                "repositoryformatversion = 99",
            ),
        )
        .unwrap();
    }

    #[test]
    fn nothing_recorded_yet_is_an_empty_history_not_an_error() {
        let dir = identified_repo("empty-history");
        assert_eq!(list_changes(&dir), Ok(Vec::new()));
    }

    #[test]
    fn each_change_is_recorded_on_top_of_the_last_and_listed_newest_first() {
        let dir = identified_repo("chain");
        record_change(&dir, r#"{"id":"1"}"#, "first").unwrap();
        record_change(&dir, r#"{"id":"2"}"#, "second").unwrap();
        record_change(&dir, r#"{"id":"3"}"#, "third").unwrap();
        assert_eq!(
            list_changes(&dir).unwrap(),
            vec![r#"{"id":"3"}"#, r#"{"id":"2"}"#, r#"{"id":"1"}"#]
        );
    }

    /// The regression: any failure reading the history ref was taken to
    /// mean it did not exist, so history that git could not read showed as
    /// "no changes yet".
    #[test]
    fn history_git_cannot_read_is_an_error_not_an_empty_list() {
        let dir = identified_repo("unreadable-history");
        record_change(&dir, r#"{"id":"1"}"#, "first").unwrap();
        unreadable(&dir);
        assert!(list_changes(&dir).is_err(), "reported as no history");
    }

    /// A guard rather than a reproduced bug: git's own `commit-tree`
    /// already refuses a parent that names nothing, so this held before
    /// too. It pins the property that matters, that a history ref which
    /// cannot be used is left exactly as it was.
    #[test]
    fn a_history_ref_that_cannot_be_read_is_never_replaced() {
        let dir = identified_repo("broken-ref");
        record_change(&dir, r#"{"id":"1"}"#, "first").unwrap();
        let ref_file = dir
            .join(".git")
            .join("refs")
            .join("paleonyx")
            .join("history");
        // A commit id that names nothing in this repository.
        let missing = "1".repeat(40);
        std::fs::write(&ref_file, format!("{missing}\n")).unwrap();

        assert!(record_change(&dir, r#"{"id":"2"}"#, "second").is_err());
        assert_eq!(std::fs::read_to_string(&ref_file).unwrap().trim(), missing);
    }

    #[test]
    fn a_change_is_refused_when_the_history_moved_since_it_was_built() {
        let dir = identified_repo("moved");
        let first = record_change(&dir, r#"{"id":"1"}"#, "first").unwrap();
        // A commit for the same tree, so it is a valid thing to point at.
        let other = git(
            &dir,
            &["commit-tree", &format!("{first}^{{tree}}"), "-m", "other"],
        )
        .unwrap();

        // Built when nothing existed, but the ref now points at `first`.
        assert!(move_history_ref(&dir, &other, None).is_err());
        // Built on top of a tip that is no longer the tip.
        assert!(move_history_ref(&dir, &other, Some(&other)).is_err());
        assert_eq!(history_tip(&dir).unwrap(), Some(first.clone()));

        // Built on the real tip, it goes through.
        move_history_ref(&dir, &other, Some(&first)).unwrap();
        assert_eq!(history_tip(&dir).unwrap(), Some(other));
    }

    #[test]
    fn the_history_tip_is_none_until_something_is_recorded() {
        let dir = identified_repo("tip");
        assert_eq!(history_tip(&dir), Ok(None));
        let first = record_change(&dir, r#"{"id":"1"}"#, "first").unwrap();
        assert_eq!(history_tip(&dir), Ok(Some(first)));
    }

    /// What git said in each case, from a real run.
    const NOT_A_REPOSITORY: &str =
        "fatal: not a git repository (or any of the parent directories): .git\n";
    const OTHER_OWNER: &str = "fatal: detected dubious ownership in repository at '/srv/project'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory /srv/project\n";

    #[test]
    fn reads_what_git_said() {
        assert_eq!(interpret_probe(true, "true\n", ""), Ok(true));
        assert_eq!(interpret_probe(true, "false\n", ""), Ok(false));
        assert_eq!(interpret_probe(false, "", NOT_A_REPOSITORY), Ok(false));
    }

    #[test]
    fn a_repository_owned_by_someone_else_is_a_problem_that_says_how_to_fix_it() {
        let error = interpret_probe(false, "", OTHER_OWNER).unwrap_err();
        assert!(error.contains("dubious ownership"), "{error}");
        assert!(error.contains("safe.directory"), "{error}");
    }

    #[test]
    fn a_failure_with_no_message_is_still_a_problem() {
        assert!(interpret_probe(false, "", "").is_err());
    }

    /// The regression: any failure of the check was reported as "not a
    /// repository". A folder git refuses to read (here, a format version
    /// it does not know; in practice often a repository owned by another
    /// user) was then offered a new repository on top of the real one.
    #[test]
    fn a_repository_git_will_not_read_is_an_error_not_a_missing_repository() {
        let dir = scratch("unreadable");
        init(&dir);
        let config = dir.join(".git").join("config");
        let text = std::fs::read_to_string(&config).unwrap();
        std::fs::write(
            &config,
            text.replace(
                "repositoryformatversion = 0",
                "repositoryformatversion = 99",
            ),
        )
        .unwrap();

        match repository_status(&dir) {
            Err(error) => assert!(error.contains("99"), "{error}"),
            Ok(status) => panic!(
                "reported as a plain answer: is_repository = {}",
                status.is_repository
            ),
        }
    }
}
