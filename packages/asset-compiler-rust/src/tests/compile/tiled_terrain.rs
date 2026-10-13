//! A textured terrain the test generates, cooked tile by tile as an open world's is — each tile a
//! mesh and a node of its own, two ridges and a flat valley floor so the simplification meets
//! both slopes and a plane —, decodes back to its source on every level: no page carries a vertex
//! away from its surface, on either simplification. The engine's terrain test scene is held to
//! the same.
use super::cooked_pages::cooked_page_defects;
use super::cooked_scene::{cook_fixture, cook_scene, CookedScene, ENGINE_SCENES};
use super::silhouette::page_indices;
use super::*;
use crate::tests::fixtures::portable_sin;
use crate::tests::scene_document::{SceneDocument, Surface};
use crate::tests::textures::identity_textures::png_sized;

/// Tiles along each side, quads along a tile's side and the metres between two samples.
const TILES: usize = 3;
const QUADS: usize = 32;
const SPACING: f32 = 8.0;

/// The height at (x, z), in metres: two ridges and a flat valley floor where the relief dips
/// under -10 m.
fn height(x: f32, z: f32) -> f32 {
    (portable_sin(x * 0.011) * portable_sin(z * 0.017 + 1.0) * 60.0).max(-10.0) + 40.0
}

/// One tile whose corner lies at (x0, z0): positions from that corner, heights on a 1/256 m grid
/// from the one terrain across every tile, normals by central differences, one texture repeat
/// over the tile.
fn tile(x0: f32, z0: f32) -> Surface {
    let side = QUADS + 1;
    let mut out = Surface::default();
    for j in 0..side {
        for i in 0..side {
            let (x, z) = (i as f32 * SPACING, j as f32 * SPACING);
            let at = |dx: f32, dz: f32| height(x0 + x + dx, z0 + z + dz);
            let (dx, dz) = (at(0.5, 0.0) - at(-0.5, 0.0), at(0.0, 0.5) - at(0.0, -0.5));
            let length = (dx * dx + 1.0 + dz * dz).sqrt();
            out.positions
                .extend([x, (at(0.0, 0.0) * 256.0).round() / 256.0, z]);
            out.normals
                .extend([-dx / length, 1.0 / length, -dz / length]);
            out.uvs
                .extend([i as f32 / QUADS as f32, j as f32 / QUADS as f32]);
        }
    }
    let side = side as u32;
    for j in 0..side - 1 {
        for i in 0..side - 1 {
            let a = j * side + i;
            out.indices
                .extend([a, a + side, a + 1, a + 1, a + side, a + side + 1]);
        }
    }
    out
}

/// The terrain's document, one mesh and one node a tile, every tile reading `ground.png`.
fn terrain(tag: &str) -> (Value, Vec<u8>) {
    let mut document = SceneDocument::default();
    let ground = document.material([1.0; 3], Some("ground.png"));
    for row in 0..TILES {
        for column in 0..TILES {
            let [x, z] = [column, row].map(|k| (k * QUADS) as f32 * SPACING);
            let mesh = document.mesh(&[(&tile(x, z), ground)]);
            document.node(mesh, [x, 0.0, z]);
        }
    }
    document.finish(tag)
}

