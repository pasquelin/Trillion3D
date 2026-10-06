//! The procedural meshes and a hall scene, measured through the page path (`super::measure`).
use super::building::building;
use super::meshes::{sphere, terrain, Mesh};
use super::vegetation::vegetation;
use super::{assert_within_margin, exact_pixels, measure, Page, Primitive};
use crate::geometry_page_quant::tile::tile_log2;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

fn measured(mesh: &Mesh, tile_log2: i32) -> Vec<Page> {
    let attributes = mesh.attributes();
    let carried: Vec<_> = attributes.iter().collect();
    measure(&Primitive {
        positions: &mesh.positions,
        carried: &carried,
        indices: &mesh.indices,
        blended: false,
        scale: None,
        tile_log2,
    })
}

// Behaviour: every page of the four meshes, drawn by the cut at 0.5, 1 and 2 pixels with
// the camera 2 m or 10 m away, stays within a tenth of a pixel of the threshold.
// One test per mesh, so that the harness measures them in parallel.
#[test]
fn the_audits_terrain_is_drawn_within_a_tenth_of_a_pixel_of_the_threshold() {
    let pages = measured(&terrain(257, 1024.0), tile_log2(None));
    assert_within_margin("terrain", &pages);
}

#[test]
fn the_audits_sphere_is_drawn_within_a_tenth_of_a_pixel_of_the_threshold() {
    assert_within_margin("sphere", &measured(&sphere(6, 5.0), tile_log2(None)));
}

#[test]
fn the_audits_building_is_drawn_within_a_tenth_of_a_pixel_of_the_threshold() {
    assert_within_margin("building", &measured(&building(), tile_log2(None)));
}

#[test]
fn the_audits_vegetation_is_drawn_within_a_tenth_of_a_pixel_of_the_threshold() {
    assert_within_margin("vegetation", &measured(&vegetation(), tile_log2(None)));
}

// Behaviour: the measurement sees the loss the tiles removed: the same terrain on one grid for
// the whole kilometre is drawn pixels away from its source at 2 m.
#[test]
fn a_kilometre_terrain_on_one_grid_is_measured_pixels_away() {
    let pages = measured(&terrain(257, 1024.0), i32::MAX);
    let exact = exact_pixels(&pages, 2.0);
    println!("terrain on one grid at 2 m: level 0 {exact:.4} px");
    assert!(exact > 2.0 + super::MARGIN, "{exact}");
}

/// The hall scene as the bench fetches it (`bench/runner/assets/assets.ts --only sponza`), outside
/// the repository.
fn sponza() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.mesure/assets/sponza/Sponza.gltf")
}

// Behaviour: every page of the hall scene, each primitive under the scale its node places it at, is
// drawn within a tenth of a pixel of the threshold.
#[test]
#[ignore = "needs Sponza under .mesure/assets: node bench/runner/assets/assets.ts --only sponza"]
fn sponza_is_drawn_within_a_tenth_of_a_pixel_of_the_threshold() {
    let path = sponza();
    let g: Value = serde_json::from_slice(&std::fs::read(&path).expect("Sponza.gltf")).unwrap();
    let bin = std::fs::read(path.with_file_name("Sponza.bin")).expect("Sponza.bin");
    let nodes = crate::values(&g, "nodes").unwrap();
    let chosen: BTreeSet<usize> = (0..nodes.len())
        .filter(|&n| nodes[n].get("mesh").is_some())
        .collect();
    let scales = crate::proxy::mesh_scales(&g, &chosen).unwrap();
    let materials = crate::values(&g, "materials").unwrap();
    let validated = BTreeSet::new();
    let mut pages = Vec::new();
    for (m, mesh) in crate::values(&g, "meshes").unwrap().iter().enumerate() {
        for p in crate::values(mesh, "primitives").unwrap() {
            let material = p
                .get("material")
                .and_then(Value::as_u64)
                .map(|i| &materials[i as usize]);
            if crate::unsplit_material(material) {
                continue;
            }
            let accessor = |id: &Value| {
                let id = id.as_u64().expect("accessor index") as usize;
                crate::accessor(&g, &bin, id, None).unwrap()
            };
            let positions = accessor(&p["attributes"]["POSITION"]);
            let pos = positions.collect_f32().unwrap();
            let indices = accessor(&p["indices"]).collect_u32().unwrap();
            let attributes = crate::compiler_page_object::page_attributes(
                &g,
                &bin,
                p,
                positions.count,
                &validated,
            )
            .unwrap();
            let carried = crate::carried_attributes(&attributes, material);
            let blended = material
                .and_then(|m| m.get("alphaMode"))
                .and_then(Value::as_str)
                == Some("BLEND");
            let scale = scales.get(&m).copied();
            pages.extend(measure(&Primitive {
                positions: &pos,
                carried: &carried,
                indices: &indices,
                blended,
                scale,
                tile_log2: tile_log2(scale),
            }));
        }
    }
    assert_within_margin("sponza", &pages);
}
