//! The `terrain-tiles` example scene, a textured terrain cooked tile by tile as the open world's
//! is, decodes back to its source on every level (#414): no page carries a vertex away from its
//! surface, on either simplification. The scene is the one `see-the-triangles?model=terrain-tiles`
//! opens; `scripts/docs/examples/terrain-tiles.ts` writes it.
use super::cooked_pages::cooked_page_defects;
use super::silhouette::page_indices;
use super::site_scene::{cook_site_scene, SiteScene};
use super::*;

/// Cooks the scene on `simplification` and checks every page of every tile: none may carry a
/// defect. Returns the cooked scene, whose folder the caller removes.
fn cook_and_check(simplification: &str) -> SiteScene {
    let folder = "site/assets/examples/terrain-tiles/source";
    let scene = cook_site_scene(
        folder,
        "terrain-tiles.gltf",
        "terrain-tiles",
        simplification,
    );
    let primitives = scene.result["primitives"].as_array().expect("primitives");
    let tiles = scene.gltf["meshes"].as_array().expect("meshes").len();
    assert_eq!(
        (primitives.len(), tiles),
        (9, 9),
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
    scene
}

/// On `qem-endpoints`, the same cook then proves the checker sees a moved vertex.
#[test]
fn every_page_of_the_terrain_tiles_cooked_on_qem_endpoints_decodes_onto_its_source() {
    let scene = cook_and_check("qem-endpoints");
    assert_moved_vertices_are_reported(&scene);
    let _ = fs::remove_dir_all(&scene.root);
}

#[test]
fn every_page_of_the_terrain_tiles_cooked_on_none_decodes_onto_its_source() {
    let scene = cook_and_check("none");
    let _ = fs::remove_dir_all(&scene.root);
}

/// The defects the checker finds once the first page at `level` of the first tile is written
/// again with one of its vertices moved `up` metres, as a broken encode or decode would move it.
fn defects_with_a_vertex_moved(
    scene: &SiteScene,
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
    let encoded = crate::geometry_page::encode(&source, &moved, &[], exponent).expect("encode");
    let digest = hash(&encoded.bytes);
    fs::write(scene.objects.join(format!("{digest}.bin")), &encoded.bytes).expect("page");
    page["geometry"]["sha256"] = json!(digest);
    cooked_page_defects(&scene.objects, &primitive, positions)
}

/// An exact page with one vertex half a metre off is reported, since the source and not the page
/// is the reference; a coarse one with a vertex thrown a kilometre up, a sheet across the sky, is
/// reported on every count.
fn assert_moved_vertices_are_reported(scene: &SiteScene) {
    let positions = scene.positions(&scene.result["primitives"][0]);
    let exact = defects_with_a_vertex_moved(scene, &positions, 0, 0.5);
    assert!(exact.iter().any(|d| d.contains("decodes")), "{exact:#?}");
    let coarse = defects_with_a_vertex_moved(scene, &positions, 1, 1000.0);
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
