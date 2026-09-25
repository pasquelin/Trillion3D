//! A part leaves the DAG only where the error covers it (#484): in every cut the runtime may draw,
//! the root cover — what `memory-on-a-budget` draws at its smallest budget — included, a part of
//! the model none of whose vertices the cut names is no wider than the cut's error, and every root
//! face lies within twice its error of the model. On `signature-architecture`, the roots dropped
//! walls up to 32 m across at 21.8 m of error, and a fan of faces turned from the light filled
//! every arch opening. The cook refuses a parent error below a child's, so a cook that passes
//! keeps its errors monotone.
use super::chalet_fixture::{push_box, push_log};
use super::dag_dependency_scenes::cook_site_scene;
use super::silhouette::{page_indices, Mesh};
use super::thin_walls::mesh_fixture;
use super::*;
use crate::dag::bounds::bounding_sphere;
use crate::dag::clusters::weld_positions;
use crate::dag::parts;
use crate::physics_cook::hausdorff::one_sided_distance;
use std::collections::HashSet;

/// The cuts' defects against the source they were cooked from, one line each: a part missing from
/// a cut and wider than its error; a root page with a face farther from the source than twice its
/// error — the error is the simplifier's, a distance to the planes of the faces it replaced, which
/// the distance to the triangles themselves may exceed on a curved part, and a fan closing an
/// arch's opening lies as far off as the opening is wide; and a report whose root triangles per
/// level do not add up to the root cover's.
fn extent_defects(
    objects: &Path,
    primitive: &Value,
    positions: &[f32],
    indices: &[u32],
) -> Vec<String> {
    let index = &primitive["primitive"];
    let mut defects = Vec::new();
    let pages = primitive["pages"].as_array().expect("pages");
    let drawn: Vec<Vec<u32>> = pages
        .iter()
        .map(|page| page_indices(objects, page))
        .collect();
    let error = |page: &Value, key: &str| page[key].as_f64().unwrap_or(f64::INFINITY);
    let mut root_triangles = 0;
    for (page, drawn) in pages.iter().zip(&drawn) {
        if page["parentError"].is_null() {
            root_triangles += drawn.len() / 3;
            let (off, lod) = (
                one_sided_distance(positions, drawn, indices),
                error(page, "lodError"),
            );
            if off > 2.0 * lod + 1e-6 {
                let id = &page["id"];
                defects.push(format!(
                    "primitive {index}, root page {id}: a face lies {off:.3} m off the model, error {lod:.3} m"
                ));
            }
        }
    }
    let levels = primitive["dag"]["levels"].as_array().expect("levels");
    let reported: u64 = levels
        .iter()
        .filter_map(|l| l["rootTriangles"].as_u64())
        .sum();
    if reported != root_triangles as u64 {
        defects.push(format!(
            "primitive {index}: the report counts {reported} root triangles, the roots draw {root_triangles}"
        ));
    }
    let parts: Vec<(Vec<u32>, [f64; 4])> = parts(indices, &weld_positions(positions, indices))
        .into_iter()
        .map(|part| {
            let sphere = bounding_sphere(positions, &part);
            (part, sphere)
        })
        .collect();
    let mut thresholds: Vec<f64> = pages.iter().map(|page| error(page, "lodError")).collect();
    thresholds.sort_by(f64::total_cmp);
    thresholds.dedup();
    for t in thresholds {
        let named: HashSet<u32> = pages
            .iter()
            .zip(&drawn)
            .filter(|(page, _)| error(page, "lodError") <= t && t < error(page, "parentError"))
            .flat_map(|(_, drawn)| drawn.iter().copied())
            .collect();
        for (part, sphere) in &parts {
            if 2.0 * sphere[3] > t + 1e-6 && !part.iter().any(|v| named.contains(v)) {
                defects.push(format!(
                    "primitive {index}: the part around {:.2?}, {:.2} m across, left the cut at error {t:.3} m",
                    &sphere[..3],
                    2.0 * sphere[3]
                ));
            }
        }
    }
    defects
}

#[test]
fn no_part_of_signature_architecture_leaves_a_cut_under_its_extent() {
    let folder = "site/assets/gallery/signature-architecture/source";
    let scene = cook_site_scene(folder, "geometry.gltf", "geometry");
    let (gltf, bin, objects) = (&scene.gltf, scene.bin.as_slice(), &scene.objects);
    let read = |id: &Value| accessor(gltf, bin, id.as_u64().expect("accessor") as usize, None);
    let mut defects = Vec::new();
    for primitive in scene.result["primitives"].as_array().expect("primitives") {
        let index = primitive["primitive"].as_u64().expect("primitive") as usize;
        let written = &gltf["meshes"][0]["primitives"][index];
        let positions = read(&written["attributes"]["POSITION"]).and_then(|a| a.collect_f32());
        let indices = read(&written["indices"]).and_then(|a| a.collect_u32());
        let (positions, indices) = (positions.expect("positions"), indices.expect("indices"));
        defects.extend(extent_defects(objects, primitive, &positions, &indices));
    }
    let _ = fs::remove_dir_all(&scene.root);
    assert!(defects.is_empty(), "{defects:#?}");
}

/// An arcade: a slab, two rows of twenty columns 0.24 m wide and 4 m tall, and a lintel on each
/// row. Every part is a closed solid with the normals an exporter writes.
fn arcade() -> Mesh {
    let mut mesh = Mesh::default();
    push_box(&mut mesh, [-20.0, -0.2, -3.0], [20.0, 0.0, 3.0]);
    for z in [-2.0f32, 2.0] {
        for k in 0..20 {
            push_log(&mut mesh, 1, [-19.0 + 2.0 * k as f32, 0.0, z], 4.0);
        }
        push_box(&mut mesh, [-20.0, 4.0, z - 0.3], [20.0, 4.3, z + 0.3]);
    }
    mesh
}

#[test]
fn no_column_of_an_arcade_leaves_a_cut_under_its_extent() {
    let mesh = arcade();
    let (root, mut options) = mesh_fixture("arcade", std::slice::from_ref(&mesh));
    options.texture_formats = Vec::new();
    let result = compile(&options, |_| {}).expect("compile");
    let objects = options.cache.join("native/objects");
    let positions: Vec<f32> = mesh.positions.iter().flatten().map(|&v| v as f32).collect();
    let primitive = &result["primitives"][0];
    let defects = extent_defects(&objects, primitive, &positions, &mesh.indices);
    let top = primitive["pages"].as_array().expect("pages").iter();
    let top = top.filter_map(|page| page["level"].as_u64()).max();
    let _ = fs::remove_dir_all(root);
    assert!(defects.is_empty(), "{defects:#?}");
    assert!(top > Some(1), "the arcade must coarsen more than once");
}
