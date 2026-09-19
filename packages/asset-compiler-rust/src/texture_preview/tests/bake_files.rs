use super::*;

fn scene_with_two_readers() -> Value {
    json!({
        "materials": [
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}},
            {"occlusionTexture": {"index": 1}},
        ],
        "meshes": [{"primitives": [
            {"attributes": {}, "material": 0},
            {"attributes": {}, "material": 1},
        ]}],
        "textures": [{"source": 0}, {"source": 0}],
        "images": [{"uri": "leaf.png"}],
    })
}

fn stage(dir: &Path) -> (Vec<TexturePreview>, Value) {
    stage_scene(dir, &scene_with_two_readers())
}

// Behavior 9: 256 px image read by both atlases decoded once, yielding two
// entries, one per atlas; each writes levels above tail — 256 and 128 px, i.e.
// `first_level` files — under `textures/v3/<sha>/<atlas>-<k>.png`, sidecar tail starts
// at 64 px. PNG is lossless: re-read, gives exact level bytes.
#[test]
fn levels_above_the_tail_are_written_once_per_atlas_as_lossless_png() {
    let dir = temp_dir("bake-files");
    let source = rgba_from(256, 256, |x, y| [(x % 256) as u8, (y % 256) as u8, 77, 255]);
    source.save(dir.join("leaf.png")).expect("save");
    let (previews, report) = stage(&dir);
    assert_eq!(previews.len(), 2);
    assert_eq!(previews[0].kind, AtlasKind::Color);
    assert_eq!(previews[1].kind, AtlasKind::Data);
    assert_eq!(
        previews[0].sha256, previews[1].sha256,
        "same image, same fingerprint"
    );
    assert_eq!(
        previews[0].first_level, 2,
        "256 → 64 : deux niveaux au-dessus de la queue"
    );
    assert_eq!(previews[0].baked_levels, 2);
    assert_eq!(report["bakedLevels"], json!(4));
    let native = dir.join("cache").join("native");
    for (kind, expected) in [
        (AtlasKind::Color, &previews[0]),
        (AtlasKind::Data, &previews[1]),
    ] {
        for level in 0..2u32 {
            let path = native.join(crate::texture_preview::bake::level_path(
                &expected.sha256,
                kind,
                level,
            ));
            assert!(path.exists(), "{} doit exister", path.display());
            let decoded = image::open(&path).expect("png relisible").to_rgba8();
            let (w, h) = preview_level_size(256, 256, level);
            assert_eq!((decoded.width(), decoded.height()), (w, h));
            let chain = reduce::chain(&source, kind);
            assert_eq!(
                decoded.as_raw(),
                &chain[level as usize],
                "niveau {level} sans perte"
            );
        }
        let missing = native.join(crate::texture_preview::bake::level_path(
            &expected.sha256,
            kind,
            2,
        ));
        assert!(
            !missing.exists(),
            "la queue reste dans le sidecar, pas en fichier"
        );
    }
    // Report counts both atlases.
    assert_eq!(report["colorTextures"], json!(1));
    assert_eq!(report["dataTextures"], json!(1));
    assert_eq!(report["previews"], json!(2));
}

// Behavior 9 (b): level already written is not rewritten — hash and atlas confirm
// content correct. File retains timestamp and content.
#[test]
fn an_existing_level_file_is_left_untouched() {
    let dir = temp_dir("bake-reuse");
    rgba_from(128, 128, |x, _| [x as u8, 0, 0, 255])
        .save(dir.join("leaf.png"))
        .expect("save");
    let (previews, _) = stage(&dir);
    let path = dir
        .join("cache")
        .join("native")
        .join(crate::texture_preview::bake::level_path(
            &previews[0].sha256,
            AtlasKind::Color,
            0,
        ));
    let stamp = b"pas un png, et personne ne doit y toucher";
    fs::write(&path, stamp).expect("overwrite");
    let modified = fs::metadata(&path)
        .expect("meta")
        .modified()
        .expect("mtime");
    let (_, report) = stage(&dir);
    assert_eq!(fs::read(&path).expect("relire"), stamp);
    assert_eq!(
        fs::metadata(&path)
            .expect("meta")
            .modified()
            .expect("mtime"),
        modified
    );
    assert_eq!(report["bakedLevels"], json!(2));
}

// Behavior 9 (c): image fitting under base writes no files — everything in
// sidecar — count confirms.
#[test]
fn a_small_image_bakes_nothing_to_disk() {
    let dir = temp_dir("bake-small");
    rgba_from(32, 32, |_, _| [1, 2, 3, 255])
        .save(dir.join("leaf.png"))
        .expect("save");
    let (previews, report) = stage(&dir);
    assert_eq!(previews[0].baked_levels, 0);
    assert_eq!(report["bakedLevels"], json!(0));
    assert!(!dir.join("cache").join("native").join("textures").exists());
}

// Behavior 9 (d): unwritable level — here file in place of textures
// folder — does not forfeit tail: entry outputs `baked_levels = 0`, tail intact,
// report names failure. Engine loads source image as before.
#[test]
fn a_level_that_cannot_be_written_keeps_the_tail_and_bakes_nothing() {
    let dir = temp_dir("bake-unwritable");
    let source = rgba_from(128, 128, |x, _| [x as u8, 0, 0, 255]);
    source.save(dir.join("leaf.png")).expect("save");
    let native = dir.join("cache").join("native");
    fs::create_dir_all(&native).expect("native");
    fs::write(native.join(TEXTURE_DIR), b"pas un dossier").expect("bloquer");
    let (previews, report) = stage(&dir);
    assert_eq!(previews.len(), 2);
    let (first, tail) = tail_of(&source, AtlasKind::Color);
    assert_eq!(previews[0].first_level, first);
    assert_eq!(previews[0].baked_levels, 0);
    assert_eq!(previews[0].pixels, tail, "the tail is whole");
    assert_eq!(report["bakedLevels"], json!(0));
    assert_eq!(report["notes"]["texture-level-write-failed"], json!(1));
    assert_eq!(report["previews"], json!(2));
}
