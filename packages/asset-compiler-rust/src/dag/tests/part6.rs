use super::*;

/// `grid` grid exploded into soup: three vertices per triangle, none shared. Form
/// of FBX whose attributes are written corner by corner, on which the simplifier
/// reduces nothing until positions welded.
fn soup(n: usize) -> (Vec<f32>, Vec<u32>) {
    let (positions, indices) = grid(n);
    let mut soup_positions = Vec::with_capacity(indices.len() * 3);
    for &id in &indices {
        soup_positions.extend_from_slice(&positions[id as usize * 3..id as usize * 3 + 3]);
    }
    (soup_positions, (0..indices.len() as u32).collect())
}

// Behavior: vertex soup ascends to single root — the simplifier merges the copies of each position,
// which no weld joins any more.
#[test]
fn a_vertex_soup_still_climbs_to_a_single_root() {
    let (positions, indices) = soup(64);
    let (dag, ..) = build_of(&positions, &indices);
    let depth = dag.iter().map(|c| c.level).max().unwrap_or(0);
    assert!(depth > 0, "soup must have coarse levels");
    assert_eq!(dag.iter().filter(|c| c.is_root()).count(), 1, "single root");
}
