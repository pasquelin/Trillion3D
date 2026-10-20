//! Resident memory — the peak and the current — and CPU time of the compiler process, as the
//! kernel reports them.
//!
//! The peak is the high-water mark of the whole process since it started: every progress event
//! carries it, so the first event whose value jumps names the stage that raised the peak. In a
//! batch that runs several jobs at once, both marks are shared by all of them. The current one is
//! what an admission measured on memory reads (`compiler_budget::admission`).

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

/// The bytes this process holds resident now, `None` where the platform does not report it.
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
        Some(info.assume_init().ri_resident_size)
    }
}

/// The bytes this process holds resident now: the second field of `/proc/self/statm`, in pages.
#[cfg(target_os = "linux")]
pub fn current_bytes() -> Option<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    // SAFETY: `sysconf` reads a constant of the system and touches no memory of ours.
    let page = u64::try_from(unsafe { libc::sysconf(libc::_SC_PAGESIZE) }).ok()?;
    Some(pages.saturating_mul(page))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn current_bytes() -> Option<u64> {
    None
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
