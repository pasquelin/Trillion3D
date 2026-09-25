//! The `terrain-tiles` example scene, a textured terrain cooked tile by tile as the open world's
//! is, decodes back to its source on every level (#414): no page carries a vertex away from its
//! surface, on either simplification. The scene is the one `see-the-triangles?model=terrain-tiles`
//! opens; `scripts/docs/examples/terrain-tiles.ts` writes it.
use super::cooked_pages::cooked_page_defects;
use super::dag_dependency_scenes::{cook_site_scene, SiteScene};
use super::*;

fn cook(simplification: &str) -> SiteScene {
    let folder = "site/assets/examples/terrain-tiles/source";
    cook_site_scene(
        folder,
        "terrain-tiles.gltf",
        "terrain-tiles",
        simplification,
    )
}

#[test]
fn every_page_of_the_cooked_terrain_tiles_decodes_onto_its_source_on_both_simplifications() {
    for simplification in ["qem-endpoints", "none"] {
        let scene = cook(simplification);
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
            let (positions, _) = scene.source(primitive);
            let defects = cooked_page_defects(&scene.objects, primitive, &positions);
            assert!(defects.is_empty(), "{simplification}: {defects:#?}");
        }
        let _ = fs::remove_dir_all(&scene.root);
    }
}

/// The defects the checker finds once the first page at `level` of the first tile is written
/// again with one of its vertices moved `up` metres, as a broken encode or decode would move it.
fn defects_with_a_vertex_moved(scene: &SiteScene, level: u64, up: f32) -> Vec<String> {
    let mut result = scene.result.clone();
    let primitive = &mut result["primitives"][0];
    let (positions, _) = scene.source(primitive);
    let exponent = primitive["quantization"]["positionExponent"]
        .as_i64()
        .expect("exponent") as i32;
    let pages = primitive["pages"].as_array_mut().expect("pages");
    let page = pages
        .iter_mut()
        .find(|p| p["level"].as_u64() == Some(level))
        .expect("a page at that level");
    let object = |sha: &Value| {
        scene
            .objects
            .join(format!("{}.bin", sha.as_str().expect("sha")))
    };
    let raw = fs::read(object(&page["sha256"])).expect("index object");
    let source: Vec<u32> = raw
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| u32::from_le_bytes(*b))
        .collect();
    let mut moved = positions.clone();
    moved[source[0] as usize * 3 + 1] += up;
    let encoded = crate::geometry_page::encode(&source, &moved, &[], exponent).expect("encode");
    let digest = hash(&encoded.bytes);
    page["geometry"]["sha256"] = json!(digest);
    fs::write(object(&page["geometry"]["sha256"]), &encoded.bytes).expect("page");
    cooked_page_defects(&scene.objects, &result["primitives"][0], &positions)
}

#[test]
fn a_page_whose_vertex_leaves_the_terrain_is_reported_on_every_level() {
    let scene = cook("qem-endpoints");
    // An exact page with one vertex half a metre off: the source, not the page, is the reference.
    let exact = defects_with_a_vertex_moved(&scene, 0, 0.5);
    // One vertex of a coarse page thrown a kilometre up: a sheet across the sky.
    let coarse = defects_with_a_vertex_moved(&scene, 1, 1000.0);
    let _ = fs::remove_dir_all(&scene.root);
    assert!(exact.iter().any(|d| d.contains("decodes")), "{exact:#?}");
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
