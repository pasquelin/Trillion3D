#[cfg(test)]
pub(crate) mod attributes;
use super::*;

/// What a simplification kept, in the source numbering: the tests' reading of `region::Region`.
pub(crate) struct Kept {
    pub indices: Vec<u32>,
    pub error_object: f64,
    pub triangles: usize,
}

/// `positions` and `indices` simplified towards `target` triangles by the one region simplifier:
/// what it kept.
pub(crate) fn simplify(
    positions: &[f32],
    attributes: &[Attribute],
    indices: &[u32],
    target: usize,
    locked: &dyn Fn(u32) -> bool,
) -> crate::Result<Kept> {
    let area = super::region::surface_area(positions, indices);
    let rules = SolveRules::default();
    let region = super::region::Region::of(positions, attributes, locked, indices, area, rules)?;
    let solved = region.solve_from(&mut None, target);
    Ok(Kept {
        indices: (solved.indices.iter())
            .map(|&i| solved.region.remap[i as usize])
            .collect(),
        error_object: solved.error_object,
        triangles: solved.indices.len() / 3,
    })
}
pub(crate) const CUBE_POSITIONS: [f32; 24] = [
    0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0., 0., 0., 1., 1., 0., 1., 1., 1., 1., 0., 1., 1.,
];
pub(crate) const CUBE_INDICES: [u32; 36] = [
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3,
    7, 0, 7, 4,
];
#[test]
fn free_vertices_reduce_a_closed_cube() {
    let reduced = simplify(&CUBE_POSITIONS, &[], &CUBE_INDICES, 6, &|_| false).expect("cube");
    assert!(
        reduced.triangles < 12,
        "expected a reduction, got {}",
        reduced.triangles
    );
    assert!(reduced.error_object >= 0.0 && reduced.error_object.is_finite());
    assert_eq!(reduced.indices.len(), reduced.triangles * 3);
    assert!(
        reduced
            .indices
            .iter()
            .all(|&id| (id as usize) < CUBE_POSITIONS.len() / 3),
        "indices stay in the source buffer"
    );
}
// Behaviour: a lock is a price, not a wall: a cube locked everywhere still reduces as a free one
// does, every merge it makes priced past any merge the free cube makes.
#[test]
fn locked_vertices_reduce_last_and_cost_more() {
    let free = simplify(&CUBE_POSITIONS, &[], &CUBE_INDICES, 6, &|_| false).expect("cube");
    let locked = simplify(&CUBE_POSITIONS, &[], &CUBE_INDICES, 6, &|_| true).expect("cube");
    assert!(locked.triangles < 12, "{} triangles", locked.triangles);
    assert!(
        locked.error_object > free.error_object,
        "locked {} over free {}",
        locked.error_object,
        free.error_object
    );
}
#[test]
fn a_mesh_already_below_the_target_is_returned_untouched() {
    let open = simplify(
        &[0., 0., 0., 1., 0., 0., 0., 1., 0.],
        &[],
        &[0u32, 1, 2],
        0,
        &|_| false,
    )
    .expect("triangle");
    assert_eq!(open.indices, vec![0, 1, 2]);
    assert_eq!(open.triangles, 1);
}
#[test]
fn malformed_input_is_rejected() {
    assert!(simplify(&CUBE_POSITIONS, &[], &[0u32, 1], 1, &|_| false).is_err());
    assert!(simplify(&[0., 0.], &[], &CUBE_INDICES, 1, &|_| false).is_err());
}
#[test]
fn compact_region_renumbers_each_vertex_once_and_maps_back() {
    for positions in [CUBE_POSITIONS.to_vec(), {
        let mut wide = CUBE_POSITIONS.to_vec();
        wide.extend(std::iter::repeat_n(0.0, 3 * 4096));
        wide
    }] {
        let (compact_pos, compact_idx, remap) = compact_region(&positions, &CUBE_INDICES);
        assert_eq!(compact_pos.len(), remap.len() * 3);
        assert_eq!(compact_idx.len(), CUBE_INDICES.len());
        assert_eq!(remap.len(), 8);
        for (local, &source) in compact_idx.iter().zip(CUBE_INDICES.iter()) {
            assert_eq!(remap[*local as usize], source);
        }
    }
}
// Lot B4: compact_region starts from known bound (no more vertices than corners or
// mesh carries) instead of doubling lists en route. Same outputs on hostile
// inputs: empty mesh, one triangle, degenerate triangle, out-of-bounds indices.
#[test]
fn compact_region_on_an_empty_mesh_returns_empty_lists() {
    let (positions, indices, remap) = compact_region(&[], &[]);
    assert!(positions.is_empty());
    assert!(indices.is_empty());
    assert!(remap.is_empty());
}
#[test]
fn compact_region_on_a_single_triangle_keeps_every_vertex_once() {
    let positions = [0., 0., 0., 1., 0., 0., 0., 1., 0.];
    let indices = [0u32, 1, 2];
    let (compact_pos, compact_idx, remap) = compact_region(&positions, &indices);
    assert_eq!(remap, vec![0, 1, 2]);
    assert_eq!(compact_idx, vec![0, 1, 2]);
    assert_eq!(compact_pos, positions.to_vec());
}
#[test]
fn compact_region_on_a_degenerate_triangle_renumbers_the_repeated_vertex_once() {
    let positions = [0., 0., 0., 1., 0., 0., 0., 1., 0.];
    // Degenerate triangle: three corners point to same vertex.
    let indices = [0u32, 0, 0];
    let (compact_pos, compact_idx, remap) = compact_region(&positions, &indices);
    assert_eq!(remap, vec![0]);
    assert_eq!(compact_idx, vec![0, 0, 0]);
    assert_eq!(compact_pos, vec![0., 0., 0.]);
}
#[test]
fn compact_region_falls_back_to_zero_for_an_index_beyond_the_positions() {
    // Mesh carries single vertex, index references second: source retains
    // original id in remap, missing position becomes [0,0,0].
    let positions = [1., 2., 3.];
    let indices = [0u32, 5];
    let (compact_pos, compact_idx, remap) = compact_region(&positions, &indices);
    assert_eq!(remap, vec![0, 5]);
    assert_eq!(compact_idx, vec![0, 1]);
    assert_eq!(&compact_pos[0..3], &[1., 2., 3.]);
    assert_eq!(&compact_pos[3..6], &[0., 0., 0.]);
}
// Behaviour: a stand-in solve (`Region::solve_to`) stops at the first collapse that costs its
// error or at its limit of triangles, whichever comes first, and never under 64 triangles on a
// sheet this size; the collapses are the same whatever the error, so a larger error never leaves
// more triangles.
#[test]
fn a_stand_in_stops_at_its_error_or_at_its_limit() {
    let (n, limit) = (40, 256);
    let w = n + 1;
    let positions: Vec<f32> = (0..w * w)
        .flat_map(|k| {
            let (x, y) = ((k % w) as f32, (k / w) as f32);
            [x, y, (x * 0.31).sin() * (y * 0.27).cos() * 2.0]
        })
        .collect();
    let indices = crate::tests::fixtures::grid_indices(n, n, |x, y| (y * w + x) as u32);
    let area = super::region::surface_area(&positions, &indices);
    let rules = SolveRules::default();
    let region = super::region::Region::of(&positions, &[], &|_| false, &indices, area, rules)
        .expect("sheet");
    let source = indices.len() / 3;
    let mut previous = source;
    for error in [0.01_f32, 0.1, 1.0, 100.0] {
        let solved = region.solve_to((source, error), limit);
        let kept = solved.indices.len() / 3;
        assert!(kept < source, "error {error}: {kept} of {source} triangles");
        assert!(
            kept <= limit || solved.error_object >= f64::from(error) * 0.999,
            "error {error}: {kept} triangles over the limit at {}",
            solved.error_object
        );
        assert!(kept >= 64, "error {error}: {kept} triangles");
        assert!(kept <= previous, "error {error}: {kept} over {previous}");
        previous = kept;
    }
}
#[test]
fn a_stand_in_of_a_region_within_its_limit_is_the_region() {
    let region = super::region::Region::of(
        &CUBE_POSITIONS,
        &[],
        &|_| false,
        &CUBE_INDICES,
        6.0,
        SolveRules::default(),
    )
    .expect("cube");
    let solved = region.solve_to((12, 1.0), 12);
    assert_eq!(solved.indices, region.compact);
    assert_eq!(solved.error_object, 0.0);
}
// Behaviour: a vertex a collapse puts onto a locked one lies at the locked vertex's exact bits, as
// the welds by position read them: the frame's hundred-fold does not divide back exactly, so a
// position is never brought back from the frame where a source vertex lies. A flat hexagon on a
// 0.1 grid, its centre free and its rim locked: the first collapse takes the centre to a rim vertex.
#[test]
fn a_vertex_collapsed_onto_a_locked_one_returns_its_exact_position() {
    let rim = [(18, 0), (9, 18), (-9, 18), (-18, 0), (-9, -18), (9, -18)];
    let mut positions = vec![0.0_f32; 3];
    for (x, y) in rim {
        positions.extend([x as f32 * 0.1, y as f32 * 0.1, 0.0]);
    }
    assert!(
        positions
            .iter()
            .all(|&x| x == 0.0 || x * 100.0 / 100.0 != x),
        "every rim coordinate is one a hundred-fold does not give back"
    );
    let indices = [0u32, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 1];
    let area = super::region::surface_area(&positions, &indices);
    let region = super::region::Region::of(
        &positions,
        &[],
        &|v| v != 0,
        &indices,
        area,
        SolveRules::default(),
    )
    .expect("hexagon");
    let solved = region.solve_from(&mut None, 4);
    assert_eq!(solved.indices.len() / 3, 4);
    assert!(
        solved.indices.iter().any(|&v| solved.moved(v as usize)),
        "the free centre went onto a rim vertex"
    );
    let bits = |positions: &[f32], v: usize| [0, 1, 2].map(|a| positions[v * 3 + a].to_bits());
    for &v in &solved.indices {
        let at = bits(&solved.positions, v as usize);
        assert!(
            (0..region.remap.len()).any(|u| bits(&region.source, u) == at),
            "vertex {v} is at no source position, bit for bit"
        );
    }
}
