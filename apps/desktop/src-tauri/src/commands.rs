use serde::Serialize;
use std::path::{Component, Path, PathBuf};
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
///
/// Shared by the read and write paths on purpose: the agent must not
/// gain any wider filesystem reach by writing than it has by reading
/// (CLAUDE.md §2).
pub fn resolve_within_root(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let outside = || format!("Path '{requested}' is outside the opened project.");
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Could not resolve project root: {e}"))?;

    // Only plain relative names. `..` is refused outright rather than
    // left to canonicalization, because a `..` inside a folder that does
    // not exist yet cannot be resolved to check where it leads. An
    // absolute path or drive prefix would replace the root entirely.
    let relative = Path::new(requested);
    if !relative
        .components()
        .all(|part| matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err(outside());
    }

    // Walk up to the nearest part of the path that exists and resolve
    // that — which also follows any symlink in it — then put the missing
    // names back. Safe because those names were just checked to be plain.
    //
    // The walk is what lets a new file land in a new folder. Resolving
    // only the immediate parent, as this used to, refused every file in a
    // folder not yet created: a scaffold into an empty folder, or the
    // first skill saved to a project.
    let candidate = canonical_root.join(relative);
    let mut existing: &Path = &candidate;
    let mut missing = Vec::new();
    let resolved = loop {
        match existing.canonicalize() {
            Ok(found) => break found,
            Err(_) => {
                missing.push(existing.file_name().ok_or_else(outside)?);
                existing = existing.parent().ok_or_else(outside)?;
            }
        }
    };
    let mut full = resolved;
    for name in missing.iter().rev() {
        full.push(name);
    }

    if !full.starts_with(&canonical_root) {
        return Err(outside());
    }
    Ok(full)
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

/// `path` relative to `root`, written with `/` between its parts, which is
/// how the interface names project files on every platform.
///
/// Built from the path's own components rather than by rewriting `\\` in
/// its text. Windows splits on `\\` and gets `/` back; elsewhere a
/// backslash is an ordinary character in a file name, and rewriting it
/// listed a path that does not exist.
pub(crate) fn project_relative_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let parts: Vec<_> = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect();
    Some(parts.join("/"))
}

/// Hidden folders that are part of the project rather than noise.
///
/// Only `.paleonyx`, which holds the project's own context document and
/// skills. Every other dot-entry stays out — `.git` above all — as before.
///
/// This list exists because skipping every dot-entry quietly broke the
/// first place Paleonyx looks for project guidance: `.paleonyx/context.md`
/// never appeared in a listing, and the code that finds context documents
/// only reads what the listing contains. Its unit test used a fake file
/// system that did list it, so nothing noticed.
const LISTED_HIDDEN_DIRS: &[&str] = &[".paleonyx"];

