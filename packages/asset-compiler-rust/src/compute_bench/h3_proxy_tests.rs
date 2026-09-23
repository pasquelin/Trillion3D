use super::*;

// Lot H3: `stage_proxy` indexes primitives by mesh once, instead of re-reading all
// scene primitives for each retained node. Produced proxy must stay same byte for
// byte — triangles, write order, colors and BVH included.

#[test]
fn the_per_mesh_index_gives_the_same_proxy_as_the_scan() {
    let jeux = jeux::jeux();
    assert!(
        empreinte(&tous(&jeux, reference_stage_proxy)) == empreinte(&tous(&jeux, stage_proxy)),
        "the four sets must give bit-identical proxies"
    );
}

/// At proxy grid step, half-meter cut subdivides into four subtriangles:
/// longest side of triangle mapped to three distinct cells equals at least one diagonal.
const SOUS_TRIANGLES: usize = 4;

/// Uncompiled mesh, primitive without `mesh` field, primitive without cut: all three
/// discarded, two nodes sharing mesh 0 each place their two primitives.
#[test]
fn a_plainly_written_scene_sets_five_cuts_on_both_sides() {
    let (jeu, attendus) = jeux::clair();
    let proxy = stage_proxy(&jeu.inputs()).expect("indexed proxy");
    let reference = reference_stage_proxy(&jeu.inputs()).expect("scanned proxy");
    assert_eq!(proxy.triangle_count(), attendus * SOUS_TRIANGLES);
    assert_eq!(proxy.albedo.len(), attendus * SOUS_TRIANGLES);
    assert!(
        empreinte(&vec![proxy]) == empreinte(&vec![reference]),
        "scene written in the clear"
    );
}
