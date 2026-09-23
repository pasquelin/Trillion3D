//! Golden and refusals of the Unity driver: a CC0 project goes through the
//! router, the driver, then the compiler, and the intermediate scene it wrote is
//! compared to `expected.json` — instance count, hierarchy, converted transforms
//! and PBR materials, value by value. The other cases fix what the driver
//! recognises and what it refuses.
use super::*;

/// The CC0 project and its scene, as `tests/fixtures/formats/unity/README.md` describes them.
fn fixture() -> PathBuf {
    golden_dir("unity/cc0-import-project")
        .join("Assets")
        .join("Map.unity")
}

// Behaviour 25: the golden Unity scene goes through the compiler and everything
// the driver drew from it — instances, hierarchy, transforms, materials — is
// compared exactly to expected.json.
#[test]
fn the_unity_scene_matches_its_golden_expected_json() {
    let run = compile_golden_source(&fixture(), "unity");
    assert_eq!(
        unity_digest(&run),
        golden_expected(&golden_dir("unity/cc0-import-project")),
        "fixture unity: the intermediate scene diverges from expected.json"
    );
}

/// What the golden fixes: the driver report, then the intermediate scene itself
/// — each node with its name, converted transform, children and mesh, each
/// material with its PBR factors, and the numbers the compiler kept of it.
fn unity_digest(run: &GoldenRun) -> Value {
    let (mut digest, _, gltf) = scene_digest(run, "unity");
    let triangles: Vec<usize> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .map(|mesh| {
            mesh["primitives"]
                .as_array()
                .expect("primitives")
                .iter()
                .map(|primitive| {
                    let id = primitive["indices"].as_u64().expect("indices") as usize;
                    gltf["accessors"][id]["count"].as_u64().expect("count") as usize / 3
                })
                .sum()
        })
        .collect();
    digest["meshTriangles"] = json!(triangles);
    digest["meshMaterials"] = json!(gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .map(|mesh| mesh["primitives"]
            .as_array()
            .expect("primitives")
            .iter()
            .map(|primitive| primitive["material"].clone())
            .collect::<Vec<Value>>())
        .collect::<Vec<Vec<Value>>>());
    digest["materials"] = gltf["materials"].clone();
    digest["images"] = gltf["images"].clone();
    digest
}
