//! Vertex welding at ufbx import. An FBX that writes normals and UVs corner by
//! corner (`ByPolygonVertex`, `Direct`) gives each corner its own index: deduplicated
//! by index, a quad came out as six vertices for two triangles, none shared.
//! Deduplicated by value, it keeps four — the shape of an indexed glTF, the one
//! the DAG simplifier knows how to reduce.
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
