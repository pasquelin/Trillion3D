//! `qem-attributes`: coarse levels made of solved vertices, at no cost to the source buffer.
use super::*;
use crate::dag::{build_dag_tallied, DagStrategy, DagVertices};
use crate::geometry_page::{Attribute, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// Compiles a sheet and rereads what the cache says of its one primitive: the compilation
/// result, the written `source.gltf`, and the bytes of `source.bin`.
fn compiled(simplification: &str, sheet: Sheet) -> (PathBuf, Value, Value, Vec<u8>) {
    let (root, options) = seam_fixture(64, 64, simplification, sheet);
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options
        .cache
        .join("native")
        .join("full")
        .join(result["key"].as_str().expect("key"));
    let source: Value =
        serde_json::from_slice(&fs::read(directory.join("source.gltf")).expect("source.gltf"))
            .expect("json");
    let bin = fs::read(directory.join("source.bin")).expect("source.bin");
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
/// The DAG of the seam sheet under the attribute strategy, the seam carried by `seam_set`, and
/// the buffer it leaves: the source vertices first, the created ones after them.
fn seam_dag(seam_set: u32) -> (usize, Vec<Attribute>) {
    let (mut positions, normals, uvs, indices) = seam_sheet(64, 64, false);
    let source = positions.len() / 3;
    // The continuous set the seam does not cut, when the seam is on the second one.
    let chart: Vec<f32> = positions
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|[x, y, _]| [x / 64.0, y / 64.0])
        .collect();
    let textured = |flag, values| Attribute {
        flag,
        width: 2,
        values,
    };
    let mut attributes = vec![Attribute {
        flag: FLAG_NORMAL,
        width: 3,
        values: normals,
    }];
    if seam_set == FLAG_UV1 {
        attributes.push(textured(FLAG_UV, chart));
    }
    attributes.push(textured(seam_set, uvs));
    let built = build_dag_tallied(
        DagVertices {
            positions: &mut positions,
            attributes: &mut attributes,
        },
        &indices,
        DagStrategy::QemAttributes,
        &|| Ok(()),
    )
    .expect("dag");
    assert!(built.added_vertices > 0, "coarse levels created vertices");
    (source, attributes)
}

// Behaviour: the DAG climbs and its coarse levels carry vertices the source does not have, while
// the compiled scene keeps the accessors it was given: a created vertex lives in the pages that
// name it, and `source.bin` comes out byte for byte the one `qem-endpoints` writes.
#[test]
fn coarse_levels_create_vertices_the_source_buffer_does_not_pay_for() {
    let (root, result, source, bin) = compiled("qem-attributes", Sheet::Seam("TEXCOORD_0"));
    let primitive = &result["primitives"][0];
    assert!(
        primitive["dag"]["depth"].as_u64().expect("depth") > 0,
        "the DAG climbs"
    );
    let vertices = &primitive["vertices"];
    assert!(
        vertices["coarse"].as_u64().expect("coarse") > 0,
        "coarse levels created vertices"
    );
    assert_eq!(
        vertices["used"].as_u64().expect("used"),
        65 * 65 + 65,
        "the seam column is two vertices per row"
    );
    let count = vertices["source"].as_u64().expect("source");
    for name in ["POSITION", "NORMAL", "TEXCOORD_0"] {
        assert_eq!(accessor_count(&source, name), count, "{name} is the source");
    }
    assert_eq!(accessor_count(&source, "indices"), 64 * 64 * 6);
    assert_eq!(source["accessors"].as_array().expect("accessors").len(), 4);
    let (endpoints_root, endpoints, _, endpoints_bin) =
        compiled("qem-endpoints", Sheet::Seam("TEXCOORD_0"));
    assert_eq!(endpoints["primitives"][0]["vertices"]["coarse"], json!(0));
    assert_eq!(bin, endpoints_bin, "the same source.bin, byte for byte");
    fs::remove_dir_all(root).expect("cleanup");
    fs::remove_dir_all(endpoints_root).expect("cleanup");
}

// Behaviour: a sheet with no seam, whose solve moves nothing, creates no vertex at all and comes
// out of `qem-attributes` with the source buffer `qem-endpoints` would have written.
#[test]
fn a_flat_sheet_creates_no_vertex_and_keeps_its_source_buffer() {
    let (root, result, source, bin) = compiled("qem-attributes", Sheet::Flat);
    let primitive = &result["primitives"][0];
    assert!(
        primitive["dag"]["depth"].as_u64().expect("depth") > 0,
        "the DAG climbs"
    );
    assert_eq!(primitive["vertices"]["coarse"], json!(0), "no vertex");
    assert_eq!(accessor_count(&source, "POSITION"), 65 * 65);
    let (endpoints_root, _, endpoints_source, endpoints_bin) =
        compiled("qem-endpoints", Sheet::Flat);
    assert_eq!(source["accessors"], endpoints_source["accessors"]);
    assert_eq!(bin, endpoints_bin, "the same source.bin, byte for byte");
    fs::remove_dir_all(root).expect("cleanup");
    fs::remove_dir_all(endpoints_root).expect("cleanup");
}

// Behaviour: a texture seam is never crossed: no created vertex carries a texture coordinate
// from the gap between the two sides, whichever coordinate set carries the seam.
#[test]
fn a_texture_seam_is_kept_and_never_interpolated_across() {
    seam_is_kept(FLAG_UV);
}
#[test]
fn a_seam_of_the_second_texture_set_is_kept_as_well() {
    seam_is_kept(FLAG_UV1);
}
fn seam_is_kept(seam_set: u32) {
    let (source, attributes) = seam_dag(seam_set);
    let seam = attributes
        .iter()
        .find(|a| a.flag == seam_set)
        .expect("the seam set");
    let mut crossed = 0usize;
    for vertex in source..seam.values.len() / 2 {
        // A seam vertex keeps its position and has its texture coordinate solved on its own
        // side: it drifts by the chart's least squares (measured: 1.6e-4 at most), never by
        // the whole texture that separates the two sides.
        let u = seam.values[vertex * 2];
        crossed += usize::from(u > SEAM_GAP.0 + 0.01 && u < SEAM_GAP.1 - 0.01);
    }
    assert_eq!(
        crossed, 0,
        "a created vertex took its u from across the seam"
    );
}

// Behaviour: a coarse level made of solved vertices is never the source bit for bit, so it
// carries a positive error — one the runtime still reads as positive once packed in single
// precision — and a threshold of zero draws level zero alone, even where the collapses
// themselves were lossless.
#[test]
fn a_solved_level_carries_a_positive_error() {
    let (root, result, _, _) = compiled("qem-attributes", Sheet::Seam("TEXCOORD_0"));
    let pages = result["primitives"][0]["pages"].as_array().expect("pages");
    let coarse = pages.iter().filter(|page| page["level"] != json!(0));
    assert!(coarse.clone().count() > 0);
    for page in coarse {
        let error = page["lodError"].as_f64().expect("lodError");
        assert!(error as f32 > 0.0, "a coarse page with error {error}");
    }
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: two compilations of the same scene write the same pages, created vertices included.
#[test]
fn two_compilations_write_the_same_pages() {
    let sheet = Sheet::Seam("TEXCOORD_0");
    let (root_a, result_a, _, _) = compiled("qem-attributes", sheet);
    let (root_b, result_b, _, _) = compiled("qem-attributes", sheet);
    assert_eq!(result_a["key"], result_b["key"]);
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
