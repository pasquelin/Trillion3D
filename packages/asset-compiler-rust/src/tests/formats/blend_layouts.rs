//! One scene, saved by three generations of Blender that each store a mesh their own way —
//! `MVert`/`MPoly`/`MLoop` structures (3.3), named `CustomData` layers (4.4), the attribute store
//! (5.2) —, cooks to the same scene. The fixtures are described in `tests/fixtures/formats/README.md`
//! § "layouts".
use super::blend_driver::{converted, scene_gltf};
use super::*;

const VERSIONS: [&str; 3] = ["3.3", "4.4", "5.2"];

/// The values of an accessor, as the little-endian words the binary carries; none when the
/// primitive has no such attribute.
fn words(gltf: &Value, bin: &[u8], accessor: &Value) -> Vec<u32> {
    let Some(rank) = accessor.as_u64() else {
        return Vec::new();
    };
    let (bytes, _) = crate::tests::ngons::accessor(gltf, bin, rank as usize);
    let words = bytes.as_chunks::<4>().0;
    words.iter().map(|word| u32::from_le_bytes(*word)).collect()
}

/// What the scene of one fixture comes out as: each node with its mesh and matrix, each primitive
/// with its material, triangles, positions, normals and UVs, bit for bit.
fn digest(version: &str) -> Value {
    let source = golden_dir("blend/layouts").join(format!("blender-{version}.blend"));
    let cache = scratch("blend", &format!("layouts-{version}"));
    let directory = converted(&source, &cache);
    let gltf = scene_gltf(&directory);
    let bin = fs::read(directory.join("model.bin")).expect("model.bin");
    let meshes: Vec<Value> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .map(|mesh| {
            let primitives: Vec<Value> = mesh["primitives"]
                .as_array()
                .expect("primitives")
                .iter()
                .map(|primitive| {
                    let attributes = &primitive["attributes"];
                    json!({
                        "material": primitive["material"],
                        "indices": words(&gltf, &bin, &primitive["indices"]),
                        "positions": words(&gltf, &bin, &attributes["POSITION"]),
                        "normals": words(&gltf, &bin, &attributes["NORMAL"]),
                        "uvs": words(&gltf, &bin, &attributes["TEXCOORD_0"]),
                    })
                })
                .collect();
            json!({ "name": mesh["name"], "primitives": primitives })
        })
        .collect();
    fs::remove_dir_all(cache).expect("cleanup");
    // The root node is named after the file, which differs by version.
    let mut nodes = gltf["nodes"].clone();
    nodes[0]["name"] = Value::Null;
    json!({ "nodes": nodes, "meshes": meshes })
}

// Behaviour: a mesh saved by Blender 3.3, 4.4 or 5.2 cooks through the one mesh path to the same
// triangles, normals, UVs and instances — the layout is read from the file's SDNA, not guessed.
#[test]
fn one_scene_saved_by_three_blender_generations_cooks_the_same() {
    let reference = digest(VERSIONS[2]);
    let nodes = reference["nodes"].as_array().expect("nodes");
    let names: Vec<&str> = nodes
        .iter()
        .skip(1)
        .map(|node| node["name"].as_str().unwrap_or_default())
        .collect();
    assert_eq!(names, ["CubeA", "CubeB", "Ngon"], "{reference}");
    assert_eq!(
        nodes[1]["mesh"], nodes[2]["mesh"],
        "the two cubes are instances of one mesh"
    );
    let triangles: usize = reference["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .flat_map(|mesh| mesh["primitives"].as_array().expect("primitives"))
        .map(|primitive| primitive["indices"].as_array().expect("indices").len() / 3)
        .sum();
    assert_eq!(triangles, 12 + 3, "six quads, and a pentagon cut in three");
    for version in &VERSIONS[..2] {
        assert_eq!(
            digest(version),
            reference,
            "Blender {version} against Blender 5.2"
        );
    }
}