/// Cooks the terrain on `simplification` and checks every page of every tile: none may carry a
/// defect. Then holds the engine's test scenes to the same. Returns the cooked terrain, whose
/// folder the caller removes.
fn cook_and_check(simplification: &str) -> CookedScene {
    let tag = format!("tiled-terrain-{simplification}");
    let (gltf, bin) = terrain(&tag);
    let ground = [("ground.png".to_string(), png_sized(8, [90, 120, 60, 255]))];
    let scene = cook_scene(&tag, gltf, bin, &ground, simplification);
    let primitives = scene.result["primitives"].as_array().expect("primitives");
    let tiles = scene.gltf["meshes"].as_array().expect("meshes").len();
    assert_eq!(
        (primitives.len(), tiles),
        (TILES * TILES, TILES * TILES),
        "{simplification}: one primitive per tile"
    );
    for primitive in primitives {
        let top = primitive["pages"]
            .as_array()
            .expect("pages")
            .iter()
            .filter_map(|p| p["level"].as_u64())
            .max();
        assert_eq!(
            top > Some(1),
            simplification != "none",
            "{simplification}: levels {top:?}"
        );
        let positions = scene.positions(primitive);
        let defects = cooked_page_defects(&scene.objects, primitive, &positions);
        assert!(defects.is_empty(), "{simplification}: {defects:#?}");
    }
    for (folder, gltf, tag) in ENGINE_SCENES {
        let fixture = cook_fixture(folder, gltf, tag, simplification);
        for primitive in fixture.result["primitives"].as_array().expect("primitives") {
            let positions = fixture.positions(primitive);
            let defects = cooked_page_defects(&fixture.objects, primitive, &positions);
            assert!(
                defects.is_empty(),
                "{folder}, {simplification}: {defects:#?}"
            );
        }
        let _ = fs::remove_dir_all(&fixture.root);
    }
    scene
}

/// On `qem-endpoints`, the same cook then proves the checker sees a moved vertex.
#[test]
fn every_page_of_a_tiled_terrain_cooked_on_qem_endpoints_decodes_onto_its_source() {
    let scene = cook_and_check("qem-endpoints");
    assert_moved_vertices_are_reported(&scene);
    let _ = fs::remove_dir_all(&scene.root);
}

#[test]
fn every_page_of_a_tiled_terrain_cooked_on_none_decodes_onto_its_source() {
    let scene = cook_and_check("none");
    let _ = fs::remove_dir_all(&scene.root);
}

/// The defects the checker finds once the first page at `level` of the first tile is written
/// again with one of its vertices moved `up` metres, as a broken encode or decode would move it.
fn defects_with_a_vertex_moved(
    scene: &CookedScene,
    positions: &[f32],
    level: u64,
    up: f32,
) -> Vec<String> {
    let mut primitive = scene.result["primitives"][0].clone();
    let exponent = primitive["quantization"]["positionExponent"]
        .as_i64()
        .expect("exponent") as i32;
    let pages = primitive["pages"].as_array_mut().expect("pages");
    let page = pages
        .iter_mut()
        .find(|p| p["level"].as_u64() == Some(level))
        .expect("a page at that level");
    let source = page_indices(&scene.objects, page);
    let mut moved = positions.to_vec();
    moved[source[0] as usize * 3 + 1] += up;
    let encoded = trillion3d_page_codec::encode::encode(
        &source,
        &moved,
        &[],
        exponent,
        trillion3d_page_codec::bits::grid::UV_EXPONENT,
    )
    .expect("encode");
    let digest = hash(&encoded.bytes);
    fs::write(scene.objects.join(format!("{digest}.bin")), &encoded.bytes).expect("page");
    page["geometry"]["sha256"] = json!(digest);
    cooked_page_defects(&scene.objects, &primitive, positions)
}

/// An exact page with one vertex half a metre off is reported, since the source and not the page
/// is the reference; a coarse one with a vertex moved by a quarter of its representable range,
/// a sheet across the sky that still encodes on the primitive grid, is reported on every count.
fn assert_moved_vertices_are_reported(scene: &CookedScene) {
    let positions = scene.positions(&scene.result["primitives"][0]);
    let exact = defects_with_a_vertex_moved(scene, &positions, 0, 0.5);
    assert!(exact.iter().any(|d| d.contains("decodes")), "{exact:#?}");
    let exponent = scene.result["primitives"][0]["quantization"]["positionExponent"]
        .as_i64()
        .expect("exponent") as i32;
    let up = 2f32.powi(exponent + trillion3d_page_codec::bits::MAX_BITS as i32 - 2);
    let coarse = defects_with_a_vertex_moved(scene, &positions, 1, up);
    for defect in [
        "decodes",
        "outside its bounds",
        "outside its sphere",
        "leaves group",
    ] {
        assert!(
            coarse.iter().any(|d| d.contains(defect)),
            "{defect}: {coarse:#?}"
        );
    }
}
