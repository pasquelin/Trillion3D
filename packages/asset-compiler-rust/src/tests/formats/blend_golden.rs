//! Golden of the `blend` driver: a CC0 Blender scene goes through the router, the
//! driver, then the compiler, and the intermediate scene it wrote is compared to
//! `expected.json` — nodes, converted matrices, meshes, primitives per material,
//! PBR materials and images, value by value. What the driver refuses is fixed
//! here too, by its code.
//!
//! The fixture is described in `tests/fixtures/formats/blend/README.md`. Regenerating the
//! expected, from the repository root:
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenere_la_fixture_blend --nocapture
//! npx prettier --write tests/fixtures/formats/blend/procedural-materials/expected.json
//! ```
//!
//! Ignored by default: it writes into `tests/fixtures/formats/`. The diff it produces is
//! re-read before being committed — an expected regenerated without reading no
//! longer watches anything.
use super::*;

const CASE: &str = "Blender 5.2 CC0 scene compressed with Zstandard: three objects that share the same cube, parented to an empty that carries them, six faces with three materials, one UV layer, all sharp faces, an emissive material of intensity 3, an opaque material and a transparent material whose colour and alpha come from the same PNG packed in the file.";
const RULE: &str = "Blender works with Z up, glTF with Y up: a single root node carries the axis conversion, and no vertex is touched. A mesh shared by three objects is written only once; only the matrices differ. The material index lives on the face in Blender and on the primitive in glTF: the six faces yield three primitives. Normals are not in the file and are computed at read, flat for a sharp face. Alpha wired to the alpha channel of the image the base colour already carries passes as-is: the factor is one, otherwise it would cancel the image, and the mode becomes BLEND. Blender places the UV origin bottom-left and glTF top-left: v becomes 1 - v, image bytes staying intact. Emission is colour x intensity, clamped to 1 by glTF and counted as soon as it exceeds. Packed image bytes go as-is into the scene binary, through a buffer view: no re-encoding.";

/// The CC0 fixture and the folder that carries its expected.
fn fixture() -> PathBuf {
    golden_dir("blend/procedural-materials")
}

// Behaviour 27: the golden Blender scene goes through the compiler and everything
// the driver drew from it — nodes, matrices, meshes, materials, images — is
// compared exactly to expected.json.
#[test]
fn the_blend_scene_matches_its_golden_expected_json() {
    let run = compile_golden_source(&fixture().join("scene.blend"), "blend");
    assert_eq!(
        blend_digest(&run),
        golden_expected(&fixture()),
        "fixture blend: the intermediate scene diverges from expected.json"
    );
}

// Behaviour 28: what the driver refuses is named. A file truncated mid-block, and
// a folder that carries two Blender files, each come out by their code, without panic.
#[test]
fn a_truncated_file_and_an_ambiguous_directory_are_refused_by_name() {
    let truncated = golden_dir("blend/limites").join("truncated.blend");
    assert_eq!(
        refused_golden_source(&truncated, "blend-tronque"),
        "blend-truncated"
    );
    let dir = std::env::temp_dir().join(format!("wg-blend-deux-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("dir");
    for name in ["a.blend", "b.blend"] {
        fs::copy(&truncated, dir.join(name)).expect("copy");
    }
    assert_eq!(
        refused_golden_source(&dir, "blend-ambigu"),
        "SOURCE_FORMAT_AMBIGUOUS"
    );
    fs::remove_dir_all(dir).expect("cleanup");
}

/// What the golden fixes: the retained driver, its report, then the scene itself
/// — each node with its name, matrix and mesh, each mesh with the materials of
/// its primitives, and each material with its PBR factors.
pub(in crate::tests) fn blend_digest(run: &GoldenRun) -> Value {
    let (manifest, gltf) = run.prepared("blend");
    let materials: Vec<Vec<Value>> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .map(|mesh| {
            mesh["primitives"]
                .as_array()
                .expect("primitives")
                .iter()
                .map(|primitive| primitive["material"].clone())
                .collect()
        })
        .collect();
    let names: Vec<Value> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .map(|mesh| mesh["name"].clone())
        .collect();
    json!({
      "rapport": {
        "formatVersion": run.result["formatVersion"],
        "plugin": manifest["source"]["plugin"],
        "counts": manifest["source"]["counts"],
        "unsupported": manifest["unsupported"],
        "notes": manifest["notes"],
      },
      "instancie": {
        "meshNodes": manifest["runtime"]["meshNodes"],
        "trianglesAcrossNodes": manifest["runtime"]["trianglesAcrossNodes"],
        "selectedTriangles": run.result["selectedTriangles"],
        "totalNodes": run.result["totalNodes"],
      },
      "scene": {
        "roots": gltf["scenes"][0]["nodes"],
        "nodes": gltf["nodes"],
        "meshNames": names,
        "primitiveMaterials": materials,
      },
      "apparence": {
        "materials": gltf["materials"],
        "images": gltf["images"],
        "samplers": gltf["samplers"],
      },
    })
}

#[test]
#[ignore = "writes into tests/fixtures/formats/; rerun by hand, and its diff is re-read"]
fn regenere_la_fixture_blend() {
    let run = compile_golden_source(&fixture().join("scene.blend"), "blend");
    write_expected(&fixture(), blend_digest(&run), CASE, RULE);
}
