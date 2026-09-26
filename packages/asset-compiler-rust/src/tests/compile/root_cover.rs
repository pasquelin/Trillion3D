//! A part leaves the DAG only where the error covers it (#484): in every cut the runtime may draw,
//! the root cover — what `memory-on-a-budget` draws at its smallest budget — included, a part of
//! the model none of whose vertices the cut names is no wider than the cut's error, and every root
//! face lies within twice its error of the model (what `signature-architecture` lost:
//! `dag/vanished.rs`). The cook refuses a parent error below a child's, so a cook that passes
//! keeps its errors monotone.
use super::chalet_fixture::{push_box, push_log};
use super::silhouette::{page_cuts, page_indices, Mesh};
use super::site_scene::cook_site_scene;
use super::thin_walls::mesh_fixture;
use super::*;
use crate::dag::bounds::bounding_sphere;
use crate::dag::clusters::weld_positions;
use crate::dag::vanished::{extent, parts};
use crate::physics_cook::hausdorff::one_sided_distance;
use std::collections::HashSet;

/// The root cover's defects against the source it was cooked from, one line each: a root page with
/// a face farther from the source than twice its error — the error is the simplifier's, a distance
/// to the planes of the faces it replaced, which the distance to the triangles themselves may
/// exceed on a curved part, and a fan closing an arch's opening lies as far off as the opening is
/// wide — and a report whose root triangles per level do not add up to the root cover's.
fn root_defects(
    objects: &Path,
    primitive: &Value,
    positions: &[f32],
    indices: &[u32],
) -> Vec<String> {
    let index = &primitive["primitive"];
    let mut defects = Vec::new();
    let mut root_triangles = 0;
    let pages = primitive["pages"].as_array().expect("pages");
    for page in pages.iter().filter(|page| page["parentError"].is_null()) {
        let drawn = page_indices(objects, page);
        root_triangles += drawn.len() / 3;
        let error = page["lodError"].as_f64().expect("error");
        let off = one_sided_distance(positions, &drawn, indices);
        if off > 2.0 * error + 1e-6 {
            let id = &page["id"];
            defects.push(format!(
                "primitive {index}, root page {id}: a face lies {off:.3} m off the model, error {error:.3} m"
            ));
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
    defects
}

/// A part of the source missing from a cut, root cover included, and wider than the cut's error,
/// one line each.
fn missing_part_defects(
    objects: &Path,
    primitive: &Value,
    positions: &[f32],
    indices: &[u32],
) -> Vec<String> {
    let index = &primitive["primitive"];
    let parts: Vec<(f64, Vec<u32>)> = parts(indices, &weld_positions(positions, indices))
        .into_iter()
        .map(|part| (extent(positions, &part), part))
        .collect();
    let widest = parts.iter().fold(0.0_f64, |w, (e, _)| w.max(*e));
    let mut defects = Vec::new();
    // Past the widest part's extent, no part can leave a cut too early.
    for (t, cut) in page_cuts(objects, primitive)
        .into_iter()
        .filter(|(t, _)| *t < widest)
    {
        let named: HashSet<u32> = cut.into_iter().collect();
        for (extent, part) in &parts {
            if *extent > t + 1e-6 && !part.iter().any(|v| named.contains(v)) {
                let at = bounding_sphere(positions, part);
                defects.push(format!(
                    "primitive {index}: the part around {:.2?}, {extent:.2} m across, left the cut at error {t:.3} m",
                    &at[..3]
                ));
            }
        }
    }
    defects
}

/// Both of the above.
fn extent_defects(
    objects: &Path,
    primitive: &Value,
    positions: &[f32],
    indices: &[u32],
) -> Vec<String> {
    let mut defects = root_defects(objects, primitive, positions, indices);
    defects.extend(missing_part_defects(objects, primitive, positions, indices));
    defects
}

#[test]
fn no_part_of_signature_architecture_leaves_a_cut_under_its_extent() {
    let folder = "site/assets/gallery/signature-architecture/source";
    let scene = cook_site_scene(folder, "geometry.gltf", "geometry", "qem-endpoints");
    let mut defects = Vec::new();
    for primitive in scene.result["primitives"].as_array().expect("primitives") {
        let (positions, indices) = (scene.positions(primitive), scene.indices(primitive));
        defects.extend(extent_defects(
            &scene.objects,
            primitive,
            &positions,
            &indices,
        ));
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
