//! Golden of the `obj` driver. A hand-written fixture, and its material library.
//!
//! `minuscule/scene.obj` holds two groups — a quad and a pentagon —, two
//! materials, and a `.mtl` that describes everything a library can declare and
//! that glTF cannot always carry: ambient colour, specular, IOR, exponent,
//! opacity and its separate map, emission, distinct normal and bump, and map
//! options `-s`, `-o`, `-bm`, `-clamp`.
//! It fixes what the driver produces, down to sidecar bytes, and what it counts without
//! rendering.
use super::*;

const CASE: &str = "An OBJ and its MTL: two groups shaded by two materials, a quad and a pentagon, an ambient colour and its map, a specular colour, an exponent, an IOR, 0.5 opacity with its separate map, textured emission, a normal and a bump that point at two different files, and map options -s, -o, -bm and -clamp.";
const RULE: &str = "The driver yields what the library declares and counts the rest by name: the normal wins over the bump, opacity stays blend and never a cutout, -clamp becomes the sampler wrap mode, and ambient colour, specular, IOR, offset, scale and bump strength are counted for lack of a place in glTF's metal-roughness model.";

// Behaviour: the fixture goes through the compiler, and its intermediate scene
// as well as its compiled output are compared to expected.json.
#[test]
fn the_obj_fixture_compiles_to_its_golden_expected_json() {
    let dir = golden_dir("obj");
    let run = compile_golden_source(&fixture(&dir), "obj-minuscule");
    assert_eq!(
        digest(&run),
        golden_expected(&dir),
        "fixture obj: compiled output diverges from expected.json"
    );
}

#[test]
#[ignore = "writes into tests/fixtures/formats/; rerun by hand, and its diff is re-read"]
fn regenere_la_fixture_obj() {
    let dir = golden_dir("obj");
    let run = compile_golden_source(&fixture(&dir), "obj-minuscule");
    write_expected(&dir, digest(&run), CASE, RULE);
}

/// The minuscule fixture file.
fn fixture(dir: &Path) -> PathBuf {
    dir.join("minuscule").join("scene.obj")
}

/// Per-file record, without its timings: a golden fixes a scene, never a clock.
fn files_without_timings(files: &Value) -> Value {
    let mut listed = files.clone();
    for file in listed.as_array_mut().into_iter().flatten() {
        for timing in ["ms", "parseMs"] {
            if let Some(object) = file.as_object_mut() {
                object.remove(timing);
            }
        }
    }
    listed
}

/// What the golden fixes: the retained driver, the intermediate scene it wrote —
/// nodes, meshes, materials, images, samplers, report — and the compiled scene that comes out.
fn digest(run: &GoldenRun) -> Value {
    let (mut out, manifest) = tables_digest(run, "obj", files_without_timings);
    out["external"] = manifest["source"]["external"].clone();
    out
}
