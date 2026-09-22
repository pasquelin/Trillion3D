//! The flat sheet: what the solve does when nothing in the region leaves the plane.
use super::*;
use crate::dag::tests::grid;

/// A flat sheet of `n` by `n` cells at `z = 0`, carrying a unit normal and the texture
/// coordinate `uv` per vertex, simplified to half its triangles. Nothing in it leaves the plane,
/// so whatever the solve then does to a survivor, it does inside that plane. Returns the source
/// positions and attributes beside the region, as the sheet laid them out.
fn flat_sheet(n: usize, uv: &dyn Fn(f32, f32) -> [f32; 2]) -> (Vec<f32>, Vec<f32>, UpdatedRegion) {
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
            &[0.5; 5],
            indices.len() / 3 / 2,
            1.0,
            &|_| 0,
        )
        .expect("simplify")
        .expect("reduced")
    };
    (positions, attributes, region)
}

// Behaviour: on a flat sheet whose attributes follow its plane, the solve has nothing to move.
// Every survivor stays within a ten-thousandth of the region's extent, which is what lets the
// reduction keep the source vertices instead of copying each of them (measured on the displaced
// grid of the test above: 235 survivors of 544 beyond that fraction, 309 within it).
#[test]
fn a_flat_sheet_leaves_every_survivor_where_it_was() {
    let n = 32usize;
    let (positions, attributes, region) = flat_sheet(n, &|x, y| [x / n as f32, y / n as f32]);
    for &local in &region.indices {
        let (l, source) = (local as usize, region.remap[local as usize] as usize);
        let moved = region.displacement(l, &positions[source * 3..source * 3 + 3]);
        assert!(moved <= region.scale * 1e-4, "{moved} at {source}");
        for component in 0..5 {
            let drift = region.attributes[l * 5 + component] - attributes[source * 5 + component];
            assert!(drift.abs() as f64 * 0.5 <= 1e-4, "{drift} at {source}");
        }
    }
}
