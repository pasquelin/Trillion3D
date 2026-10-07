//! Peak resident memory of the compiler process, as the kernel reports it.
//!
//! It is the high-water mark of the whole process since it started: every progress event
//! carries it, so the first event whose value jumps names the stage that raised the peak. In a
//! batch that runs several jobs at once, the mark is shared by all of them. It is read, never
//! used to decide anything: budgets stay fixed.

/// Peak resident bytes of this process, `None` where the platform does not report it.
#[cfg(unix)]
pub fn peak_bytes() -> Option<u64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: `getrusage` writes one `rusage` into the pointer it is given, which is valid and
    // aligned for it; the value is read only once the call has succeeded.
    let usage = unsafe {
        if libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) != 0 {
            return None;
        }
        usage.assume_init()
    };
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
