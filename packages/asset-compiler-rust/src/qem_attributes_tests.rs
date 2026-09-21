//! The attribute-aware simplifier: what it moves, what it keeps, what it reports.
use super::*;
use crate::dag::tests::grid;

/// A displaced grid with a unit normal and a planar texture coordinate per vertex, gathered
/// as the simplifier reads them: five floats per vertex, normal first.
fn attributed(n: usize) -> (Vec<f32>, Vec<u32>, Vec<f32>) {
    let (positions, indices) = grid(n);
    let count = positions.len() / 3;
    let attributes: Vec<f32> = (0..count)
        .flat_map(|v| {
            let [x, y] = [positions[v * 3], positions[v * 3 + 1]];
            [0.0, 0.0, 1.0, x / n as f32, y / n as f32]
        })
        .collect();
    (positions, indices, attributes)
}
fn simplify(n: usize, flags: &dyn Fn(u32) -> u8) -> Option<UpdatedRegion> {
    let (positions, indices, attributes) = attributed(n);
    let gather = |remap: &[u32]| {
        remap
            .iter()
            .flat_map(|&v| attributes[v as usize * 5..v as usize * 5 + 5].to_vec())
            .collect()
    };
    let target = indices.len() / 3 / 2;
    simplify_region_with_attributes(
        &positions,
        &indices,
        &gather,
        &[0.5, 0.5, 0.5, 0.5, 0.5],
        target,
        1.0,
        flags,
    )
    .expect("simplify")
}

// Behaviour: the region halves, and the survivors it moved carry solved attributes: a texture
// coordinate that still follows the plane it was laid on, within the collapse it absorbed.
#[test]
fn a_region_halves_and_its_moved_survivors_carry_solved_attributes() {
    let region = simplify(32, &|_| 0).expect("reduced");
    assert!(
        region.indices.len() / 3 <= 32 * 32,
        "{} corners",
        region.indices.len()
    );
    assert!(region.error_object > 0.0 && region.error_object.is_finite());
    let (positions, _, _) = attributed(32);
    let mut moved = 0usize;
    for local in region.indices.iter().map(|&l| l as usize) {
        let source = region.remap[local] as usize;
        if region.positions[local * 3..local * 3 + 3] != positions[source * 3..source * 3 + 3] {
            moved += 1;
            let [x, y] = [region.positions[local * 3], region.positions[local * 3 + 1]];
            let [u, v] = [
                region.attributes[local * 5 + 3],
                region.attributes[local * 5 + 4],
            ];
            assert!(
                (u - x / 32.0).abs() < 0.05 && (v - y / 32.0).abs() < 0.05,
                "uv drifted"
            );
        }
    }
    assert!(moved > 0, "the solve moved no survivor");
}

// Behaviour: the displacement of a solved vertex is its object-space distance from the source
// position, and nothing else: a vertex that only changed attributes has none.
#[test]
fn a_displacement_is_the_distance_from_the_source_position() {
    let region = UpdatedRegion {
        indices: vec![0],
        positions: vec![3.0, 4.0, 0.0],
        attributes: vec![1.0, 0.0],
        remap: vec![0],
        error_object: 0.0,
        scale: 1.0,
    };
    let moved = region.displacement(0, &[0.0, 0.0, 0.0]);
    assert!((moved - 5.0).abs() < 1e-9, "{moved}");
    assert_eq!(region.displacement(0, &[3.0, 4.0, 0.0]), 0.0);
}

// Behaviour: a locked vertex is neither moved nor rewritten, so two groups sharing it still meet.
#[test]
fn a_locked_vertex_keeps_its_position_and_attributes() {
    let (positions, _, attributes) = attributed(32);
    let region = simplify(32, &|v| u8::from(v.is_multiple_of(7)) * LOCK).expect("reduced");
    for local in region.indices.iter().map(|&l| l as usize) {
        let source = region.remap[local] as usize;
        if source.is_multiple_of(7) {
            assert_eq!(
                region.positions[local * 3..local * 3 + 3],
                positions[source * 3..source * 3 + 3]
            );
            assert_eq!(
                region.attributes[local * 5..local * 5 + 5],
                attributes[source * 5..source * 5 + 5]
            );
        }
    }
}

// Behaviour: a region already at its target is returned as `None`, never as a rewritten copy.
#[test]
fn a_region_below_its_target_is_left_alone() {
    let (positions, indices, _) = attributed(2);
    let gather = |remap: &[u32]| vec![0.0; remap.len() * 3];
    let out =
        simplify_region_with_attributes(&positions, &indices, &gather, &[0.5; 3], 8, 1.0, &|_| 0)
            .expect("simplify");
    assert!(out.is_none());
}
