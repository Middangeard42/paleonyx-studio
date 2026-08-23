use ignore::WalkBuilder;
use serde::Serialize;
use std::path::Path;

use crate::commands::ProjectState;

/// Caps, so a broad query on a large repository cannot hang the UI or
/// return more than anyone would read. Truncation is reported rather
/// than hidden — a clipped result set that looks complete would let
/// someone conclude a symbol is absent when it is not.
const MAX_FILES: usize = 200;
const MAX_MATCHES_PER_FILE: usize = 20;
const MAX_TOTAL_MATCHES: usize = 1000;

/// Files above this size are skipped. Minified bundles and checked-in
/// data files are not what anyone is searching for, and scanning them
/// costs far more than the rest of the tree combined.
const MAX_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchDto {
    pub line: usize,
    pub text: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResultDto {
    pub path: String,
    pub matches: Vec<SearchMatchDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultsDto {
    pub files: Vec<FileSearchResultDto>,
    pub truncated: bool,
    pub total_matches: usize,
}

#[tauri::command]
pub fn search_project(
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    state: tauri::State<ProjectState>,
) -> Result<SearchResultsDto, String> {
    let root = {
        let guard = state.root.lock().map_err(|e| e.to_string())?;
        guard.as_ref().cloned().ok_or("No project is open.")?
    };

    if query.is_empty() {
        return Ok(SearchResultsDto {
            files: Vec::new(),
            truncated: false,
            total_matches: 0,
        });
    }

    let needle = if case_sensitive {
        query.clone()
    } else {
        query.to_lowercase()
    };

    let mut files = Vec::new();
    let mut total_matches = 0usize;
    let mut truncated = false;

    // WalkBuilder honours .gitignore, .ignore, and hidden-file rules, so
    // build output and dependencies stay out of results without us
    // maintaining an exclusion list that would drift from each project's
    // actual conventions.
    let walker = WalkBuilder::new(&root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .parents(true)
        .build();

    for entry in walker.flatten() {
        if files.len() >= MAX_FILES || total_matches >= MAX_TOTAL_MATCHES {
            truncated = true;
            break;
        }
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
            continue;
        }

        // Binary files fail UTF-8 decoding, which is the cheapest way to
        // skip them without sniffing content types.
        let Ok(contents) = std::fs::read_to_string(entry.path()) else {
            continue;
        };

        let matches = find_in_file(&contents, &needle, case_sensitive, whole_word);
        if matches.is_empty() {
            continue;
        }

        total_matches += matches.len();
        let Some(relative) = relative_path(&root, entry.path()) else {
            continue;
        };

        let mut capped = matches;
        if capped.len() > MAX_MATCHES_PER_FILE {
            capped.truncate(MAX_MATCHES_PER_FILE);
            truncated = true;
        }

        files.push(FileSearchResultDto {
            path: relative,
            matches: capped,
        });
    }

    Ok(SearchResultsDto {
        files,
        truncated,
        total_matches,
    })
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    Some(
        path.strip_prefix(root)
            .ok()?
            .to_string_lossy()
            .replace('\\', "/"),
    )
}

fn find_in_file(
    contents: &str,
    needle: &str,
    case_sensitive: bool,
    whole_word: bool,
) -> Vec<SearchMatchDto> {
    let mut matches = Vec::new();

    for (index, raw_line) in contents.lines().enumerate() {
        let haystack = if case_sensitive {
            raw_line.to_string()
        } else {
            raw_line.to_lowercase()
        };

        let mut from = 0usize;
        while let Some(offset) = haystack[from..].find(needle) {
            let start = from + offset;
            let end = start + needle.len();

            if !whole_word || is_whole_word(&haystack, start, end) {
                matches.push(SearchMatchDto {
                    line: index + 1,
                    text: raw_line.trim_end().to_string(),
                    start,
                    end,
                });
            }

            // Advance past this match. Guard against a zero-length needle
            // looping forever, even though callers reject empty queries.
            from = end.max(start + 1);
            if from >= haystack.len() {
                break;
            }
        }
    }

    matches
}

/// A match is a whole word when neither neighbouring character could be
/// part of the same identifier.
fn is_whole_word(haystack: &str, start: usize, end: usize) -> bool {
    let before_ok = haystack[..start]
        .chars()
        .next_back()
        .is_none_or(|c| !is_word_char(c));
    let after_ok = haystack[end..]
        .chars()
        .next()
        .is_none_or(|c| !is_word_char(c));
    before_ok && after_ok
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}
