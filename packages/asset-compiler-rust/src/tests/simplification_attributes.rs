//! `qem-attributes`: coarse levels made of solved vertices, carried by the compiled scene.
use super::*;

/// Compiles the seam sheet and rereads what the cache says of its one primitive: the
/// compilation result, the written `source.gltf`, and the length of `source.bin`.
fn compiled(simplification: &str) -> (PathBuf, Value, Value, u64) {
    let (root, options) = seam_fixture(64, 64, simplification);
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options
        .cache
        .join("native")
        .join("full")
        .join(result["key"].as_str().expect("key"));
    let source: Value =
        serde_json::from_slice(&fs::read(directory.join("source.gltf")).expect("source.gltf"))
            .expect("json");
    let bin = fs::metadata(directory.join("source.bin"))
        .expect("source.bin")
        .len();
    (root, result, source, bin)
}
fn accessor_count(source: &Value, name: &str) -> u64 {
    let p = &source["meshes"][0]["primitives"][0];
    let id = if name == "indices" {
        p["indices"].as_u64()
    } else {
        p["attributes"][name].as_u64()
    }
    .expect("accessor");
    source["accessors"][id as usize]["count"]
        .as_u64()
        .expect("count")
}

// Behaviour: the DAG climbs, its coarse levels carry vertices the source does not have, and the
// compiled scene carries them: every vertex attribute of the primitive counts the source
// vertices plus the created ones, while the index accessor still counts the source triangles.
#[test]
fn coarse_levels_create_vertices_that_the_compiled_scene_carries() {
    let (root, result, source, _) = compiled("qem-attributes");
    let primitive = &result["primitives"][0];
    assert!(
        primitive["dag"]["depth"].as_u64().expect("depth") > 0,
        "the DAG climbs"
    );
    let vertices = &primitive["vertices"];
    let (used, coarse) = (
        vertices["used"].as_u64().expect("used"),
        vertices["coarse"].as_u64().expect("coarse"),
    );
    assert!(coarse > 0, "coarse levels created vertices");
    let total = vertices["source"].as_u64().expect("source") + coarse;
    for name in ["POSITION", "NORMAL", "TEXCOORD_0"] {
        assert_eq!(
            accessor_count(&source, name),
            total,
            "{name} carries every vertex"
        );
    }
    assert_eq!(accessor_count(&source, "indices"), 64 * 64 * 6);
    assert_eq!(
        used,
        65 * 65 + 65,
        "the seam column is two vertices per row"
    );
    // Level zero draws the source vertices only; a coarse page may name a created one.
    let source_count = vertices["source"].as_u64().expect("source") as usize;
    let mut coarse_named_created = false;
    for page in primitive["pages"].as_array().expect("pages") {
        let bytes = fs::read(
            root.join("cache")
                .join("native")
                .join("objects")
                .join(format!("{}.bin", page["sha256"].as_str().expect("sha"))),
        )
        .expect("page");
        let ids = bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| u32::from_le_bytes(*b));
        if page["level"] == json!(0) {
            assert!(
                ids.clone().all(|id| (id as usize) < source_count),
                "exact page"
            );
        } else {
            coarse_named_created |= ids.clone().any(|id| id as usize >= source_count);
        }
        assert!(ids.clone().all(|id| (id as usize) < total as usize));
    }
    assert!(
        coarse_named_created,
        "some coarse page names a created vertex"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a texture seam is never crossed: no created vertex carries a texture coordinate
// from the gap between the two sides, and the seam column keeps both its copies at every level.
#[test]
fn a_texture_seam_is_kept_and_never_interpolated_across() {
    let (root, result, source, _) = compiled("qem-attributes");
    let key = result["key"].as_str().expect("key");
    let bin = fs::read(root.join("cache/native/full").join(key).join("source.bin")).expect("bin");
    let p = &source["meshes"][0]["primitives"][0];
    let uv = &source["accessors"][p["attributes"]["TEXCOORD_0"].as_u64().expect("uv") as usize];
    let view = &source["bufferViews"][uv["bufferView"].as_u64().expect("view") as usize];
    let start = view["byteOffset"].as_u64().expect("offset") as usize;
    let count = uv["count"].as_u64().expect("count") as usize;
    let source_count = result["primitives"][0]["vertices"]["source"]
        .as_u64()
        .expect("source") as usize;
    let mut crossed = 0usize;
    for vertex in source_count..count {
        let at = start + vertex * 8;
        let u = f32::from_le_bytes(bin[at..at + 4].try_into().unwrap());
        // A seam vertex keeps its position and has its texture coordinate solved on its own
        // side: it drifts by the chart's least squares (measured: 1.6e-4 at most), never by
        // the whole texture that separates the two sides.
        crossed += usize::from(u > SEAM_GAP.0 + 0.01 && u < SEAM_GAP.1 - 0.01);
    }
    assert_eq!(
        crossed, 0,
        "a created vertex took its texture from across the seam"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a coarse level made of solved vertices is never the source bit for bit, so it
// carries a positive error — one the runtime still reads as positive once packed in single
// precision — and a threshold of zero draws level zero alone, even where the collapses
// themselves were lossless.
#[test]
fn a_solved_level_carries_a_positive_error() {
    let (root, result, _, _) = compiled("qem-attributes");
    let pages = result["primitives"][0]["pages"].as_array().expect("pages");
    let coarse = pages
        .iter()
        .filter(|page| page["level"] != json!(0))
        .count();
    assert!(coarse > 0);
    for page in pages.iter().filter(|page| page["level"] != json!(0)) {
        let error = page["lodError"].as_f64().expect("lodError");
        assert!(error as f32 > 0.0, "a coarse page with error {error}");
    }
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: two compilations of the same scene write the same bytes, created vertices included.
#[test]
fn two_compilations_write_the_same_vertices() {
    let (root_a, result_a, _, bin_a) = compiled("qem-attributes");
    let (root_b, result_b, _, bin_b) = compiled("qem-attributes");
    assert_eq!(result_a["key"], result_b["key"]);
    assert_eq!(bin_a, bin_b, "source.bin has the same length");
    let pages = |result: &Value| -> Vec<String> {
        result["primitives"][0]["pages"]
            .as_array()
            .expect("pages")
            .iter()
            .map(|page| {
                page["geometry"]["sha256"]
                    .as_str()
                    .expect("sha")
                    .to_string()
            })
            .collect()
    };
    assert_eq!(pages(&result_a), pages(&result_b), "same geometry pages");
    fs::remove_dir_all(root_a).expect("cleanup");
    fs::remove_dir_all(root_b).expect("cleanup");
}

// Behaviour: `qem-endpoints` on the same sheet creates no vertex and leaves the source
// accessors as they came: the extension is the attribute strategy's alone.
#[test]
fn endpoint_simplification_rewrites_no_vertex_buffer() {
    let (root, result, source, _) = compiled("qem-endpoints");
    assert_eq!(result["primitives"][0]["vertices"]["coarse"], json!(0));
    assert_eq!(accessor_count(&source, "POSITION"), 65 * 65 + 65);
    assert_eq!(source["accessors"].as_array().expect("accessors").len(), 4);
    fs::remove_dir_all(root).expect("cleanup");
}
