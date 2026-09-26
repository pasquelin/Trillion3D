//! A part leaves the DAG only where the error covers it (#484): in every cut the runtime may draw,
//! the root cover — what `memory-on-a-budget` draws at its smallest budget — included, a part of
//! the model none of whose vertices the cut names is no wider than the cut's error, and every root
//! face lies within twice its error of the model (what `signature-architecture` lost:
//! `dag/vanished.rs`). The cook refuses a parent error below a child's, so a cook that passes
//! keeps its errors monotone.
use super::silhouette::{page_cuts, page_indices};
use super::site_scene::cook_site_scene;
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

/// The root cover's and the missing parts' defects of a committed site scene's cook, every
/// primitive.
fn site_scene_extent_defects(folder: &str, gltf: &str, tag: &str) -> Vec<String> {
    let scene = cook_site_scene(folder, gltf, tag, "qem-endpoints");
    let mut defects = Vec::new();
    for primitive in scene.result["primitives"].as_array().expect("primitives") {
        let (positions, indices) = (scene.positions(primitive), scene.indices(primitive));
        let objects = &scene.objects;
        defects.extend(root_defects(objects, primitive, &positions, &indices));
        defects.extend(missing_part_defects(
            objects, primitive, &positions, &indices,
        ));
    }
    let _ = fs::remove_dir_all(&scene.root);
    defects
}

#[test]
fn no_part_of_signature_architecture_leaves_a_cut_under_its_extent() {
    let folder = "site/assets/gallery/signature-architecture/source";
    let defects = site_scene_extent_defects(folder, "geometry.gltf", "geometry");
    assert!(defects.is_empty(), "{defects:#?}");
}

/// The chalet's balcony boards (`scripts/docs/examples/chalet.ts`) stand like an arcade's
/// columns: closed parts 1.08 m across, each apart from the rest. Charged only the simplifier's
/// error, they left the cut at 1 m.
#[test]
fn no_board_of_the_chalet_balcony_leaves_a_cut_under_its_extent() {
    let folder = "site/assets/examples/chalet/source";
    let defects = site_scene_extent_defects(folder, "chalet.gltf", "chalet");
    assert!(defects.is_empty(), "{defects:#?}");
}
