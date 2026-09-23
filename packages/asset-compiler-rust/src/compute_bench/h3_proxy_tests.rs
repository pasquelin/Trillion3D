use super::*;

// Lot H3: `stage_proxy` indexes primitives by mesh once, instead of re-reading all
// scene primitives for each retained node. Produced proxy must stay same byte for
// byte — triangles, write order, colors and BVH included.

#[test]
fn l_index_par_maillage_rend_le_meme_proxy_que_le_balayage() {
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
fn une_scene_ecrite_en_clair_pose_cinq_coupes_des_deux_cotes() {
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
