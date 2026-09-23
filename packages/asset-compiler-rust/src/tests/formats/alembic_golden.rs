//! Golden and refusals of the Alembic driver: a CC0 Ogawa archive goes through
//! the router, the driver, then the compiler, and the intermediate scene it wrote
//! is compared to `expected.json` — hierarchy, matrices, primitives, face-set
//! materials, vertices split per corner, value by value. The other cases fix what
//! the driver recognises and what it refuses.
//!
//! Regenerating the expected, from the repository root:
//!
//! ```text
//! cargo test --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenerate_the_alembic_fixture --nocapture
//! ```
//!
//! Ignored by default: it writes into `tests/fixtures/formats/`, and the diff it produces is
//! re-read before being committed.
use super::*;

const CASE: &str = "Three Alembic cubes of eight vertices, placed by Xforms at x = 0, 3 and 6 under a shared root; six faces of four sides each, normals and texture coordinates per face corner, and three face sets named Emissive, Opaque and Transparent.";
const RULE: &str = "An Alembic face is wound clockwise, a glTF face counter-clockwise: each face is read backwards, fan-triangulated, and its distinct corners become distinct vertices. A face set gives its name to a neutral material and splits a primitive. Three objects with the same bytes are one mesh and three nodes.";

fn fixture() -> PathBuf {
    golden_dir("alembic/procedural-static")
}

// Behaviour 27: the golden Alembic scene goes through the compiler and everything
// the driver drew from it — hierarchy, matrices, primitives, materials, vertices
// — is compared to expected.json.
#[test]
fn the_alembic_scene_matches_its_golden_expected_json() {
    let run = compile_golden_source(&fixture().join("scene.abc"), "alembic");
    assert_eq!(
        alembic_digest(&run),
        golden_expected(&fixture()),
        "fixture alembic: the intermediate scene diverges from expected.json"
    );
}

// Behaviour 28: an HDF5-container `.abc` and a truncated archive are refused
// through the whole compiler, each under its own name — the caller learns what
// is wrong, not only that the source did not compile.
#[test]
fn an_hdf5_container_and_a_truncated_archive_are_refused_by_name() {
    let limits = golden_dir("alembic/limites");
    assert_eq!(
        refused_golden_source(&limits.join("hdf5.abc"), "alembic-hdf5"),
        "alembic-hdf5-unsupported"
    );
    assert_eq!(
        refused_golden_source(&limits.join("truncated.abc"), "alembic-truncated"),
        "alembic-file-invalid"
    );
}