/// Skips dotfiles (bar the folders above) and the usual heavy or
/// irrelevant directories. No file watching yet — a fresh listing per
/// call; packages/indexing does the language tagging on top.
pub(crate) fn collect_files(
    root: &Path,
    dir: &Path,
    out: &mut Vec<ProjectFileDto>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // The entry's own type, which does not follow a link. Following
        // one listed a link back up the tree as a few dozen nested
        // copies of it, and listed the names of files outside the project.
        // Search skips links too.
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let hidden = name_str.starts_with('.')
            && !(file_type.is_dir() && LISTED_HIDDEN_DIRS.contains(&name_str.as_ref()));
        if hidden || name_str == "node_modules" || name_str == "target" {
            continue;
        }
        if file_type.is_dir() {
            collect_files(root, &path, out)?;
        } else {
            let relative = project_relative_path(root, &path)
                .ok_or_else(|| format!("{} is outside the project.", path.display()))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn listed(files: &[&str]) -> Vec<String> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("paleonyx-list-{nanos}"));
        for file in files {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "x").unwrap();
        }
        let mut out = Vec::new();
        collect_files(&root, &root, &mut out).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let mut paths: Vec<String> = out.into_iter().map(|f| f.path).collect();
        paths.sort();
        paths
    }

    /// The regression: skipping every dot-entry hid the project's own
    /// context document and skills, so neither ever loaded.
    #[test]
    fn lists_the_projects_own_paleonyx_folder() {
        let paths = listed(&[
            ".paleonyx/context.md",
            ".paleonyx/skills/tidy.md",
            "src/app.ts",
        ]);
        assert!(
            paths.contains(&".paleonyx/context.md".to_string()),
            "{paths:?}"
        );
        assert!(
            paths.contains(&".paleonyx/skills/tidy.md".to_string()),
            "{paths:?}"
        );
        assert!(paths.contains(&"src/app.ts".to_string()), "{paths:?}");
    }

    #[test]
    fn still_hides_other_hidden_entries() {
        let paths = listed(&[
            ".git/HEAD",
            ".env",
            ".vscode/settings.json",
            "node_modules/x/index.js",
            "src/app.ts",
        ]);
        assert_eq!(paths, vec!["src/app.ts".to_string()]);
    }

    fn empty_root(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("paleonyx-resolve-{tag}-{nanos}"));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    /// The regression: a new file in a folder that does not exist yet was
    /// refused, which is every scaffold into an empty folder and every
    /// first skill saved into a project.
    #[test]
    fn resolves_a_new_file_in_folders_that_do_not_exist_yet() {
        let root = empty_root("new-dirs");
        let resolved = resolve_within_root(&root, "lib/util/helpers.js").unwrap();
        assert!(resolved.ends_with(Path::new("lib").join("util").join("helpers.js")));
        assert!(resolved.starts_with(root.canonicalize().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `..` through a folder that does not exist cannot be checked by
    /// resolving it, so it is refused outright.
    #[test]
    fn refuses_to_climb_out_through_a_missing_folder() {
        let root = empty_root("climb");
        for requested in [
            "missing/../../escape.txt",
            "../escape.txt",
            "a/b/../../../escape.txt",
        ] {
            assert!(
                resolve_within_root(&root, requested).is_err(),
                "{requested} was allowed"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_an_absolute_path() {
        let root = empty_root("absolute");
        let outside = std::env::temp_dir().join("elsewhere.txt");
        assert!(resolve_within_root(&root, &outside.to_string_lossy()).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn still_resolves_an_existing_file() {
        let root = empty_root("existing");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/app.ts"), "x").unwrap();
        let resolved = resolve_within_root(&root, "src/app.ts").unwrap();
        assert_eq!(
            resolved,
            root.canonicalize().unwrap().join("src").join("app.ts")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A link back up the tree is ordinary in a checked-out repository. Following
    /// it recursed until the operating system gave up, and one error from
    /// that failed the whole listing.
    #[cfg(unix)]
    #[test]
    fn a_symlink_loop_does_not_break_the_listing() {
        let root = empty_root("loop");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/app.ts"), "x").unwrap();
        std::os::unix::fs::symlink(&root, root.join("src/again")).unwrap();
        let mut out = Vec::new();
        collect_files(&root, &root, &mut out).expect("the listing should not fail");
        let paths: Vec<String> = out.into_iter().map(|f| f.path).collect();
        assert_eq!(paths, vec!["src/app.ts".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Reading a file through a link out of the project is already refused;
    /// listing it would still show its name.
    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_project_is_not_listed() {
        let root = empty_root("out");
        let elsewhere = empty_root("elsewhere");
        std::fs::write(elsewhere.join("secret.txt"), "x").unwrap();
        std::fs::write(root.join("app.ts"), "x").unwrap();
        std::os::unix::fs::symlink(&elsewhere, root.join("linked")).unwrap();
        std::os::unix::fs::symlink(elsewhere.join("secret.txt"), root.join("secret-link.txt"))
            .unwrap();
        let mut out = Vec::new();
        collect_files(&root, &root, &mut out).unwrap();
        let paths: Vec<String> = out.into_iter().map(|f| f.path).collect();
        assert_eq!(paths, vec!["app.ts".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&elsewhere);
    }

    /// Search reports its paths through the same function, so this is what
    /// keeps the two agreeing.
    #[test]
    fn project_paths_are_written_with_slashes_and_only_inside_the_project() {
        let root = Path::new("project");
        assert_eq!(
            project_relative_path(root, &root.join("src").join("app.ts")),
            Some("src/app.ts".to_string())
        );
        assert_eq!(
            project_relative_path(root, Path::new("elsewhere/x.ts")),
            None
        );
    }

    /// A backslash is an ordinary character in a file name outside
    /// Windows. Rewriting it to a slash listed a path that does not exist.
    #[cfg(unix)]
    #[test]
    fn a_backslash_in_a_file_name_is_kept_and_the_path_still_resolves() {
        let root = empty_root("backslash");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src").join("odd\\name.txt"), "x").unwrap();
        let mut out = Vec::new();
        collect_files(&root, &root, &mut out).unwrap();
        let paths: Vec<String> = out.into_iter().map(|f| f.path).collect();
        assert_eq!(paths, vec!["src/odd\\name.txt".to_string()]);
        let resolved = resolve_within_root(&root, &paths[0]).unwrap();
        assert!(resolved.is_file(), "{resolved:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Only a folder of that name is let through: a stray file called
    /// `.paleonyx` is still a dotfile.
    #[test]
    fn does_not_list_a_file_merely_named_like_the_folder() {
        let paths = listed(&[".paleonyx", "src/app.ts"]);
        assert_eq!(paths, vec!["src/app.ts".to_string()]);
    }
}
