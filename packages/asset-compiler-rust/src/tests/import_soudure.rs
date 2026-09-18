//! La soudure des sommets à l'import ufbx. Un FBX qui écrit normales et UV coin par coin
//! (`ByPolygonVertex`, `Direct`) donne à chaque coin son propre rang : dédupliqué par rang, un quad
//! sortait à six sommets pour deux triangles, aucun partagé. Dédupliqué par valeur, il en garde
//! quatre — la forme d'un glTF indexé, celle que le simplificateur du DAG sait réduire.
use super::import_opacite::{fbx_fixture, import_of};
use super::*;

#[test]
fn deux_coins_aux_memes_valeurs_sont_un_seul_sommet() {
    let (root, options) = fbx_fixture(false);
    let (gltf, _) = import_of(&options);
    let primitive = &gltf["meshes"][0]["primitives"][0];
    let position = primitive["attributes"]["POSITION"]
        .as_u64()
        .expect("POSITION");
    let indices = primitive["indices"].as_u64().expect("indices");
    assert_eq!(
        gltf["accessors"][position as usize]["count"], 4,
        "un quad plat a quatre sommets, pas un par coin: {primitive}"
    );
    assert_eq!(gltf["accessors"][indices as usize]["count"], 6);
    fs::remove_dir_all(root).expect("nettoyage");
}
