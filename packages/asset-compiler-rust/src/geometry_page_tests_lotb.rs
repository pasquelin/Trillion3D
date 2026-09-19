use super::*;

// Lot B5: localise starts from known bound (page carries at most 65,535 vertices and
// no more corners than indices) instead of resizing corner by corner. Same renumbering on
// hostile inputs: empty page, duplicate vertices, out of bounds index, limit 65,535.

#[test]
fn localise_on_empty_indices_returns_empty_lists() {
    let (original, local) = localise(&[], 0).expect("empty page");
    assert!(original.is_empty());
    assert!(local.is_empty());
}

#[test]
fn localise_deduplicates_repeated_vertices_in_first_seen_order() {
    let (original, local) = localise(&[5, 2, 5, 2, 5], 6).expect("localise");
    assert_eq!(original, vec![5, 2], "premier vu d'abord");
    assert_eq!(local, vec![0, 1, 0, 1, 0]);
}

#[test]
fn localise_rejects_an_index_that_exceeds_the_declared_vertex_count() {
    let error = localise(&[0, 1, 3], 3).unwrap_err();
    assert_eq!(error.code, "INVALID_PAGE");
}

#[test]
fn localise_uses_the_declared_vertex_count_not_a_positions_buffer() {
    // `vertices` is localise parameter, decoupled from positions.len()/3: index
    // valid for declared bound passes even beyond usual mesh size.
    let (original, local) = localise(&[999], 1000).expect("declared bound");
    assert_eq!(original, vec![999]);
    assert_eq!(local, vec![0]);
}

#[test]
fn localise_accepts_exactly_sixty_five_thousand_five_hundred_thirty_five_vertices() {
    let indices: Vec<u32> = (0..65_535).collect();
    let (original, local) = localise(&indices, 65_535).expect("limite exacte");
    assert_eq!(original.len(), 65_535);
    assert_eq!(*local.last().unwrap(), 65_534);
}

#[test]
fn localise_rejects_one_vertex_past_the_sixty_five_thousand_five_hundred_thirty_five_limit() {
    let indices: Vec<u32> = (0..65_536).collect();
    let error = localise(&indices, 65_536).unwrap_err();
    assert_eq!(error.code, "PAGE_VERTEX_LIMIT");
}
