//! The audit's meshes and Sponza, measured through the page path (`super::measure`).
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

// Behaviour: every page of the audit's four meshes, drawn by the cut at 0.5, 1 and 2 pixels with
// the camera 2 m or 10 m away, stays within a tenth of a pixel of the threshold (CMP-08).
#[test]
fn the_audits_meshes_are_drawn_within_a_tenth_of_a_pixel_of_the_threshold() {
    let meshes = [
        ("terrain", terrain(257, 1024.0)),
        ("sphere", sphere(6, 5.0)),
        ("building", building()),
        ("vegetation", vegetation()),
    ];
    for (name, mesh) in &meshes {
        assert_within_margin(name, &measured(mesh, tile_log2(None)));
    }
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

/// Sponza as the bench fetches it (`bench/runner/assets.ts --only sponza`), outside the
/// repository.
fn sponza() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.mesure/assets/sponza/Sponza.gltf")
}

// Behaviour: every page of Sponza, each primitive under the scale its node places it at, is drawn
// within a tenth of a pixel of the threshold.
#[test]
#[ignore = "needs Sponza under .mesure/assets: node bench/runner/assets.ts --only sponza"]
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
            let accessor = |name: &str| {
                let id = p["attributes"]
                    .get(name)
                    .or(p.get(name))
                    .and_then(Value::as_u64);
                crate::accessor(&g, &bin, id.expect(name) as usize, None).unwrap()
            };
            let positions = accessor("POSITION");
            let pos = positions.collect_f32().unwrap();
            let indices = accessor("indices").collect_u32().unwrap();
            let attributes = crate::compiler_page_object::page_attributes(
                &g,
                &bin,
                p,
                positions.count,
                &validated,
            )
            .unwrap();
            let carried = crate::carried_attributes(&attributes, material);
            let blended = material.and_then(|m| m.get("alphaMode")) == Some(&Value::from("BLEND"));
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
