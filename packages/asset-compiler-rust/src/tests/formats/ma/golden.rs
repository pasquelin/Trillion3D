//! `ma` driver golden test. Hand-written fixture and format hard refusals.
//!
//! `minuscule/scene.ma` carries `transform` hierarchy, `mesh` with two quads
//! reusing edge in reverse, two separately shaded face groups, second
//! pose of same form via `parent -add`, `lambert`, textured `standardSurface`, camera
//! and `python` command. Fixes driver output down to sidecar bytes, and
//! what it counts without rendering.
use super::*;

const CASE: &str = "A Maya ASCII file: a transform hierarchy in centimetres, a mesh of two quads of which the second reuses an edge of the first reversed, two instObjGroups of one face each shaded by two shadingEngine, a second pose of the shape via parent -add, an opaque lambert, a metallic translucent standardSurface with a colour texture, a camera, a select on a node absent from the file and a python command.";
const RULE: &str = "The driver yields the file data and nothing else: no command is executed, a node is identified by its scene path, a pose is composed in the format's full order, faces are resolved by their signed edges then ear-clipped in their normal plane, a face group becomes a separate primitive and what none claims makes one without a material, intermediate and invisible shapes stay out, missing normals are computed from the geometry and each edge's hardness flag, each axis wrap mode follows its own attribute, lambert and standardSurface go to pbrMetallicRoughness, the linear unit is carried by the scene root, and everything else is counted by name.";

// Behavior: fixture passes through compiler, intermediate and compiled scenes
// compared to expected.json.
#[test]
fn the_ma_fixture_compiles_to_its_golden_expected_json() {
    let dir = golden_dir("ma");
    let run = compile_golden_source(&fixture(&dir), "ma-minuscule");
    assert_eq!(
        digest(&run),
        golden_expected(&dir),
        "fixture ma: compiled output diverges from expected.json"
    );
}

#[test]
#[ignore = "writes into tests/fixtures/formats/; rerun by hand, and its diff is re-read"]
fn regenere_la_fixture_ma() {
    let dir = golden_dir("ma");
    let run = compile_golden_source(&fixture(&dir), "ma-minuscule");
    write_expected(&dir, digest(&run), CASE, RULE);
}

// Behavior: truncated file before commands keeps header, yields surface-less document,
// refusal named without writing anything.
#[test]
fn a_ma_file_truncated_before_its_first_command_is_refused_as_empty() {
    let root = std::env::temp_dir().join(format!("wg-ma-vide-{}", std::process::id()));
    fs::create_dir_all(&root).expect("dir");
    let file = root.join("truncated.ma");
    fs::write(&file, "//Maya ASCII 2024 scene\n// Orig").expect("file");
    assert_eq!(refused_golden_source(&file, "ma-truncated"), "IMPORT_EMPTY");
    let _ = fs::remove_dir_all(&root);
}

// Behavior: file whose first line does not announce Maya ASCII not read, even
// when extension brings to driver.
#[test]
fn a_file_without_the_maya_header_is_refused_by_name() {
    let root = std::env::temp_dir().join(format!("wg-ma-entete-{}", std::process::id()));
    fs::create_dir_all(&root).expect("dir");
    let file = root.join("autre.ma");
    fs::write(&file, "createNode transform -n \"X\";\n").expect("file");
    assert_eq!(
        refused_golden_source(&file, "ma-header"),
        "ma-file-invalid",
        "a file without a Maya header must be refused by name"
    );
    let _ = fs::remove_dir_all(&root);
}

/// Minuscule fixture file.
fn fixture(dir: &Path) -> PathBuf {
    dir.join("minuscule").join("scene.ma")
}

/// Golden comparison: retained driver, written intermediate scene — nodes,
/// meshes, materials, images, report —, and output compiled scene.
fn digest(run: &GoldenRun) -> Value {
    tables_digest(run, "ma", Value::clone).0
}
