use super::*;

// Lot H3 : `stage_proxy` indexe les primitives par maillage une fois, au lieu de relire toutes les
// primitives de la scène pour chaque nœud retenu. Le proxy produit doit rester le même octet pour
// octet — triangles, ordre d'écriture, couleurs et BVH compris.

#[test]
fn l_index_par_maillage_rend_le_meme_proxy_que_le_balayage() {
    let jeux = jeux::jeux();
    assert!(
        empreinte(&tous(&jeux, reference_stage_proxy)) == empreinte(&tous(&jeux, stage_proxy)),
        "les quatre jeux doivent donner des proxys identiques bit à bit"
    );
}

/// Au pas de la grille du proxy, une coupe d'un demi-mètre se redécoupe en quatre sous-triangles :
/// le plus long côté d'un triangle ramené sur trois mailles distinctes vaut au moins une diagonale.
const SOUS_TRIANGLES: usize = 4;

/// Un maillage non compilé, une primitive sans champ `mesh`, une primitive sans coupe : les trois
/// sont écartées, et les deux nœuds qui partagent le maillage 0 placent chacun ses deux primitives.
#[test]
fn une_scene_ecrite_en_clair_pose_cinq_coupes_des_deux_cotes() {
    let (jeu, attendus) = jeux::clair();
    let proxy = stage_proxy(&jeu.inputs()).expect("proxy indexé");
    let reference = reference_stage_proxy(&jeu.inputs()).expect("proxy balayé");
    assert_eq!(proxy.triangle_count(), attendus * SOUS_TRIANGLES);
    assert_eq!(proxy.albedo.len(), attendus * SOUS_TRIANGLES);
    assert!(
        empreinte(&vec![proxy]) == empreinte(&vec![reference]),
        "scène écrite en clair"
    );
}
