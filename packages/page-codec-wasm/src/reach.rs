//! How far a deformed primitive can move, the one measure of both cuts — the compiler's
//! (`asset-compiler-rust/src/geometry_page_deform/reach.rs`) and the run-time cut's, through the
//! SDK module (`wasm_reach.rs`): the rest-pose ball of the vertices each joint moves, and each
//! morph target's largest displacement. The runtime inflates a deformed cluster's bounds by them,
//! so culling never drops a visible deformed cluster.
use trillion3d_math::aabb::{centre, extend_aabb};
use trillion3d_math::vecn::{length, sub};

/// For each joint up to the highest weighted one, the ball `[x, y, z, radius]` around the box of
/// the rest `positions` it moves with a positive weight; a joint that moves none gives zeros.
/// `joints` and `weights` hold `influences` entries per vertex.
pub fn joint_balls(
    positions: &[f32],
    joints: &[u32],
    weights: &[f32],
    influences: usize,
) -> Vec<[f64; 4]> {
    let mut boxes: Vec<([f64; 3], [f64; 3])> = Vec::new();
    for (v, point) in positions.as_chunks::<3>().0.iter().enumerate() {
        for i in v * influences..(v + 1) * influences {
            if weights[i] <= 0.0 {
                continue;
            }
            let j = joints[i] as usize;
            if boxes.len() <= j {
                boxes.resize(j + 1, ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]));
            }
            let (low, high) = &mut boxes[j];
            extend_aabb(low, high, point.map(f64::from));
        }
    }
    boxes
        .iter()
        .map(|(low, high)| match low[0] <= high[0] {
            true => {
                let centre = centre(*low, *high);
                [centre[0], centre[1], centre[2], length(sub(*high, centre))]
            }
            false => [0.0; 4],
        })
        .collect()
}

/// A morph target's largest displacement: the longest of its `offsets`, three floats a vertex.
pub fn target_radius(offsets: &[f32]) -> f64 {
    offsets
        .as_chunks::<3>()
        .0
        .iter()
        .map(|d| length(d.map(f64::from)))
        .fold(0.0, f64::max)
}
