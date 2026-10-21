//! What an interrupted compile leaves under the cache, removed once a compile finishes.
use super::*;

/// What a compile cut short leaves under the cache, removed under the lock once one has finished:
/// the page runs no container took (every run of this compile was taken before its publication),
/// an archive extraction whose marker was never written (`plugins::scene::archive::extracted`),
/// and an audit record `atomic` left half written. A finished extraction and a whole audit record
/// are kept: they are the warm keys of their sources, which prune cannot tell from the others.
pub(super) fn remove_scratch(cache: &Path) -> Result<()> {
    if runs_dir(cache).is_dir() {
        fs::remove_dir_all(runs_dir(cache))?;
    }
    let listed = |dir: PathBuf| fs::read_dir(dir).into_iter().flatten().flatten();
    for entry in listed(archives_dir(cache)) {
        let finished = plugins::scene::archive::extracted(&entry.path()).is_some();
        if entry.file_type()?.is_dir() && !finished {
            fs::remove_dir_all(entry.path())?;
        }
    }
    for entry in listed(probes_dir(cache)) {
        if entry.path().extension().is_none_or(|e| e != "json") {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}
