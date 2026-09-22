//! The flat sheet: the texture a coarse level draws, when the region is a plane under one chart.
use super::*;
use crate::dag::tests::grid;

/// A flat sheet of `n` by `n` cells at `z = 0`, carrying a unit normal and the texture
/// coordinate `uv` per vertex, simplified to half its triangles. Returns the source positions
/// and attributes beside the region, as the sheet laid them out.
fn flat_sheet(n: usize, uv: &dyn Fn(f32, f32) -> [f32; 2]) -> (Vec<f32>, Vec<f32>, SimplifiedMesh) {
    let (mut positions, indices) = grid(n);
    for vertex in positions.as_chunks_mut::<3>().0 {
        vertex[2] = 0.0;
    }
    let attributes: Vec<f32> = positions
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|[x, y, _]| [0.0, 0.0, 1.0].into_iter().chain(uv(*x, *y)))
        .collect();
    let region = {
        let gather = |remap: &[u32]| {
            remap
                .iter()
                .flat_map(|&v| attributes[v as usize * 5..v as usize * 5 + 5].to_vec())
                .collect()
        };
        simplify_region_with_attributes(
            &positions,
            &indices,
            &gather,
            &[1.0, 1.0, 1.0, n as f32, n as f32],
            indices.len() / 3 / 2,
            1.0,
            &|_| 0,
        )
        .expect("simplify")
    };
    (positions, attributes, region)
}

// Behaviour: every vertex a coarse level draws carries the position and the texture coordinate
// the source gave it, so no pattern can slide: the parameterisation of the coarse surface is a
// restriction of the source's, not an interpolation of it (Cohen, Olano & Manocha 1998).
#[test]
fn a_coarse_sheet_draws_the_source_vertices_with_their_own_texture() {
    let n = 32usize;
    let (positions, attributes, region) = flat_sheet(n, &|x, y| [x / n as f32, y / n as f32]);
    assert!(region.triangles > 0 && region.triangles <= n * n);
    for &corner in &region.indices {
        let at = corner as usize;
        let [x, y] = [positions[at * 3], positions[at * 3 + 1]];
        let [u, v] = [attributes[at * 5 + 3], attributes[at * 5 + 4]];
        assert_eq!([u, v], [x / n as f32, y / n as f32], "vertex {at} drifted");
    }
}
