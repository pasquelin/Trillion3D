//! What the `usd` driver recognises, triangulates and composes. Refusals are in
//! `usd_refus.rs`; the golden scene is in `usd_golden.rs`.
//!
//! Each case is a tiny `.usda` layer written here: that is the only way to isolate
//! a behaviour — a real fixture would mix ten.
use super::*;

/// The scene driver of this name in the registry.
pub(super) fn plugin(name: &str) -> &'static dyn plugins::scene::ScenePlugin {
    plugins::scene::PLUGINS
        .iter()
        .copied()
        .find(|plugin| plugin.name() == name)
        .unwrap_or_else(|| panic!("the registry does not carry the driver {name}"))
}

/// A throwaway folder, named by the case that uses it.
pub(super) fn temp_dir(tag: &str) -> PathBuf {
    scratch("usd", tag)
}

/// Writes a throwaway layer and compiles it with the common harness. The source
/// folder is erased once compilation is done: everything the golden rereads is
/// already in its cache.
pub(super) fn compile_layer(tag: &str, body: &str) -> GoldenRun {
    let dir = temp_dir(tag);
    let source = dir.join("scene.usda");
    fs::write(&source, body).expect("layer");
    let run = compile_golden_source(&source, tag);
    fs::remove_dir_all(&dir).ok();
    run
}

/// A layer that carries `body` between the braces of its root prim.
pub(super) fn wrap(header: &str, body: &str) -> String {
    format!("#usda 1.0\n(\n    defaultPrim = \"Root\"\n{header})\n\ndef Xform \"Root\"\n{{\n{body}\n}}\n")
}

/// A square mesh, two triangles, without a material: enough that a scene is not empty.
pub(super) const QUAD: &str = r#"
    def Mesh "Quad"
    {
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        uniform token subdivisionScheme = "none"
    }
"#;

// Behaviour 29: both serialisations are recognised by their header, and a ZIP is
// not a USD layer — it is the `usdz` container that claims it.
#[test]
fn the_usd_plugin_recognises_both_serialisations_by_their_head() {
    let usd = plugin("usd");
    assert!(usd.accepts_head(b"#usda 1.0\n"), "the text layer");
    assert!(usd.accepts_head(b"PXR-USDC\0\x08\0\0"), "the binary layer");
    assert!(!usd.accepts_head(b"PK\x03\x04"), "a ZIP is not a layer");
    assert_eq!(usd.extensions(), ["usd", "usda", "usdc"]);
    assert!(
        plugin("usdz").accepts_head(b"PK\x03\x04"),
        "a USDZ package is a ZIP"
    );
}

// Behaviour 30: an n-sided polygon becomes n − 2 triangles, fanned from its first
// corner; a seven-corner mesh therefore loses no surface.
#[test]
fn a_polygon_becomes_a_fan_of_triangles() {
    let mesh = r#"
    def Mesh "Heptagone"
    {
        int[] faceVertexCounts = [7]
        int[] faceVertexIndices = [0, 1, 2, 3, 4, 5, 6]
        point3f[] points = [(0,0,0), (1,0,0), (2,1,0), (2,2,0), (1,3,0), (0,3,0), (-1,2,0)]
        uniform token subdivisionScheme = "none"
    }
"#;
    let run = compile_layer("fan", &wrap("", mesh));
    assert_eq!(
        run.result["sourceTriangles"], 5,
        "seven corners make five triangles"
    );
}

// Behaviour 31: a `GeomSubset` of the `materialBind` family becomes a primitive
// of its own, and faces no subset claims return to the mesh binding.
#[test]
fn a_geom_subset_becomes_its_own_primitive_with_its_own_material() {
    let dir = golden_dir("usd");
    let run = compile_golden_source(&dir.join("minuscule").join("scene.usda"), "usd-subset");
    let (_, gltf) = run.prepared("usd");
    let primitives = gltf["meshes"][0]["primitives"]
        .as_array()
        .expect("primitives");
    assert_eq!(primitives.len(), 2, "one part per material");
    let materials: Vec<u64> = primitives
        .iter()
        .map(|primitive| primitive["material"].as_u64().expect("material"))
        .collect();
    assert_eq!(materials, [0, 1], "the subset first, the rest after");
    assert_eq!(gltf["materials"][1]["alphaMode"], "OPAQUE");
    assert_eq!(gltf["materials"][0]["alphaMode"], "BLEND", "opacity 0.5");
}

// Behaviour 32: two `instanceable` prims that reference the same definition share
// a single glTF mesh, each under its own node.
#[test]
fn two_instances_of_one_prototype_share_a_single_mesh() {
    let body = format!(
        r#"    class Xform "_Modele"
    {{
{QUAD}    }}

    def Xform "A" (
        instanceable = true
        prepend references = </Root/_Modele>
    )
    {{
    }}

    def Xform "B" (
        instanceable = true
        prepend references = </Root/_Modele>
    )
    {{
        double3 xformOp:translate = (5, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }}"#
    );
    let run = compile_layer("instances", &wrap("", &body));
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        gltf["meshes"].as_array().map(Vec::len),
        Some(1),
        "both instances cite the same mesh"
    );
    let cited: Vec<u64> = gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .filter_map(|node| node["mesh"].as_u64())
        .collect();
    assert_eq!(
        cited,
        [0, 0],
        "both instances, the prototype not being a scene"
    );
}

// Behaviour 33: the layer's unit and up-axis live on the scene root, never in
// the vertices: a layer in centimetres and Z-up comes out at scale and Y-up.
#[test]
fn the_layer_unit_and_up_axis_land_on_the_scene_root() {
    let header = "    metersPerUnit = 0.01\n    upAxis = \"Z\"\n";
    let run = compile_layer("axes", &wrap(header, QUAD));
    let (_, gltf) = run.prepared("usd");
    let nodes = gltf["nodes"].as_array().expect("nodes");
    let root = nodes.last().expect("root");
    let matrix: Vec<f64> = root["matrix"]
        .as_array()
        .expect("matrix")
        .iter()
        .map(|value| (value.as_f64().expect("number") * 1e6).round() / 1e6)
        .collect();
    assert_eq!(
        matrix,
        vec![0.01, 0., 0., 0., 0., 0., -0.01, 0., 0., 0.01, 0., 0., 0., 0., 0., 1.],
        "the layer's scale then the passage from Z-up to Y-up"
    );
}
