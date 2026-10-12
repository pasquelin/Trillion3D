//! The proxy of a cut (`cut_columns`): a closed shape keeps its triangles and every one is found
//! again through its nodes; a mesh over the budget is snapped to a grid that holds it, never subdivided.
use super::*;

/// The triangles of a unit cube's twelve faces, on eight vertices.
fn cube() -> (Vec<u32>, Vec<f32>) {
    let positions: Vec<f32> = (0..8)
        .flat_map(|v| [(v & 1) as f32, ((v >> 1) & 1) as f32, ((v >> 2) & 1) as f32])
        .collect();
    let indices = vec![
        0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6,
        1, 3, 5, 3, 7, 5,
    ];
    (indices, positions)
}

#[test]
fn a_cube_keeps_its_twelve_triangles_in_a_tree_that_holds_them() {
    let (indices, positions) = cube();
    let cut = cut_columns(&indices, &positions);
    assert_eq!(cut.triangles.len(), 12 * PROXY_TRIANGLE_FLOATS);
    assert_eq!(cut.albedo, vec![0xffff_ffff; 12]);
    assert_eq!(
        cut.node_bounds.len() / PROXY_NODE_FLOATS,
        cut.node_children.len() / PROXY_NODE_WORDS
    );
    assert!(!cut.node_children.is_empty());
    // The root's bounds are the cube's.
    assert_eq!(&cut.node_bounds[..6], &[0.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
}

#[test]
fn a_mesh_over_the_budget_is_snapped_not_subdivided() {
    // A grid of 200 × 200 quads: 80 000 triangles, over `PROXY_CUT_TRIANGLES`.
    let side = 201usize;
    let positions: Vec<f32> = (0..side * side)
        .flat_map(|i| [(i % side) as f32, 0.0, (i / side) as f32])
        .collect();
    let mut indices = Vec::new();
    for y in 0..side - 1 {
        for x in 0..side - 1 {
            let a = (y * side + x) as u32;
            let (b, c, d) = (a + 1, a + side as u32, a + side as u32 + 1);
            indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    let cut = cut_columns(&indices, &positions);
    let count = cut.triangles.len() / PROXY_TRIANGLE_FLOATS;
    assert!(count <= PROXY_CUT_TRIANGLES, "{count} triangles");
    assert!(count > 0);
    assert!(cut.cell > 200.0 * PROXY_CUT_CELL_SHARE);
}
