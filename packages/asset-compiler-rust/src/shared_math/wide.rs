//! The hot loops' instruction set, chosen at run time (#1352).
//!
//! An x86-64 build keeps its baseline, SSE2, so that it starts on every x86-64 processor; a loop
//! run through [`wide`] is compiled a second time for AVX2 and takes that copy where the processor
//! has it. The bytes are the same either way: AVX2 widens the vectors, never the arithmetic —
//! each lane rounds as the scalar operation would, the order of a sum or a fold is kept (Rust
//! never reorders floating-point operations), and fused multiply-add is a separate feature this
//! module never enables. Elsewhere [`wide`] is a plain call.

/// Runs `kernel` compiled for AVX2 when the x86-64 processor running the compiler has it, else
/// for the baseline. The kernel and what it calls must be inlined into it (`#[inline(always)]`)
/// to be compiled for AVX2 too; the processor is asked once, the answer cached by `std`.
#[inline(always)]
pub(crate) fn wide<R>(kernel: impl FnOnce() -> R) -> R {
    #[cfg(target_arch = "x86_64")]
    if std::arch::is_x86_feature_detected!("avx2") {
        // SAFETY: the processor running this code has AVX2, checked just above.
        return unsafe { avx2(kernel) };
    }
    kernel()
}

/// The AVX2 copy of a kernel: the closure is inlined here and compiled with the feature.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn avx2<R>(kernel: impl FnOnce() -> R) -> R {
    kernel()
}
