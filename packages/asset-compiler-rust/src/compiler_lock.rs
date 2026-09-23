use super::*;

/// Lock name in `<cache>/native`. Prune only walks `slice`, `full`, `imports` and
/// `objects`: a file placed next to them cannot be deleted by a compilation.
const CACHE_LOCK_FILE: &str = ".lock";
/// Beyond this, a waiting compilation gives up rather than waiting forever.
const WAIT: std::time::Duration = std::time::Duration::from_secs(30);
/// Shortens the wait above, in milliseconds: a host that prefers an immediate
/// refusal, or a trial that does not want to last thirty seconds, sets this
/// variable. An unreadable value is ignored.
const WAIT_ENV: &str = "TRILLION3D_CACHE_LOCK_WAIT_MS";
/// One wait step: short enough that a cancellation is read without a noticeable
/// delay, long enough that waiting costs nothing.
const STEP: std::time::Duration = std::time::Duration::from_millis(20);

/// Mutual exclusion on a cache. A cache keeps only one pointer per scope and
/// prunes after each write: two compilations writing it at the same time erase
/// the key and the objects the other just published.
///
/// The exclusion is the one the system holds on `<cache>/native/.lock`: it
/// follows the process, not the file, so the system releases it as soon as its
/// owner dies, including killed outright or taken by a reboot. The file itself
/// is never deleted: its existence says nothing, only holding it counts, and
/// deleting a living owner's file would take its cache.
pub(super) struct CacheLock {
    file: File,
}

/// The wait before giving up, as the environment variable sets it, otherwise `WAIT`.
fn wait() -> std::time::Duration {
    std::env::var(WAIT_ENV)
        .ok()
        .and_then(|value| value.parse().ok())
        .map_or(WAIT, std::time::Duration::from_millis)
}

impl CacheLock {
    pub(super) fn acquire(o: &Options) -> Result<Self> {
        let native = o.cache.join("native");
        fs::create_dir_all(&native)?;
        let file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(native.join(CACHE_LOCK_FILE))?;
        let deadline = Instant::now() + wait();
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(Self { file }),
                Err(fs::TryLockError::WouldBlock) => {}
                Err(fs::TryLockError::Error(error)) => return Err(error.into()),
            }
            // Waiting for a lock is no reason to stay deaf: the host that gives up is
            // served on the next step, and the compiling owner's lock is not touched.
            check(o)?;
            if Instant::now() >= deadline {
                return Err(CompilerError::new(
                    "CACHE_LOCKED",
                    format!(
                        "Cache {} is being written by another compilation",
                        o.cache.display()
                    ),
                ));
            }
            std::thread::sleep(STEP);
        }
    }
}

impl Drop for CacheLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}
