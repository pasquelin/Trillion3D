//! A building of thin closed shapes keeps its walls on every level of its cook, on every case of
//! the family the test generates (`tests/thin_shapes.rs`). Every page decodes inside its bounds
//! and near its source, every cut flips no face against the normals its pages decode, and still
//! shows each wall a camera on any axis sees.
use super::cooked_pages::{cooked_page_defects, cooked_pages, drawn};
use super::cooked_scene::{cook_scene, CookedScene};
use super::silhouette::{cut_defects, Mesh};
use super::*;
use crate::tests::thin_shapes::ThinShapes;

/// `case` cooked with simplification, without texture families: the cut is the subject. Its
/// primitives are the ground floor's box, the wood and the shingle roof, in that order.
fn cook(case: &ThinShapes, tag: &str) -> CookedScene {
    let (gltf, bin) = case.document(tag);
    cook_scene(tag, gltf, bin, &[], "qem-endpoints")
}

#[test]
fn every_cut_of_a_family_of_thin_closed_shapes_keeps_its_walls_facing_out() {
    for (rank, case) in ThinShapes::family().iter().enumerate() {
        let scene = cook(case, &format!("thin-shapes-{rank}"));
        let primitives = scene.result["primitives"].as_array().expect("primitives");
        assert_eq!(primitives.len(), 3, "{case:?}");
        let meshes: Vec<Mesh> = primitives.iter().map(|p| scene.mesh(p)).collect();
        for (rank, (primitive, mesh)) in primitives.iter().zip(&meshes).enumerate() {
            let read = cooked_pages(&scene, primitive);
            let drawn = drawn(&read);
            let defects = cooked_page_defects(read, primitive, &scene.positions(primitive));
            assert!(defects.is_empty(), "{case:?}: {defects:#?}");
            let others = meshes
                .iter()
                .enumerate()
                .filter(|&(other, _)| other != rank);
            let rest = Mesh::merged(others.map(|(_, other)| other));
            let defects = cut_defects(&drawn, primitive, mesh, &rest);
            assert!(defects.is_empty(), "{case:?}: {defects:#?}");
        }
        // The ground floor's box, twelve triangles, is one exact root: never simplified, never
        // cut away.
        let ground = primitives[0]["pages"].as_array().expect("pages");
        let exact_root = |page: &Value| page["level"] == 0 && page["parentError"].is_null();
        assert!(
            ground.len() == 1 && exact_root(&ground[0]),
            "{case:?}: {ground:#?}"
        );
        for (primitive, name) in [(1, "wood"), (2, "roof")] {
            let levels = primitives[primitive]["pages"]
                .as_array()
                .expect("pages")
                .iter();
            let top = levels.filter_map(|p| p["level"].as_u64()).max();
            assert!(
                top > Some(1),
                "{case:?}: the {name} must coarsen more than once"
            );
        }
        let _ = fs::remove_dir_all(&scene.root);
    }
}

#[test]
fn coarse_levels_turned_inside_out_are_reported_flipped_and_lost() {
    let scene = cook(&ThinShapes::FIRST, "thin-shapes-flipped");
    let primitives = scene.result["primitives"].as_array().expect("primitives");
    let wood = &primitives[1];
    let source = scene.mesh(wood);
    let rest = Mesh::merged([0, 2].map(|other| scene.mesh(&primitives[other])).iter());
    let mut drawn = drawn(&cooked_pages(&scene, wood));
    let pages = wood["pages"].as_array().expect("pages");
    for (page, mesh) in pages.iter().zip(&mut drawn) {
        if page["level"].as_u64() == Some(0) {
            continue;
        }
        // Swapping each triangle's last two corners turns every coarse face around.
        for triangle in mesh.indices.chunks_mut(3) {
            triangle.swap(1, 2);
        }
    }
    let defects = cut_defects(&drawn, wood, &source, &rest);
    let _ = fs::remove_dir_all(&scene.root);
    for defect in ["faces against its normals", "loses"] {
        assert!(
            defects.iter().any(|d| d.contains(defect)),
            "{defect}: {defects:#?}"
        );
    }
}
/// Digest of what the family's first case cooks to: every page, its objects by digest, its
/// errors and bounds.
const FIRST_CASE_COOK: &str = "907eb94dc9ebc8b0fef4b79afae8f00e7e863ca469bb424732553a10aa5aae0f";

/// The cook is the same bytes on every platform: its cache keys and every test above depend on
/// it. A different digest on one platform alone is a cook that is not portable (the simplifier's
/// C++, fused into FMA on arm64, cooked three faces apart from x86_64; the platform's
/// `acos` published a normal deviation one bit apart on macOS and glibc); a different digest
/// everywhere is a cook that changed, and the constant follows it.
#[test]
fn thin_closed_shapes_cook_to_the_same_bytes_on_every_platform() {
    let scene = cook(&ThinShapes::FIRST, "thin-shapes-digest");
    let digest = hash(&serde_json::to_vec(&scene.result["primitives"]).expect("primitives"));
    let _ = fs::remove_dir_all(&scene.root);
    assert_eq!(digest, FIRST_CASE_COOK);
}

