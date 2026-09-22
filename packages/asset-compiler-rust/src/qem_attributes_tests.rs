//! The attribute-aware simplifier: what it keeps, what it refuses, what it reports.
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
fn simplify(n: usize, flags: &dyn Fn(u32) -> u8) -> SimplifiedMesh {
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
        &[1.0, 1.0, 1.0, 32.0, 32.0],
        target,
        1.0,
        flags,
    )
    .expect("simplify")
}

// Behaviour: the region halves, and every corner it draws is a vertex of the region it was
// given — the collapses land on existing vertices, so no attribute is ever invented.
#[test]
fn a_region_halves_and_draws_source_vertices_alone() {
    let (positions, indices, _) = attributed(32);
    let region = simplify(32, &|_| 0);
    assert!(
        region.triangles <= indices.len() / 3 / 2,
        "{}",
        region.triangles
    );
    assert!(region.error_object > 0.0 && region.error_object.is_finite());
    let source: std::collections::HashSet<u32> = indices.iter().copied().collect();
    assert!(region.indices.iter().all(|corner| source.contains(corner)));
    assert!(
        region
            .indices
            .iter()
            .all(|&c| (c as usize) < positions.len() / 3),
        "a corner outside the buffer"
    );
}

// Behaviour: a locked vertex is never collapsed away, so two groups sharing it still meet.
#[test]
fn a_locked_vertex_survives_the_reduction() {
    let (_, indices, _) = attributed(32);
    let locked = |v: u32| v.is_multiple_of(7);
    let region = simplify(32, &|v| u8::from(locked(v)) * LOCK);
    let drawn: std::collections::HashSet<u32> = region.indices.iter().copied().collect();
    for corner in indices.iter().copied().filter(|&v| locked(v)) {
        assert!(drawn.contains(&corner), "lost the lock on {corner}");
    }
}

// Behaviour: a region already at its target is returned as it came, at error zero, never as a
// rewritten copy.
#[test]
fn a_region_below_its_target_is_left_alone() {
    let (positions, indices, _) = attributed(2);
    let gather = |remap: &[u32]| vec![0.0; remap.len() * 3];
    let out =
        simplify_region_with_attributes(&positions, &indices, &gather, &[1.0; 3], 8, 1.0, &|_| 0)
            .expect("simplify");
    assert_eq!(out.indices, indices);
    assert_eq!(out.error_object, 0.0);
    assert_eq!(out.triangles, indices.len() / 3);
}

// Behaviour: a region whose attribute rows do not match its vertices is refused, never weighed
// against whatever the buffer happened to hold next.
#[test]
fn attributes_that_do_not_match_the_region_are_refused() {
    let (positions, indices, _) = attributed(8);
    let gather = |remap: &[u32]| vec![0.0; remap.len() * 2];
    let error =
        simplify_region_with_attributes(&positions, &indices, &gather, &[1.0; 3], 4, 1.0, &|_| 0)
            .expect_err("refused");
    assert!(error.to_string().contains("Attribute count"));
}
