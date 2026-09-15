//! Doré et refus du pilote Unity : un projet CC0 passe par le routeur, le pilote, puis le
//! compilateur, et la scène intermédiaire qu'il a écrite est comparée à `expected.json` — nombre
//! d'instances, hiérarchie, transformations converties et matériaux PBR, valeur par valeur. Les
//! autres cas fixent ce que le pilote reconnaît et ce qu'il refuse.
use super::*;

/// Le projet CC0 et sa scène, tels que `fixtures/unity/README.md` les décrit.
fn fixture() -> PathBuf {
    golden_dir("unity/cc0-import-project")
        .join("Assets")
        .join("Map.unity")
}

// Comportement 25 : la scène Unity dorée passe par le compilateur et tout ce que le pilote en a
// tiré — instances, hiérarchie, transformations, matériaux — est comparé exactement à expected.json.
#[test]
fn the_unity_scene_matches_its_golden_expected_json() {
    let run = compile_golden_source(&fixture(), "unity");
    assert_eq!(
        unity_digest(&run),
        golden_expected(&golden_dir("unity/cc0-import-project")),
        "fixture unity: la scène intermédiaire diverge de expected.json"
    );
}

/// Ce que la dorée fixe : le rapport du pilote, puis la scène intermédiaire elle-même — chaque
/// nœud avec son nom, sa transformation convertie, ses enfants et son maillage, chaque matériau
/// avec ses facteurs PBR, et les nombres que le compilateur en a retenus.
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
