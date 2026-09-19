//! Raw ABI of the shared buffer and the calculation batches: no `wasm-bindgen`, only integers and
//! byte offsets in linear memory, like `wasm.rs` for the page decoder.
//!
//! The buffer is allocated here as `f64`, so it is eight-byte aligned: JavaScript can overlay
//! `Float64Array`, `Float32Array` or `Uint32Array` views at will. Nothing is copied on the
//! calculation path — both sides read and write the same memory. A reservation may grow linear
//! memory and invalidate every view: that is the only moment it happens, and the JavaScript loader
//! rebuilds its views there and nowhere else.

use crate::math::{box_transform_batch, multiply_matrix4_batch, BOX_VALUES, MATRIX_VALUES};
use crate::math_hierarchy::{hierarchy_update_batch, POSITION_VALUES, QUATERNION_VALUES};
use crate::wasm::{fuite, rends};

/// Version of this ABI's contract. The loader refuses a module that does not return the one it expects.
const CONTRACT: u32 = 1;
/// Bytes of an `f64`: the buffer is counted in words of this size.
const WORD: usize = 8;
/// Ceiling of a reservation, in bytes. Beyond it, the request is refused rather than honoured with
/// linear memory the host could no longer return: an engine calculation batch does not weigh a
/// gigabyte, and a size like that comes from a wrong count, not from a scene.
const MAX_BYTES: usize = 1 << 30;

/// The contract version this module honours.
#[no_mangle]
pub extern "C" fn math_contract() -> u32 {
    CONTRACT
}

/// 1 if the module was compiled with `simd128`, 0 otherwise. The bits do not change with it:
/// vectorising independent f64 lanes is correctly rounded lane by lane, like the scalar, and
/// WebAssembly has no fused instruction that could change the rounding.
#[no_mangle]
pub extern "C" fn math_simd() -> u32 {
    u32::from(cfg!(target_feature = "simd128"))
}

/// Reserves `bytes` zeroed bytes, eight-byte aligned. Returns 0 if the size is absurd.
#[no_mangle]
pub extern "C" fn arena_alloc(bytes: usize) -> u32 {
    if bytes == 0 || bytes > MAX_BYTES {
        return 0;
    }
    fuite(vec![0f64; bytes.div_ceil(WORD)])
}

/// Releases an `arena_alloc` reservation.
///
/// # Safety
/// `offset` must come from `arena_alloc` with this same `bytes`, and must not already have been released.
#[no_mangle]
pub unsafe extern "C" fn arena_free(offset: u32, bytes: usize) {
    rends::<f64>(offset, bytes.div_ceil(WORD));
}

/// `n` boxes transformed by `n` matrices. The three offsets are bytes, eight-byte aligned.
///
/// # Safety
/// The three ranges must fit in live `arena_alloc` reservations, be disjoint, and hold
/// `6 · n`, `6 · n` and `16 · n` floats respectively.
#[no_mangle]
pub unsafe extern "C" fn math_box_transform_batch(out: u32, boxes: u32, mats: u32, n: usize) {
    box_transform_batch(
        core::slice::from_raw_parts_mut(out as *mut f64, n * BOX_VALUES),
        core::slice::from_raw_parts(boxes as *const f64, n * BOX_VALUES),
        core::slice::from_raw_parts(mats as *const f64, n * MATRIX_VALUES),
        n,
    );
}

/// `n` products `out[i] = a[i] · b[i]`. The three offsets are bytes, eight-byte aligned.
///
/// # Safety
/// The three ranges must fit in live `arena_alloc` reservations, be disjoint, and each hold
/// `16 · n` floats.
#[no_mangle]
pub unsafe extern "C" fn math_multiply_matrix4_batch(out: u32, a: u32, b: u32, n: usize) {
    let values = n * MATRIX_VALUES;
    multiply_matrix4_batch(
        core::slice::from_raw_parts_mut(out as *mut f64, values),
        core::slice::from_raw_parts(a as *const f64, values),
        core::slice::from_raw_parts(b as *const f64, values),
        n,
    );
}

/// The whole hierarchy: `n` nodes ordered parents before children. Offsets are bytes, eight-byte
/// aligned, except `parents`, which holds `n` 32-bit words aligned on four.
///
/// # Safety
/// The five ranges must fit in live `arena_alloc` reservations, be disjoint, and hold
/// `16 · n`, `3 · n`, `4 · n` and `3 · n` floats respectively, then `n` integers.
#[no_mangle]
pub unsafe extern "C" fn math_hierarchy_update_batch(
    world: u32,
    positions: u32,
    rotations: u32,
    scales: u32,
    parents: u32,
    n: usize,
) {
    hierarchy_update_batch(
        core::slice::from_raw_parts_mut(world as *mut f64, n * MATRIX_VALUES),
        core::slice::from_raw_parts(positions as *const f64, n * POSITION_VALUES),
        core::slice::from_raw_parts(rotations as *const f64, n * QUATERNION_VALUES),
        core::slice::from_raw_parts(scales as *const f64, n * POSITION_VALUES),
        core::slice::from_raw_parts(parents as *const u32, n),
        n,
    );
}
