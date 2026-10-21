//! Resident memory — the peak and the current — and CPU time of the compiler process, as the
//! kernel reports them, and the allocator told to give back what it holds freed.
//!
//! The peak is the high-water mark of the whole process since it started: every progress event
//! carries it, so the first event whose value jumps names the stage that raised the peak. In a
//! batch that runs several jobs at once, both marks are shared by all of them. The current one is
//! what an admission measured on memory reads (`compiler::budget::admission`), the purge what it
//! runs before it reads it (`purge`).

// The binary's allocator (`main.rs`), linked wherever this crate is: `purge` calls into it.
extern crate mimalloc as _;

/// This process's resource usage, `None` when the kernel refuses it.
#[cfg(unix)]
fn usage() -> Option<libc::rusage> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: `getrusage` writes one `rusage` into the pointer it is given, which is valid and
    // aligned for it; the value is read only once the call has succeeded.
    unsafe {
        if libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) != 0 {
            return None;
        }
        Some(usage.assume_init())
    }
}

/// Peak resident bytes of this process, `None` where the platform does not report it.
#[cfg(unix)]
pub fn peak_bytes() -> Option<u64> {
    let usage = usage()?;
    let peak = u64::try_from(usage.ru_maxrss).ok()?;
    // macOS reports bytes, the other Unix systems kibibytes.
    Some(if cfg!(target_os = "macos") {
        peak
    } else {
        peak.saturating_mul(1024)
    })
}

#[cfg(not(unix))]
pub fn peak_bytes() -> Option<u64> {
    None
}

/// The bytes this process holds now, `None` where the platform does not report it: its physical
/// footprint, what the kernel charges it — its compressed pages and the device's buffers included,
/// and the blocks the allocator freed until it purges them (`purge`). Not its resident size, which
/// keeps every page the allocator gave back (`MADV_FREE_REUSABLE`) until the system needs it, the
/// allocator's next blocks filling those pages again without growing it: a process that once
/// peaked would read as holding its peak long after it let go of it, and an admission on it would
/// run every job alone from then on.
#[cfg(target_os = "macos")]
pub fn current_bytes() -> Option<u64> {
    let mut info = std::mem::MaybeUninit::<libc::rusage_info_v0>::zeroed();
    // SAFETY: `proc_pid_rusage` writes one `rusage_info_v0` for `RUSAGE_INFO_V0` into the pointer
    // it is given, which is valid and aligned for it; the value is read only once it succeeded.
    unsafe {
        let buffer = info.as_mut_ptr().cast::<libc::rusage_info_t>();
        if libc::proc_pid_rusage(libc::getpid(), libc::RUSAGE_INFO_V0, buffer) != 0 {
            return None;
        }
        Some(info.assume_init().ri_phys_footprint)
    }
}

/// The bytes this process holds now, `None` where the kernel does not report them: its resident
/// anonymous pages — `/proc/self/statm`'s resident pages less its shared ones, the kernel's
/// `RssAnon`. The nearest of the physical footprint: what the process itself wrote (the heap, the
/// stacks), not the file pages it maps (its code, its libraries), which the kernel drops and reads
/// back at will and charges no one. The file stays open, read again from its start at every call
/// into a buffer on the stack: a sample costs one read and no allocation.
#[cfg(target_os = "linux")]
pub fn current_bytes() -> Option<u64> {
    use std::os::unix::fs::FileExt;
    static STATM: std::sync::OnceLock<Option<(std::fs::File, u64)>> = std::sync::OnceLock::new();
    let (file, page) = STATM
        .get_or_init(|| {
            let file = std::fs::File::open("/proc/self/statm").ok()?;
            // SAFETY: `sysconf` reads a constant of the system and touches no memory of ours.
            let page = u64::try_from(unsafe { libc::sysconf(libc::_SC_PAGESIZE) }).ok()?;
            Some((file, page))
        })
        .as_ref()?;
    // Seven counts of at most twenty digits each, and their separators.
    let mut buffer = [0u8; 256];
    let read = file.read_at(&mut buffer, 0).ok()?;
    let mut fields = std::str::from_utf8(&buffer[..read])
        .ok()?
        .split_ascii_whitespace();
    let resident: u64 = fields.nth(1)?.parse().ok()?;
    let shared: u64 = fields.next()?.parse().ok()?;
    Some(resident.saturating_sub(shared).saturating_mul(*page))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn current_bytes() -> Option<u64> {
    None
}

/// Has the allocator give back to the system now what it holds freed — the pages this thread
/// holds free, and every range returned to its arenas — rather than after its purge delay, a
/// second: the bytes measured next are those the process still uses, not those of a step it ended.
/// The pages other threads hold free stay theirs until they next collect. Where the allocator is
/// not the binary's (a test), this thread holds nothing of it: nothing is done.
pub fn purge() {
    extern "C" {
        fn mi_collect(force: bool);
    }
    // SAFETY: `mi_collect` takes a flag and touches only the allocator's own state, which it
    // guards for any thread; a thread it never served returns at once.
    unsafe { mi_collect(true) }
}

/// The CPU milliseconds this process has spent, user and system, on every thread since it
/// started: over a stage's wall time, how many cores it kept busy. `None` where the platform does
/// not report it.
#[cfg(unix)]
pub fn cpu_ms() -> Option<f64> {
    let usage = usage()?;
    let ms = |t: libc::timeval| t.tv_sec as f64 * 1000.0 + t.tv_usec as f64 / 1000.0;
    Some(ms(usage.ru_utime) + ms(usage.ru_stime))
}

#[cfg(not(unix))]
pub fn cpu_ms() -> Option<f64> {
    None
}

#[cfg(all(test, unix))]
mod tests {
    // Behaviour: the peak is reported in bytes and follows what the process touched.
    #[test]
    fn peak_grows_with_touched_memory() {
        let before = super::peak_bytes().expect("reported on Unix");
        let touched = vec![1u8; 64 << 20];
        let after = super::peak_bytes().expect("reported on Unix");
        assert!(touched.iter().all(|&b| b == 1));
        assert!(after >= before && after >= 64 << 20, "{before} {after}");
    }
}
