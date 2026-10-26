//! What is derived from a source, kept by the content it was derived from: a result a stage builds
//! for one mesh — its cards — is stored under a key that names every input of its build, so
//! that a later compilation of the same mesh with the same settings reads it instead of building
//! it again. The folder is the compiler's own: a result is never read by a compiler of another
//! implementation (`prune` removes theirs), whatever the key.
use crate::compiler::cache::storage::{atomic, native_dir};
use crate::Result;
use std::fs;
use std::path::{Path, PathBuf};

/// The folder of the derived results of every implementation, in the cache.
fn derived_dir(cache: &Path) -> PathBuf {
    native_dir(cache).join("derived")
}

/// The derived results of this implementation.
pub(crate) struct Derived {
    root: PathBuf,
}

impl Derived {
    pub(crate) fn new(cache: &Path) -> Self {
        Self {
            root: derived_dir(cache).join(crate::implementation_hash()),
        }
    }

    fn path(&self, kind: &str, key: &str) -> PathBuf {
        self.root.join(kind).join(format!("{key}.bin"))
    }

    /// The bytes stored for `key` of `kind`, none when there are none.
    pub(crate) fn get(&self, kind: &str, key: &str) -> Option<Vec<u8>> {
        fs::read(self.path(kind, key)).ok()
    }

    /// Stores `bytes` for `key` of `kind`. A result that cannot be written is only built again
    /// next time: the compilation does not fail for it.
    pub(crate) fn put(&self, kind: &str, key: &str, bytes: &[u8]) {
        let path = self.path(kind, key);
        if let Some(folder) = path.parent() {
            if fs::create_dir_all(folder).is_ok() {
                let _ = atomic(&path, bytes);
            }
        }
    }
}

/// Removes the derived results of the other implementations of the compiler.
pub(crate) fn prune(cache: &Path) -> Result<()> {
    let Ok(entries) = fs::read_dir(derived_dir(cache)) else {
        return Ok(());
    };
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.is_dir() && entry.file_name() != crate::implementation_hash() {
            fs::remove_dir_all(entry.path())?;
        }
    }
    Ok(())
}
