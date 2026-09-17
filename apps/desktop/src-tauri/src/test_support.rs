//! Helpers shared by the shell's tests.

use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// A folder under the system temp directory, removed when dropped.
///
/// Without the removal every run leaves its folders behind, and a day of
/// repeated runs left thousands.
pub struct ScratchDir(PathBuf);

impl ScratchDir {
    pub fn new(prefix: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{prefix}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        ScratchDir(dir)
    }
}

impl Deref for ScratchDir {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.0
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        // Best effort: a process a test started can hold a file open for a
        // moment longer, and a leftover temp folder is not a test failure.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
