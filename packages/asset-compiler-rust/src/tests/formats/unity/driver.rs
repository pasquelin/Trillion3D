//! What the Unity driver recognises and what it refuses. The golden scene is in
//! `golden.rs`: here only the inputs that yield no scene are fixed.
use super::*;
use plugins::scene::{route, PreparedScene, Routed, SceneRequest};

/// Passes the source through the router then the driver it picks, as the compiler does.
fn prepare(source: &Path, cache: &Path) -> std::result::Result<PathBuf, (&'static str, String)> {
    let prepared = match route(source).map_err(|error| (error.code, error.message))? {
        Routed::Driver(plugin, inputs) => {
            assert_eq!(plugin.name(), "unity", "{}", source.display());
            plugin.prepare(&SceneRequest {
                source,
                inputs: &inputs,
                cache,
                cancelled: &AtomicBool::new(false),
                progress: &|_| {},
            })
        }
        Routed::Manifest => panic!("routed to the manifest"),
    };
    match prepared.map_err(|error| (error.code, error.message))? {
        PreparedScene::Converted { directory, .. } => Ok(directory),
        _ => panic!("the unity plugin always converts"),
    }
}

/// Header the editor writes at the start of every serialised file.
const HEAD: &[u8] = b"%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n";

// Behaviour 26: a truncated `.unity` carries no document. The driver refuses it
// with a code, without panicking or unbounded allocation — the `limites` fixture
// is the 31-byte file.
#[test]
fn a_truncated_unity_file_is_refused_with_a_code() {
    let cache = scratch("unity", "truncated");
    let source = golden_dir("unity/limites").join("truncated.unity");
    let (code, message) = prepare(&source, &cache).expect_err("a truncated scene is refused");
    assert_eq!(code, "IMPORT_ERROR");
    assert!(message.contains("truncated.unity"), "{message}");
    fs::remove_dir_all(cache).expect("cleanup");
}

// Behaviour 27: several scenes in one directory is an ambiguity. The driver names
// them and asks that one be designated, rather than picking one in the caller's place.
#[test]
fn several_scenes_in_one_directory_are_refused_and_named() {
    let dir = scratch("unity", "scenes");
    fs::write(dir.join("Map.unity"), HEAD).expect("first");
    fs::write(dir.join("Other.unity"), HEAD).expect("second");
    let (code, message) = prepare(&dir, &dir).expect_err("two scenes are refused");
    assert_eq!(code, "SOURCE_FORMAT_AMBIGUOUS");
    assert!(
        message.contains("Map.unity") && message.contains("Other.unity"),
        "{message}"
    );
    // Designated by its file, the scene is no longer ambiguous: it is empty, which
    // is another refusal, named differently.
    let (code, _) = prepare(&dir.join("Map.unity"), &dir).expect_err("an empty scene is refused");
    assert_eq!(code, "IMPORT_ERROR");
    fs::remove_dir_all(dir).expect("cleanup");
}

// Behaviour 28: a Unity project is recognised at the directory level. The golden
// directory carries a scene and an FBX; without designating it, the router yields
// the `unity` driver and the scene it found, the model being only a project input.
// A directory without a scene remains a matter for the file drivers: two model
// formats side by side stay an ambiguity there.
#[test]
fn a_unity_project_directory_wins_over_the_models_it_carries() {
    let project = golden_dir("unity/cc0-import-project");
    match route(&project).expect("the project folder is claimed") {
        Routed::Driver(plugin, inputs) => {
            assert_eq!(plugin.name(), "unity");
            assert_eq!(inputs, vec![project.join("Assets").join("Map.unity")]);
        }
        Routed::Manifest => panic!("routed to the manifest"),
    }
    let dir = scratch("unity", "modeles");
    fs::write(dir.join("a.fbx"), b"Kaydara FBX Binary  ").expect("fbx");
    fs::write(dir.join("b.obj"), b"v 0 0 0\n").expect("obj");
    let refusal = route(&dir).err().expect("two model formats are ambiguous");
    assert_eq!(refusal.code, "SOURCE_FORMAT_AMBIGUOUS");
    fs::remove_dir_all(dir).expect("cleanup");
}

// Behaviour 29: a Unity data file whose name says nothing is recognised by its
// header — the tag directive the editor writes at the start of every serialised file.
#[test]
fn a_unity_data_file_is_recognised_by_its_head() {
    let dir = scratch("unity", "head");
    let file = dir.join("scene-without-extension");
    fs::write(&file, HEAD).expect("write");
    match route(&file).expect("a headed file is claimed") {
        Routed::Driver(plugin, _) => assert_eq!(plugin.name(), "unity"),
        Routed::Manifest => panic!("routed to the manifest"),
    }
    fs::remove_dir_all(dir).expect("cleanup");
}

// Finding 28: a prefab override that targets a material slot beyond what a renderer
// carries — `2^64 − 1` — is counted under its name. The index was trusted as-is:
// stretching the slot list that far overflowed, and stopped compilation with a panic.
#[test]
fn a_material_slot_override_beyond_what_a_renderer_carries_is_counted() {
    const MODEL: &str = "0000000000000000000000000000000a";
    let projet = super::project::Projet::new("emplacement");
    projet.model(
        "Models/Piece.glb",
        MODEL,
        json!([{"name":"Piece","mesh":0}]),
        "",
    );
    projet.scene(&format!(
        "--- !u!1001 &5000\nPrefabInstance:\n  serializedVersion: 2\n  m_Modification:\n    m_TransformParent: {{fileID: 0}}\n    m_Modifications:\n    - target: {{fileID: 100000, guid: {MODEL}, type: 3}}\n      propertyPath: m_Materials.Array.data[18446744073709551615]\n      value:\n      objectReference: {{fileID: 0}}\n    - target: {{fileID: 100000, guid: {MODEL}, type: 3}}\n      propertyPath: m_Name\n      value: Instance\n      objectReference: {{fileID: 0}}\n  m_SourcePrefab: {{fileID: 100100000, guid: {MODEL}, type: 3}}\n"
    ));
    let run = projet.compile("unity-emplacement");
    let (manifest, gltf) = run.prepared("unity");
    assert_eq!(
        manifest["unsupported"]["unity-prefab-material-slot-invalid"], 1,
        "the out-of-range slot is counted, never reserved"
    );
    assert!(
        super::project::node_named(&gltf, "Instance").is_some(),
        "the rest of the instance comes out unchanged: {gltf}"
    );
}
