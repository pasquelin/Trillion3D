//! Golden of the `usd` driver. Two fixtures, two distinct questions.
//!
//! `minuscule/` is a layer written by hand for this test: it holds an `Xform`
//! hierarchy, a `Mesh` of two polygons, a `GeomSubset` that gives a second
//! material to one of the two faces, and a textured material. It fixes what the
//! driver produces, down to the sidecar bytes.
//!
//! `corpus/` is the **same scene** shipped in both USD serialisations, text and
//! binary. The golden compiles both and compares their intermediate scenes:
//! `usda` and `usdc` are only two writings of one document, and the driver must
//! not know which it read.
use super::*;

const CASE: &str = "A usda layer: a translated Xform, a Mesh of two quads, a GeomSubset materialBind that binds the second face to a second material, an opaque UsdPreviewSurface and another translucent one with a UsdUVTexture in a subfolder.";
const RULE: &str = "The driver yields the composed scene and nothing else: polygons fan-triangulated, one primitive per material part, normals and primvars:st resolved by their interpolation, UsdPreviewSurface to pbrMetallicRoughness, and the layer's unit and up-axis carried by the scene root.";

// Behaviour 27: the tiny usda fixture goes through the compiler and its
// intermediate scene as well as its compiled output are compared to expected.json.
#[test]
fn the_usd_fixture_compiles_to_its_golden_expected_json() {
    let dir = golden_dir("usd");
    let run = compile_golden_source(&layer(&dir), "usd-minuscule");
    assert_eq!(
        digest(&run),
        golden_expected(&dir),
        "fixture usd: compiled output diverges from expected.json"
    );
}

#[test]
#[ignore = "writes into tests/fixtures/formats/; rerun by hand, and its diff is re-read"]
fn regenerate_the_usd_fixture() {
    let dir = golden_dir("usd");
    let run = compile_golden_source(&layer(&dir), "usd-minuscule");
    write_expected(&dir, digest(&run), CASE, RULE);
}

// Behaviour 28: the same scene written as text and as binary yields the same
// intermediate scene, node for node and byte for byte. That is the only proof
// worth having that the driver reads a document, not a serialisation.
#[test]
fn the_text_and_binary_serialisations_of_one_scene_give_the_same_intermediate_scene() {
    let corpus = golden_dir("usd").join("corpus");
    let text = compile_golden_source(&corpus.join("usda").join("scene.usda"), "usd-corpus-usda");
    let binary = compile_golden_source(&corpus.join("usdc").join("scene.usdc"), "usd-corpus-usdc");
    let (_, text_gltf) = text.prepared("usd");
    let (_, binary_gltf) = binary.prepared("usd");
    assert_eq!(
        text_gltf, binary_gltf,
        "the binary layer does not yield the same intermediate scene as the text layer"
    );
    assert_eq!(
        hash(&text.binary),
        hash(&binary.binary),
        "the two serialisations do not compile the same sidecar"
    );
    assert_eq!(
        corpus_counts(&text_gltf),
        json!({"meshes":3,"materials":3,"triangles":36}),
        "the corpus figures have moved"
    );
}

/// The minuscule fixture layer.
fn layer(dir: &Path) -> PathBuf {
    dir.join("minuscule").join("scene.usda")
}

/// What the corpus puts under watch: three cubes with the same three materials, six quads
/// each, so thirty-six triangles in all.
fn corpus_counts(gltf: &Value) -> Value {
    let meshes = gltf["meshes"].as_array().expect("meshes");
    let triangles: usize = meshes
        .iter()
        .flat_map(|mesh| mesh["primitives"].as_array().expect("primitives"))
        .map(|primitive| {
            let accessor = primitive["indices"].as_u64().expect("indices") as usize;
            gltf["accessors"][accessor]["count"]
                .as_u64()
                .expect("count") as usize
                / 3
        })
        .sum();
    json!({
        "meshes": meshes.len(),
        "materials": gltf["materials"].as_array().expect("materials").len(),
        "triangles": triangles,
    })
}

/// What the golden fixes: the retained driver, the intermediate scene it wrote —
/// nodes, meshes, materials, images, report — and the compiled scene that comes out.
fn digest(run: &GoldenRun) -> Value {
    let (manifest, gltf) = run.prepared("usd");
    compiled_identity(
        run,
        json!({
          "scenePlugin": run.result["scenePlugin"],
          "plugin": manifest["source"]["plugin"],
          "counts": manifest["source"]["counts"],
          "unsupported": manifest["unsupported"],
          "notes": manifest["notes"],
          "nodes": gltf["nodes"],
          "meshes": gltf["meshes"],
          "materials": gltf["materials"],
          "images": gltf["images"],
          "samplers": gltf["samplers"],
          "textures": gltf["textures"],
          "accessors": gltf["accessors"],
        }),
    )
}
