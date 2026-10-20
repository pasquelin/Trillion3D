//! Raw ABI of the deformation reach (`../cut/reach.rs`) for the triangles the world deforms at run time:
//! byte offsets into `arena_alloc` reservations, like `encode.rs`. The answer is held for the
//! loader (`held.rs`): the joint count is known only once measured.

use crate::cut::reach::{joint_balls, target_radius};
use crate::deform::MAX_SKIN_JOINT;
use crate::wasm::held::hold;
use crate::wasm::math::view;

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
    let positions = view(positions, floats);
    let balls = match (joints, weights) {
        (0, _) | (_, 0) => Vec::new(),
        _ => {
            let entries = vertex_count as usize * influences as usize;
            let joints: &[u32] = view(joints, entries);
            let weights = view(weights, entries);
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
            let all: &[f32] = view(targets, floats * count as usize);
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
