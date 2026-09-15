use super::*;

// Lot B5 : localise part de la borne connue (une page ne porte jamais plus de 65 535 sommets ni
// plus de coins que d'indices) au lieu de redimensionner coin par coin. Même renumérotation sur
// des entrées hostiles : page vide, sommets dupliqués, index hors bornes, limite à 65 535.

#[test]
fn localise_on_empty_indices_returns_empty_lists() {
    let (original, local) = localise(&[], 0).expect("page vide");
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
    // `vertices` est un paramètre propre à localise, découplé de positions.len()/3 : un indice
    // valide pour la borne déclarée passe même très au-delà d'une taille de maillage habituelle.
    let (original, local) = localise(&[999], 1000).expect("borne déclarée");
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
