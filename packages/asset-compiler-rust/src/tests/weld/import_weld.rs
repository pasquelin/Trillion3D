//! Vertex welding at ufbx import. An FBX that writes normals and UVs corner by
//! corner (`ByPolygonVertex`, `Direct`) gives each corner its own index: deduplicated
//! by index, a quad came out as six vertices for two triangles, none shared.
//! Deduplicated by value, it keeps four — the shape of an indexed glTF, the one
//! the DAG simplifier knows how to reduce.
use super::*;
use crate::tests::formats::import_opacity::{fbx_fixture, import_of};

#[test]
fn two_corners_with_equal_values_are_one_vertex() {
    let (root, options) = fbx_fixture(false);
    let (gltf, _) = import_of(&options);
    let primitive = &gltf["meshes"][0]["primitives"][0];
    let position = primitive["attributes"]["POSITION"]
        .as_u64()
        .expect("POSITION");
    let indices = primitive["indices"].as_u64().expect("indices");
    assert_eq!(
        gltf["accessors"][position as usize]["count"], 4,
        "a flat quad has four vertices, not one per corner: {primitive}"
    );
    assert_eq!(gltf["accessors"][indices as usize]["count"], 6);
    fs::remove_dir_all(root).expect("cleanup");
}
