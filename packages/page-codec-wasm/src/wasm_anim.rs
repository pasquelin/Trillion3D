//! Raw ABI of the animation sampler (`anim.rs`): byte offsets in linear memory, as `wasm_math.rs`.

use crate::anim::{sample_tracks, ARC_VALUES, TRACK_WORDS};

/// Samples the `n` tracks described at `tracks` at time `t`, from the packed `data` (`data_len`
/// floats), keeping each track's key at `keys` and arc at `arcs`, its numbers written at `out`
/// (`out_len` floats).
///
/// # Safety
/// Every range must fit in live `arena_alloc` reservations: `tracks` holds `TRACK_WORDS · n`
/// words, `keys` `n` words, `arcs` `ARC_VALUES · n` floats, and each track's times, values and
/// output fall inside `data_len` and `out_len`; `out`, `keys` and `arcs` are disjoint from the rest.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn anim_sample_tracks(
    tracks: u32,
    n: usize,
    data: u32,
    data_len: usize,
    keys: u32,
    arcs: u32,
    out: u32,
    out_len: usize,
    t: f64,
) {
    sample_tracks(
        core::slice::from_raw_parts(tracks as *const u32, n * TRACK_WORDS),
        core::slice::from_raw_parts(data as *const f32, data_len),
        core::slice::from_raw_parts_mut(keys as *mut u32, n),
        core::slice::from_raw_parts_mut(arcs as *mut f64, n * ARC_VALUES),
        core::slice::from_raw_parts_mut(out as *mut f64, out_len),
        t,
    );
}