/// TEMPORARY probe, TO DELETE once the cut-0 hole is understood: per member of the family and
/// per primitive, each source triangle matched against the decoded level-0 triangles (same
/// corners within 1e-3, same winding): the missing ones, the turned ones, the decoded ones no
/// source triangle explains, and the cut-0 defects.
/// Run: cargo test --release thin_walls_level0_probe -- --ignored --nocapture
#[test]
#[ignore]
fn thin_walls_level0_probe() {
    type P = [f64; 3];
    let near = |a: P, b: P| (0..3).all(|k| (a[k] - b[k]).abs() <= 1e-3);
    let same = |a: [P; 3], b: [P; 3]| (0..3).any(|r| (0..3).all(|k| near(a[k], b[(k + r) % 3])));
    let turned = |a: [P; 3], b: [P; 3]| same(a, [b[0], b[2], b[1]]);
    let cell = |t: &[P; 3]| {
        (0..3)
            .map(|k| ((t[0][k] + t[1][k] + t[2][k]) / 3.0 / 0.05).floor() as i64)
            .collect::<Vec<_>>()
    };
    for (rank, case) in ThinShapes::family().iter().enumerate() {
        let scene = cook(case, &format!("thin-shapes-l0-probe-{rank}"));
        let primitives = scene.result["primitives"].as_array().expect("primitives");
        let meshes: Vec<Mesh> = primitives.iter().map(|p| scene.mesh(p)).collect();
        for (index, (primitive, mesh)) in primitives.iter().zip(&meshes).enumerate() {
            let pages = primitive["pages"].as_array().expect("pages");
            let read = cooked_pages(&scene, primitive);
            let drawn = drawn(&read);
            let mut decoded: std::collections::HashMap<Vec<i64>, Vec<([P; 3], usize, bool)>> =
                Default::default();
            let mut decoded_count = 0;
            for (id, (page, m)) in pages.iter().zip(&drawn).enumerate() {
                if page["level"].as_u64() != Some(0) {
                    continue;
                }
                for c in m.indices.chunks(3) {
                    let t = [0, 1, 2].map(|k| m.positions[c[k] as usize]);
                    decoded.entry(cell(&t)).or_default().push((t, id, false));
                    decoded_count += 1;
                }
            }
            let (mut missing, mut flipped) = (Vec::new(), 0);
            for c in mesh.indices.chunks(3) {
                let t = [0, 1, 2].map(|k| mesh.positions[c[k] as usize]);
                let key = cell(&t);
                let mut found = false;
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        for dz in -1..=1 {
                            let k = vec![key[0] + dx, key[1] + dy, key[2] + dz];
                            for entry in decoded.get_mut(&k).into_iter().flatten() {
                                if !found && !entry.2 && same(t, entry.0) {
                                    entry.2 = true;
                                    found = true;
                                } else if !found && !entry.2 && turned(t, entry.0) {
                                    flipped += 1;
                                }
                            }
                        }
                    }
                }
                if !found {
                    missing.push(t);
                }
            }
            let unexplained: Vec<(usize, [P; 3])> = decoded
                .values()
                .flatten()
                .filter(|e| !e.2)
                .map(|e| (e.1, e.0))
                .collect();
            eprintln!(
                "probe case {rank} p{index}: source {} level0 {decoded_count} pages {} missing {} \
                 turned {flipped} unexplained {}",
                mesh.indices.len() / 3,
                pages
                    .iter()
                    .filter(|p| p["level"].as_u64() == Some(0))
                    .count(),
                missing.len(),
                unexplained.len()
            );
            let error = |page: &Value, key: &str| page[key].as_f64().unwrap_or(f64::INFINITY);
            for (id, page) in pages.iter().enumerate() {
                let (lod, parent) = (error(page, "lodError"), error(page, "parentError"));
                let level = page["level"].as_u64().unwrap_or(0);
                let at_zero = crate::proxy::cut::in_cut(lod, parent, 0.0);
                if at_zero != (level == 0) {
                    eprintln!("probe   page {id} level {level} lod {lod:e} parent {parent:e} drawn {at_zero}");
                }
            }
            for t in missing.iter().take(4) {
                eprintln!("probe   missing {t:?}");
            }
            for (id, t) in unexplained.iter().take(4) {
                eprintln!("probe   unexplained page {id} {t:?}");
            }
            let others = meshes.iter().enumerate().filter(|&(o, _)| o != index);
            let rest = Mesh::merged(others.map(|(_, other)| other));
            for d in cut_defects(&drawn, primitive, mesh, &rest) {
                if d.starts_with("cut 0:") {
                    eprintln!("probe   {d}");
                }
            }
        }
        let _ = fs::remove_dir_all(&scene.root);
    }
}
