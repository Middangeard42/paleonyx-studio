use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Holds the currently opened project's root directory. Every read goes
/// through this, scoped and validated — there is no path a command can
/// reach outside whatever the user explicitly opened (CLAUDE.md §2/§6:
/// the agent, and this app in general, never gets unrestricted filesystem
/// access).
#[derive(Default)]
pub struct ProjectState {
    pub root: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
pub struct ProjectFileDto {
    pub path: String,
}

/// Resolves `requested` against `root` and rejects anything that
/// canonicalizes outside of it — the guard against `../../etc/passwd`
/// -style path traversal escaping the opened project.
fn resolve_within_root(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let candidate = root.join(requested);
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Could not resolve project root: {e}"))?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|e| format!("Could not resolve path '{requested}': {e}"))?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(format!("Path '{requested}' is outside the opened project."));
    }
    Ok(canonical_candidate)
}

#[tauri::command]
pub fn open_project(path: String, state: tauri::State<ProjectState>) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("'{path}' is not a directory."));
    }
    *state.root.lock().map_err(|e| e.to_string())? = Some(root);
    Ok(())
}

#[tauri::command]
pub fn list_project_files(
    state: tauri::State<ProjectState>,
) -> Result<Vec<ProjectFileDto>, String> {
    let guard = state.root.lock().map_err(|e| e.to_string())?;
    let root = guard.as_ref().ok_or("No project is open.")?;
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    Ok(files)
}

/// Skips dotfiles and the usual heavy/irrelevant directories. This is
/// v0's entire "index" (packages/indexing on the TS side does the same
/// language-tagging pass on top of whatever list this returns) — no file
/// watching yet, a fresh listing per call.
fn collect_files(root: &Path, dir: &Path, out: &mut Vec<ProjectFileDto>) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str == "node_modules" || name_str == "target" {
            continue;
        }
        if path.is_dir() {
            collect_files(root, &path, out)?;
        } else {
            let relative = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            out.push(ProjectFileDto { path: relative });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn read_project_file(
    path: String,
    state: tauri::State<ProjectState>,
) -> Result<String, String> {
    let guard = state.root.lock().map_err(|e| e.to_string())?;
    let root = guard.as_ref().ok_or("No project is open.")?;
    let resolved = resolve_within_root(root, &path)?;
    std::fs::read_to_string(&resolved).map_err(|e| format!("Could not read '{path}': {e}"))
}
