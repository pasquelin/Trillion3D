//! Raw ABI of the deformation reach (`reach.rs`) for the triangles the world deforms at run time:
//! byte offsets into `arena_alloc` reservations, like `wasm_encode.rs`. The answer is held for the
//! loader (`held.rs`): the joint count is known only once measured.

use crate::deform::MAX_SKIN_JOINT;
use crate::held::hold;
use crate::reach::{joint_balls, target_radius};

/// Measures the reach of `vertex_count` rest `positions` (× 3 floats) skinned by `joints` (words)
/// and `weights` (floats), `influences` of each per vertex (0 offsets: no skin), and moved by
/// `target_count` morph targets laid end to end at `targets` (`vertex_count` × 3 floats each).
/// Writes the joint count at `meta` and holds the answer, eight bytes a value: each joint's ball
/// `[x, y, z, radius]`, then each target's radius. 0 measured, 1 for a joint past
/// `MAX_SKIN_JOINT`, the encoder's bound.
///
/// # Safety
/// Every offset must lie in a live `arena_alloc` reservation of the size it states.
#[no_mangle]
pub unsafe extern "C" fn deform_reach(
    positions: u32,
    vertex_count: u32,
    joints: u32,
    weights: u32,
    influences: u32,
    targets: u32,
    target_count: u32,
    meta: u32,
) -> u32 {
    let floats = vertex_count as usize * 3;
    let positions = core::slice::from_raw_parts(positions as *const f32, floats);
    let balls = match (joints, weights) {
        (0, _) | (_, 0) => Vec::new(),
        _ => {
            let entries = vertex_count as usize * influences as usize;
            let joints = core::slice::from_raw_parts(joints as *const u32, entries);
            let weights = core::slice::from_raw_parts(weights as *const f32, entries);
            // The encoder's bound, on every joint a vertex names, weighted or not.
            if joints.iter().any(|&joint| joint > MAX_SKIN_JOINT) {
                return 1;
            }
            joint_balls(positions, joints, weights, influences as usize)
        }
    };
    let radii: Vec<f64> = match target_count {
        0 => Vec::new(),
        count => {
            let all = core::slice::from_raw_parts(targets as *const f32, floats * count as usize);
            (0..count as usize)
                .map(|t| target_radius(&all[t * floats..(t + 1) * floats]))
                .collect()
        }
    };
    *(meta as *mut u32) = balls.len() as u32;
    let values = balls.iter().flatten().copied().chain(radii);
    hold(values.flat_map(f64::to_le_bytes).collect());
    0
}