// Behaviour 29: an `.abc` goes to the alembic driver, by its extension as by its
// Ogawa header, and a folder that carries one routes there without being told what.
#[test]
fn an_ogawa_file_routes_to_the_alembic_plugin() {
    let routed = |path: &Path| match plugins::scene::route(path).expect("route") {
        plugins::scene::Routed::Driver(plugin, _) => plugin.name().to_string(),
        plugins::scene::Routed::Manifest => panic!("routed to the manifest"),
    };
    assert_eq!(routed(&fixture().join("scene.abc")), "alembic");
    let dir = std::env::temp_dir().join(format!("trillion3d-alembic-route-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("dir");
    fs::copy(fixture().join("scene.abc"), dir.join("nameless")).expect("copy");
    assert_eq!(routed(&dir.join("nameless")), "alembic", "header alone");
    assert_eq!(routed(&dir), "alembic", "dir");
    fs::remove_dir_all(&dir).expect("cleanup");
}

// Behaviour 30: what the driver does not convert, it counts — curves, subdivision
// rendered as flat polygons, animation of which only the first sample is read,
// missing normals — and an `Xform` that does not inherit from its parent becomes
// a scene root, with its own matrix.
#[test]
fn what_the_plugin_leaves_aside_is_counted_and_a_detached_xform_becomes_a_root() {
    let run = compile_golden_source(&golden_dir("alembic/limites").join("cases.abc"), "alembic");
    let (manifest, gltf) = run.prepared("alembic");
    assert_eq!(
        manifest["unsupported"],
        json!({"alembic-animation-ignored": 1, "alembic-curves-unsupported": 1,
               "alembic-normals-missing": 3, "alembic-subd-as-polygons": 1,
               "alembic-transform-not-inherited": 1})
    );
    // Two roots: the carrying `Xform`, and the one that refuses to inherit.
    assert_eq!(gltf["scenes"][0]["nodes"], json!([2, 4]));
    assert_eq!(gltf["nodes"][4]["name"], "Detached");
    assert_eq!(
        gltf["nodes"][4]["matrix"],
        json!([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 10.0, 0.0, 0.0, 1.0]),
        "the operation's translation stays, only inheritance drops"
    );
    // A pentagon yields three triangles, a four-sided subdivision face yields two,
    // and a mesh without normals carries none in the glTF.
    let triangles = |mesh: usize| {
        let id = gltf["meshes"][mesh]["primitives"][0]["indices"]
            .as_u64()
            .expect("indices") as usize;
        gltf["accessors"][id]["count"].as_u64().expect("count") / 3
    };
    assert_eq!((triangles(0), triangles(1), triangles(2)), (3, 2, 1));
    assert!(gltf["meshes"][0]["primitives"][0]["attributes"]["NORMAL"].is_null());
}

#[test]
#[ignore = "writes into tests/fixtures/formats/; rerun by hand, and its diff is re-read"]
fn regenerate_the_alembic_fixture() {
    let run = compile_golden_source(&fixture().join("scene.abc"), "alembic");
    write_expected(&fixture(), alembic_digest(&run), CASE, RULE);
}

/// What the golden fixes: the driver report, then the intermediate scene itself —
/// each node with its name, matrix and children, each primitive with its material
/// and vertices, and the values that prove winding, corner splitting and coordinate conversion.
fn alembic_digest(run: &GoldenRun) -> Value {
    let (mut digest, _, gltf) = scene_digest(run, "alembic");
    let accessor = |id: &Value| gltf["accessors"][id.as_u64().expect("accessor") as usize].clone();
    let primitives: Vec<Value> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .flat_map(|mesh| mesh["primitives"].as_array().expect("primitives").clone())
        .map(|primitive| {
            json!({
                "material": primitive["material"],
                "vertices": accessor(&primitive["attributes"]["POSITION"])["count"],
                "min": accessor(&primitive["attributes"]["POSITION"])["min"],
                "max": accessor(&primitive["attributes"]["POSITION"])["max"],
                "hasNormals": !primitive["attributes"]["NORMAL"].is_null(),
                "triangles": accessor(&primitive["indices"])["count"].as_u64().unwrap_or(0) / 3,
            })
        })
        .collect();
    digest["primitives"] = json!(primitives);
    digest["materials"] = gltf["materials"].clone();
    digest["firstPrimitive"] = first_primitive(&gltf, run);
    digest
}

/// Values of the first primitive, read from the binary: positions, normals,
/// texture coordinates and indices. That is where reversed winding and the
/// flipped second coordinate show in the clear, number by number.
fn first_primitive(gltf: &Value, run: &GoldenRun) -> Value {
    let bytes = fs::read(run.prepared_dir("alembic").join("model.bin")).expect("model.bin");
    // Start of an accessor in the binary, and the element count it announces.
    let span = |id: &Value| {
        let accessor = &gltf["accessors"][id.as_u64().expect("accesseur") as usize];
        let view = &gltf["bufferViews"][accessor["bufferView"].as_u64().expect("vue") as usize];
        let at = view["byteOffset"].as_u64().unwrap_or(0) as usize;
        (at, accessor["count"].as_u64().expect("count") as usize)
    };
    let primitive = &gltf["meshes"][0]["primitives"][0];
    let floats = |name: &str, width: usize| {
        let (at, count) = span(&primitive["attributes"][name]);
        (0..count * width)
            .map(|index| {
                let word = &bytes[at + index * 4..at + index * 4 + 4];
                f64::from(f32::from_le_bytes(word.try_into().expect("mot")))
            })
            .collect::<Vec<f64>>()
    };
    let (at, count) = span(&primitive["indices"]);
    let indices: Vec<u16> = (0..count)
        .map(|index| {
            let word = &bytes[at + index * 2..at + index * 2 + 2];
            u16::from_le_bytes(word.try_into().expect("mot"))
        })
        .collect();
    json!({
        "positions": floats("POSITION", 3),
        "normals": floats("NORMAL", 3),
        "texcoords": floats("TEXCOORD_0", 2),
        "indices": indices,
    })
}
