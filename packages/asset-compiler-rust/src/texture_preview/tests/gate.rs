//! The quality gate, end to end on a cooked scene: what the roles route, what
//! the bar refuses, and what the report says of it.
use super::*;
use crate::texture_preview::blocks::quality::GATE_DB;

fn scene(material: Value) -> Value {
    json!({
        "materials": [material],
        "meshes": [{"primitives": [{"attributes": {}, "material": 0}]}],
        "textures": [{"source": 0}],
        "images": [{"uri": "map.png"}],
    })
}

/// A smooth unit-normal map: X and Y ramps, Z as the shader rebuilds it.
fn normal_map(width: u32, height: u32) -> image::RgbaImage {
    rgba_from(width, height, |x, y| {
        let nx = (x as f32 / width as f32 - 0.5) * 0.8;
        let ny = (y as f32 / height as f32 - 0.5) * 0.8;
        let nz = (1.0 - nx * nx - ny * ny).sqrt();
        let byte = |v: f32| ((v + 1.0) * 127.5).round() as u8;
        [byte(nx), byte(ny), byte(nz), 255]
    })
}

/// Channel noise a single segment cannot hold: the gate refuses it.
fn noise(width: u32, height: u32) -> image::RgbaImage {
    rgba_from(width, height, |x, y| {
        let mut seed = x
            .wrapping_mul(1_103_515_245)
            .wrapping_add(y.wrapping_mul(12_345))
            ^ 0x5eed;
        let mut next = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 24) as u8
        };
        [next(), next(), next(), 255]
    })
}

// Behaviour: a texture only normal maps read is cooked on two channels — a
// `.bc5` file per level above the tail, the tail in that layout — and the
// report counts it as such; the lossless PNG is still there.
#[test]
fn a_normal_map_is_cooked_on_two_channels() {
    let dir = temp_dir("gate-normal");
    normal_map(128, 128)
        .save(dir.join("map.png"))
        .expect("save");
    let (previews, report) = stage_scene(&dir, &scene(json!({"normalTexture": {"index": 0}})));
    assert_eq!(previews.len(), 1);
    let entry = &previews[0];
    assert_eq!(entry.kind, AtlasKind::Data);
    assert_eq!(entry.layouts, [Some(Layout::TwoChannel), None]);
    assert_eq!(entry.blocks[0].len(), preview_block_bytes(128, 128));
    assert!(entry.blocks[1].is_empty());
    let native = dir.join("cache").join("native");
    let file = |format: &str| native.join(level_path(&entry.sha256, AtlasKind::Data, 0, format));
    assert!(file(LOSSLESS).exists());
    assert!(file("bc5").exists());
    assert!(!file("bc7").exists());
    assert_eq!(report["encoded"]["bc7"]["twoChannel"], json!(1));
    assert_eq!(report["encoded"]["bc7"]["rgba"], json!(0));
    assert_eq!(report["encoded"]["bc7"]["lossless"], json!(0));
    assert!(
        report["encoded"]["bc7"]["keptPsnrDb"]["min"]
            .as_f64()
            .unwrap()
            >= GATE_DB
    );
    assert_eq!(report["lossless"], json!([]));
}

// Behaviour: a chain under the bar stays lossless — no block file, an empty
// tail, the family's layout word says so — and the report names it with its
// decibels, its largest gap and its flips.
#[test]
fn a_texture_under_the_bar_stays_lossless_and_is_named() {
    let dir = temp_dir("gate-noise");
    noise(128, 128).save(dir.join("map.png")).expect("save");
    let (previews, report) = stage_scene(
        &dir,
        &scene(json!({"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}})),
    );
    let entry = &previews[0];
    assert_eq!(entry.layouts, [None; 2]);
    assert!(entry.blocks.iter().all(Vec::is_empty));
    let native = dir.join("cache").join("native");
    let file = |format: &str| native.join(level_path(&entry.sha256, AtlasKind::Color, 0, format));
    assert!(file(LOSSLESS).exists());
    assert!(!file("bc7").exists());
    assert_eq!(report["encoded"]["bc7"]["lossless"], json!(1));
    assert_eq!(report["encoded"]["bc7"]["keptPsnrDb"], Value::Null);
    let named = &report["lossless"][0];
    assert_eq!(named["sha256"], json!(entry.sha256));
    assert_eq!(named["atlas"], json!("srgb"));
    assert_eq!(named["format"], json!("bc7"));
    assert_eq!(named["layout"], json!("rgba"));
    assert!(named["psnrDb"].as_f64().unwrap() < GATE_DB);
    assert!(named["maxDelta"].as_u64().unwrap() > 0);
    assert_eq!(named["maskFlips"], json!(0));
    assert_eq!(report["qualityGate"]["psnrDb"], json!(GATE_DB));
}

// Behaviour: a masked texture whose compressed alpha crosses the cutoff on one
// texel stays lossless whatever its decibels — the report counts the flips.
#[test]
fn a_masked_texture_that_flips_a_texel_stays_lossless() {
    let dir = temp_dir("gate-mask");
    // Alpha climbs through the cutoff along X while the colour varies along Y:
    // one RGBA segment per block cannot hold both, and alpha lands off by a few.
    rgba_from(128, 128, |x, y| {
        let alpha = 120 + (x % 8) as u8 * 2;
        [(y * 37 % 256) as u8, (y * 91 % 256) as u8, 60, alpha]
    })
    .save(dir.join("map.png"))
    .expect("save");
    let material = json!({"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}},
        "alphaMode": "MASK", "alphaCutoff": 0.5});
    let (previews, report) = stage_scene(&dir, &scene(material));
    assert_eq!(previews[0].layouts[0], None);
    let named = &report["lossless"][0];
    assert!(named["maskFlips"].as_u64().unwrap() > 0);
    assert_eq!(report["qualityGate"]["maskFlips"], json!(0));
}

// Behaviour: `--textures-format=none` cooks no block family: PNG only, every
// layout word lossless, no gate line, the report saying which families it wrote.
#[test]
fn no_block_family_leaves_every_chain_lossless() {
    let dir = temp_dir("gate-none");
    normal_map(128, 128)
        .save(dir.join("map.png"))
        .expect("save");
    let (previews, report) = stage_scene_in(
        &dir,
        &scene(json!({"normalTexture": {"index": 0}})),
        Vec::new(),
    );
    assert_eq!(previews[0].layouts, [None; 2]);
    assert_eq!(report["blockFormats"], json!([]));
    assert_eq!(report["encoded"], json!({}));
    assert_eq!(report["lossless"], json!([]));
    assert_eq!(report["blockBytes"], json!(0));
}
