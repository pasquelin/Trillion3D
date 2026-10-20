//! How far a deformed primitive can move, the one measure of both cuts — the compiler's
//! (`asset-compiler-rust/src/geometry_page_deform/reach.rs`) and the run-time cut's, through the
//! SDK module (`wasm_reach.rs`): the rest-pose ball of the vertices each joint moves, and each
//! morph target's largest displacement. The runtime inflates a deformed cluster's bounds by them,
//! so culling never drops a visible deformed cluster.
use crate::min_ball::point_sphere;
use trillion3d_math::sphere::farthest;

/// For each joint up to the highest weighted one, the smallest ball `[x, y, z, radius]` of the
/// rest `positions` it moves with a positive weight (`point_sphere`, the one sphere of a vertex
/// set); a joint that moves none gives zeros. `joints` and `weights` hold `influences` entries
/// per vertex.
pub fn joint_balls(
    positions: &[f32],
    joints: &[u32],
    weights: &[f32],
    influences: usize,
) -> Vec<[f64; 4]> {
    let mut moved: Vec<Vec<u32>> = Vec::new();
    for v in 0..positions.len() / 3 {
        for i in v * influences..(v + 1) * influences {
            if weights[i] <= 0.0 {
                continue;
            }
            let j = joints[i] as usize;
            if moved.len() <= j {
                moved.resize(j + 1, Vec::new());
            }
            moved[j].push(v as u32);
        }
    }
    moved
        .iter()
        .map(|vertices| match vertices.is_empty() {
            true => [0.0; 4],
            false => point_sphere(positions, vertices),
        })
        .collect()
}

/// A morph target's largest displacement: the longest of its `offsets`, three floats a vertex.
pub fn target_radius(offsets: &[f32]) -> f64 {
    let displacements = offsets.as_chunks::<3>().0.iter();
    farthest([0.0; 3], displacements.map(|d| (d.map(f64::from), 0.0)))
}
