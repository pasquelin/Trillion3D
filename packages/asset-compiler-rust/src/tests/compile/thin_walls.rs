//! A chalet of thin closed shapes keeps its walls on every level of its cook (#415). Every cut
//! decodes onto its source, flips no face, and still shows each wall a camera on any axis sees.
//! The chalet is the committed scene `see-the-triangles?model=chalet` opens;
//! `scripts/docs/examples/chalet.ts` writes it.
use super::coarse_normals::foreign_normal_defects;
use super::cooked_pages::cooked_page_defects;
use super::silhouette::cut_defects;
use super::site_scene::{cook_site_scene, SiteScene};
use super::*;

/// The chalet cooked with simplification, without texture families: the cut is the subject. Its
/// primitives are the whitewash ground floor, the log wood and the shingle roof, in that order.
fn cook() -> SiteScene {
    let folder = "site/assets/examples/chalet/source";
    cook_site_scene(folder, "chalet.gltf", "chalet", "qem-endpoints")
}

#[test]
fn every_cut_of_a_chalet_of_thin_closed_shapes_keeps_its_walls_facing_out() {
    let scene = cook();
    let objects = &scene.objects;
    let primitives = scene.result["primitives"].as_array().expect("primitives");
    assert_eq!(primitives.len(), 3);
    for primitive in primitives {
        let mesh = scene.mesh(primitive);
        let defects = cooked_page_defects(objects, primitive, &scene.positions(primitive));
        assert!(defects.is_empty(), "{defects:#?}");
        let defects = cut_defects(objects, primitive, &mesh);
        assert!(defects.is_empty(), "{defects:#?}");
        let defects = foreign_normal_defects(objects, primitive, &mesh);
        assert!(defects.is_empty(), "{defects:#?}");
    }
    // The whitewash box, twelve triangles, is one exact root: never simplified, never cut away.
    let whitewash = primitives[0]["pages"].as_array().expect("pages");
    let exact_root = |page: &Value| page["level"] == 0 && page["parentError"].is_null();
    assert!(
        whitewash.len() == 1 && exact_root(&whitewash[0]),
        "{whitewash:#?}"
    );
    for (primitive, name) in [(1, "wood"), (2, "roof")] {
        let levels = primitives[primitive]["pages"]
            .as_array()
            .expect("pages")
            .iter();
        let top = levels.filter_map(|p| p["level"].as_u64()).max();
        assert!(top > Some(1), "the {name} must coarsen more than once");
    }
    let _ = fs::remove_dir_all(&scene.root);
}

#[test]
fn coarse_levels_turned_inside_out_are_reported_flipped_and_lost() {
    let mut scene = cook();
    let objects = scene.objects.clone();
    let source = scene.mesh(&scene.result["primitives"][1]);
    let wood = &mut scene.result["primitives"][1];
    for page in wood["pages"].as_array_mut().expect("pages") {
        if page["level"].as_u64() == Some(0) {
            continue;
        }
        let object = objects.join(format!("{}.bin", page["sha256"].as_str().expect("sha")));
        let mut indices = fs::read(object).expect("index object");
        // Swapping each triangle's last two corners turns every coarse face around.
        for triangle in indices.chunks_mut(12) {
            let (second, third) = triangle[4..].split_at_mut(4);
            second.swap_with_slice(third);
        }
        let digest = hash(&indices);
        fs::write(objects.join(format!("{digest}.bin")), &indices).expect("flipped");
        page["sha256"] = json!(digest);
    }
    let defects = cut_defects(&objects, wood, &source);
    let _ = fs::remove_dir_all(&scene.root);
    for defect in ["faces against its normals", "loses"] {
        assert!(
            defects.iter().any(|d| d.contains(defect)),
            "{defect}: {defects:#?}"
        );
    }
}
/// Digest of what the chalet cooks to: every page, its objects by digest, its errors and bounds.
const CHALET_COOK: &str = "6b2e56bf6ad4cf58b5083b07c5f7dea96dcf0892498766ecaa32ff284a226a99";

/// The cook is the same bytes on every platform: its cache keys and every test above depend on
/// it. A different digest on one platform alone is a cook that is not portable (the C++ of
/// meshoptimizer fused into FMA on arm64 cooked three faces apart from x86_64); a different
/// digest everywhere is a cook that changed, and the constant follows it.
#[test]
fn the_chalet_cooks_to_the_same_bytes_on_every_platform() {
    let scene = cook();
    let digest = hash(&serde_json::to_vec(&scene.result["primitives"]).expect("primitives"));
    let _ = fs::remove_dir_all(&scene.root);
    assert_eq!(digest, CHALET_COOK);
}
