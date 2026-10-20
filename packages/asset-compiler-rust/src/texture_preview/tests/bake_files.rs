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
// `first_level` files — under `textures/v10/<chain>/<atlas>-<k>.bc7`, sidecar tail starts
// at 64 px: each the level's BC7 blocks, laid out in deflated tile records, no
// other file; and the tail in blocks too.
#[test]
fn levels_above_the_tail_are_written_once_per_atlas_in_the_stored_blocks() {
    let dir = scratch("texture-preview", "bake-files");
    // A ramp along one direction: one segment per block holds it, the gate keeps it.
    let source = rgba_from(256, 256, |x, _| [x as u8, 255 - x as u8, 77, 255]);
    source.save(dir.join("leaf.png")).expect("save");
    let (previews, report) = stage(&dir);
    assert_eq!(previews.len(), 2);
    assert_eq!(previews[0].kind, AtlasKind::Color);
    assert_eq!(previews[1].kind, AtlasKind::Data);
    assert_eq!(
        previews[0].image_sha256, previews[1].image_sha256,
        "same image, same fingerprint"
    );
    assert_eq!(
        previews[0].first_level, 2,
        "256 → 64: two levels above the tail"
    );
    assert_eq!(previews[0].baked_levels, 2);
    assert_eq!(report["bakedLevels"], json!(4));
    let native = dir.join("cache").join("native");
    // The channels each atlas's reader measures: the opaque base colour's RGB, occlusion's R.
    for (kind, expected, channels) in [
        (AtlasKind::Color, &previews[0], [true, true, true, false]),
        (AtlasKind::Data, &previews[1], [true, false, false, false]),
    ] {
        // The level files are the chain encoder's: fast, or slow when the fast chain fails.
        let chain = reduce::chain(&source, kind);
        let sizes: Vec<(u32, u32)> = preview_level_sizes(256, 256).collect();
        let codec = (BlockFormat::Bc7, Layout::Rgba);
        let (fast, measure) = blocks::quality::fast_chain(&chain, &sizes, codec, channels, &[]);
        let encoded = if measure.passes() {
            fast
        } else {
            blocks::quality::slow_chain(&chain, &sizes, codec, &fast, channels, &[]).0
        };
        for level in 0..2u32 {
            let (w, h) = preview_level_size(256, 256, level);
            let encoded = &encoded[level as usize];
            let blocks = fs::read(native.join(level_path(&expected.sha256, kind, level, "bc7")))
                .expect("block level");
            assert_eq!(blocks, tile_records(encoded, w, h), "tile records");
            assert!(!native
                .join(level_path(&expected.sha256, kind, level, "astc"))
                .exists());
        }
        let missing = native.join(level_path(&expected.sha256, kind, 2, "bc7"));
        assert!(
            !missing.exists(),
            "the tail remains in the sidecar, not as a file"
        );
        assert_eq!(expected.layouts, [Some(Layout::Rgba), None, None]);
        assert_eq!(expected.blocks[0].len(), preview_block_bytes(256, 256));
        assert!(expected.blocks[1].is_empty());
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
    let dir = scratch("texture-preview", "bake-reuse");
    rgba_from(128, 128, |x, _| [x as u8, 0, 0, 255])
        .save(dir.join("leaf.png"))
        .expect("save");
    let (previews, _) = stage(&dir);
    let path = dir.join("cache").join("native").join(level_path(
        &previews[0].sha256,
        AtlasKind::Color,
        0,
        "bc7",
    ));
    let stamp = b"not blocks, and no one should touch them";
    fs::write(&path, stamp).expect("overwrite");
    let modified = fs::metadata(&path)
        .expect("meta")
        .modified()
        .expect("mtime");
    let (_, report) = stage(&dir);
    assert_eq!(fs::read(&path).expect("read back"), stamp);
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
    let dir = scratch("texture-preview", "bake-small");
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
// report names failure. Engine loads source image unchanged.
#[test]
fn a_level_that_cannot_be_written_keeps_the_tail_and_bakes_nothing() {
    let dir = scratch("texture-preview", "bake-unwritable");
    let source = rgba_from(128, 128, |x, _| [x as u8, 0, 0, 255]);
    source.save(dir.join("leaf.png")).expect("save");
    let native = dir.join("cache").join("native");
    fs::create_dir_all(&native).expect("native");
    fs::write(native.join(TEXTURE_DIR), b"not a folder").expect("block");
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
