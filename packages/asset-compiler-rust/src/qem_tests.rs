use super::*;
const CUBE_POSITIONS: [f32; 24] = [
    0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0., 0., 0., 1., 1., 0., 1., 1., 1., 1., 0., 1., 1.,
];
const CUBE_INDICES: [u32; 36] = [
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3,
    7, 0, 7, 4,
];
#[test]
fn free_vertices_reduce_a_closed_cube() {
    let reduced = simplify_with_locked_vertices(&CUBE_POSITIONS, &CUBE_INDICES, 6, 1.0, &|_| false)
        .expect("cube");
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
#[test]
fn locked_vertices_keep_every_triangle() {
    let kept = simplify_with_locked_vertices(&CUBE_POSITIONS, &CUBE_INDICES, 6, 1.0, &|_| true)
        .expect("cube");
    assert_eq!(kept.triangles, 12);
    assert_eq!(kept.indices, CUBE_INDICES.to_vec());
    assert_eq!(kept.error_object, 0.0);
}
#[test]
fn a_mesh_already_below_the_target_is_returned_untouched() {
    let open = simplify_with_locked_vertices(
        &[0., 0., 0., 1., 0., 0., 0., 1., 0.],
        &[0u32, 1, 2],
        0,
        1.0,
        &|_| false,
    )
    .expect("triangle");
    assert_eq!(open.indices, vec![0, 1, 2]);
    assert_eq!(open.triangles, 1);
}
#[test]
fn malformed_input_is_rejected() {
    assert!(
        simplify_with_locked_vertices(&CUBE_POSITIONS, &[0u32, 1], 1, 1.0, &|_| false).is_err()
    );
    assert!(simplify_with_locked_vertices(&[0., 0.], &CUBE_INDICES, 1, 1.0, &|_| false).is_err());
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
// Lot B4 : compact_region part de la borne connue (pas plus de sommets que de coins ni que le
// maillage n'en porte) au lieu de doubler ses listes en route. Mêmes sorties sur des entrées
// hostiles : maillage vide, un triangle, triangle dégénéré, indices hors des positions.
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
    // Un triangle dégénéré : les trois coins pointent sur le même sommet.
    let indices = [0u32, 0, 0];
    let (compact_pos, compact_idx, remap) = compact_region(&positions, &indices);
    assert_eq!(remap, vec![0]);
    assert_eq!(compact_idx, vec![0, 0, 0]);
    assert_eq!(compact_pos, vec![0., 0., 0.]);
}
#[test]
fn compact_region_falls_back_to_zero_for_an_index_beyond_the_positions() {
    // Le maillage ne porte qu'un sommet, mais l'indice en référence un second : la source garde
    // son identifiant d'origine dans remap, la position manquante devient [0,0,0].
    let positions = [1., 2., 3.];
    let indices = [0u32, 5];
    let (compact_pos, compact_idx, remap) = compact_region(&positions, &indices);
    assert_eq!(remap, vec![0, 5]);
    assert_eq!(compact_idx, vec![0, 1]);
    assert_eq!(&compact_pos[0..3], &[1., 2., 3.]);
    assert_eq!(&compact_pos[3..6], &[0., 0., 0.]);
}
