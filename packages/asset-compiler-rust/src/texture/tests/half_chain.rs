use super::*;
use crate::texture::hdr;
use half::f16;

/// A level's texel `at`, each channel decoded from the atlas's half-float bytes.
fn texel(level: &[u8], at: usize) -> [f32; 4] {
    std::array::from_fn(|channel| {
        let from = at * hdr::HALF_TEXEL_BYTES + channel * 2;
        f16::from_le_bytes([level[from], level[from + 1]]).to_f32()
    })
}

/// Writes a 256×256 radiance image `sky.hdr` into `dir` and returns the scene whose `material`
/// reads it through `texture`.
fn sky_scene(dir: &std::path::Path, material: Value, texture: Value) -> Value {
    let mut hdr_file = b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 256 +X 256\n".to_vec();
    for _ in 0..256 * 256 {
        hdr_file.extend_from_slice(&[200, 100, 50, 130]);
    }
    fs::write(dir.join("sky.hdr"), hdr_file).expect("write");
    json!({
        "materials": [material],
        "meshes": [{"primitives": [{"attributes": {}, "material": 0}]}],
        "textures": [texture],
        "images": [{"uri": "sky.hdr"}],
    })
}

// Behaviour: a floating image keeps every value it holds in its chain — a value past one, a
// negative one — as half-floats, and a level is the mean of the four texels of every channel,
// alpha included.
#[test]
fn a_float_chain_keeps_values_past_one_and_means_every_channel() {
    let source = [
        [0.0, 1.0, -2.0, 0.0],
        [0.0, 1.0, -2.0, 0.0],
        [0.0, 1.0, -2.0, 0.0],
        [400.0, 1.0, -2.0, 1.0],
    ]
    .concat();
    let chain = hdr::chain(2, 2, &source);
    assert_eq!(chain.len(), 2, "2×2 then 1×1");
    assert_eq!(chain[0].len(), 4 * hdr::HALF_TEXEL_BYTES);
    assert_eq!(texel(&chain[0], 3), [400.0, 1.0, -2.0, 1.0]);
    assert_eq!(texel(&chain[1], 0), [100.0, 1.0, -2.0, 0.25]);
}

// Behaviour: a value past the half-float range holds at its largest finite value, never
// infinity; a NaN reads as zero.
#[test]
fn a_value_past_the_half_range_holds_at_the_largest_finite_half() {
    let chain = hdr::chain(1, 1, &[f32::INFINITY, -1.0e9, f32::NAN, 1.0]);
    assert_eq!(texel(&chain[0], 0), [65504.0, -65504.0, 0.0, 1.0]);
}

// Behaviour: a level is reduced from the level above in float, never from the half-floats it was
// stored as: three quadrants a third of an ulp over one and a fourth six tenths of an ulp over
// give, in float, half an ulp and more over one — one ulp — where means of stored halves would
// give a quarter of an ulp, which rounds back to one.
#[test]
fn a_level_is_reduced_in_float_not_from_the_half_floats_stored() {
    let ulp = 2.0_f32.powi(-10);
    let value = |x: u32, y: u32| {
        if x >= 2 && y >= 2 {
            1.0 + 0.6 * ulp
        } else {
            1.0 + 0.49 * ulp
        }
    };
    let source: Vec<f32> = (0..16)
        .flat_map(|at| {
            let v = value(at % 4, at / 4);
            [v, v, v, 1.0]
        })
        .collect();
    let chain = hdr::chain(4, 4, &source);
    assert_eq!(chain.len(), 3);
    assert_eq!(
        texel(&chain[1], 0)[0],
        1.0,
        "a quadrant alone rounds back to one"
    );
    assert_eq!(texel(&chain[2], 0)[0], 1.0 + ulp);
}

// Behaviour: a floating image read as a base colour is baked in the half-float atlas: its tail in
// the sidecar's pixel column, held by no block family, and the levels above the tail as
// `rgba16f` files of tile records of half-float texels, shared by every texture that reads the
// image.
#[test]
fn a_float_base_colour_bakes_half_float_levels_and_a_tail() {
    let dir = scratch("texture-preview", "half-float");
    let g = sky_scene(
        &dir,
        json!({"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}),
        json!({"source": 0}),
    );
    let (previews, report) = stage_scene(&dir, &g);
    assert_eq!(previews.len(), 1);
    let entry = &previews[0];
    assert_eq!(entry.kind, AtlasKind::Hdr);
    assert_eq!((entry.first_level, entry.baked_levels), (2, 2));
    assert_eq!(entry.layouts, [None; FAMILIES]);
    assert!(entry.blocks.iter().all(Vec::is_empty));
    assert_eq!(
        entry.pixels.len(),
        preview_pixel_bytes(256, 256, AtlasKind::Hdr)
    );
    let last = entry.pixels.len() / hdr::HALF_TEXEL_BYTES - 1;
    assert_eq!(texel(&entry.pixels, last), [3.125, 1.5625, 0.78125, 1.0]);
    assert_eq!(report["bakedLevels"], json!(2));
    assert_eq!(report["skipped"], json!({}));
    let native = dir.join("cache").join("native");
    let file = |level| level_path(&entry.sha256, AtlasKind::Hdr, level, hdr::HALF_FILE);
    let level0 = fs::read(native.join(file(0))).expect("level 0");
    let level1 = fs::read(native.join(file(1))).expect("level 1");
    let chain = hdr::chain(
        256,
        256,
        &vec![[3.125, 1.5625, 0.78125, 1.0]; 256 * 256].concat(),
    );
    assert_eq!(level0, tile_records(&chain[0], 256, 256, HALF_CELL));
    assert_eq!(level1, tile_records(&chain[1], 128, 128, HALF_CELL));
    assert!(
        !native.join(file(2)).exists(),
        "the tail stays in the sidecar"
    );
}

// Behaviour: a floating image read only through a data role — metal-roughness, normal, occlusion,
// height — has no half-float pool to hold it: no chain, the reason named in the report.
#[test]
fn a_float_image_read_by_a_data_role_alone_is_named_unsupported() {
    let dir = scratch("texture-preview", "half-float-data");
    fs::write(
        dir.join("sky.hdr"),
        [
            b"#?RADIANCE\n\n-Y 1 +X 1\n".as_slice(),
            &[128, 128, 128, 129],
        ]
        .concat(),
    )
    .expect("write");
    let g = json!({
        "materials": [{"occlusionTexture": {"index": 0}}],
        "meshes": [{"primitives": [{"attributes": {}, "material": 0}]}],
        "textures": [{"source": 0}],
        "images": [{"uri": "sky.hdr"}],
    });
    let (previews, report) = stage_scene(&dir, &g);
    assert!(previews.is_empty());
    assert_eq!(
        report["skipped"],
        json!({"image-float-data-unsupported": 1})
    );
}

// Behaviour: a floating base colour whose setting is `hdrCompressed` keeps its half-float tail
// and carries the same tail in BC6H blocks, a `bc6h` file per level above it standing in for the
// `rgba16f` ones; a data map asking for floating point is cooked as the default and named.
#[test]
fn an_hdr_compressed_texture_is_cooked_in_bc6h() {
    let dir = scratch("texture-preview", "half-float-bc6h");
    let g = sky_scene(
        &dir,
        json!({"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}),
        json!({"source": 0, "extras": {"compression": "hdrCompressed"}}),
    );
    let (previews, _) = stage_scene(&dir, &g);
    let entry = &previews[0];
    assert_eq!(entry.kind, AtlasKind::Hdr);
    assert_eq!(entry.layouts, [Some(Layout::Hdr), None, None]);
    assert_eq!(
        entry.pixels.len(),
        preview_pixel_bytes(256, 256, AtlasKind::Hdr)
    );
    assert_eq!(
        entry.blocks[0].len(),
        preview_layout_bytes(256, 256, Layout::Hdr)
    );
    assert_eq!((entry.first_level, entry.baked_levels), (2, 2));
    let native = dir.join("cache").join("native");
    let file =
        |level, format| native.join(level_path(&entry.sha256, AtlasKind::Hdr, level, format));
    assert!(file(0, "bc6h").exists() && file(1, "bc6h").exists());
    assert!(!file(0, hdr::HALF_FILE).exists());
}

/// A Radiance image of 256 × 256 texels all of one value, read by `material` as a glTF texture whose
/// setting is `compression`.
fn float_scene(name: &str, compression: &str, material: Value) -> (std::path::PathBuf, Value) {
    let dir = scratch("texture-preview", name);
    let g = sky_scene(
        &dir,
        material,
        json!({"source": 0, "extras": {"compression": compression}}),
    );
    (dir, g)
}

// Behaviour: a texture whose setting is `hdrF32` keeps its four channels as 32-bit floats: the
// half-float atlas's chain with the exact squares in the stored family's column and `rgba32f`
// files for the levels above the tail, one 4 × 4 square of sixteen texels to a block.
#[test]
fn an_hdr_f32_texture_keeps_32_bit_floats() {
    let base = json!({"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}});
    let (dir, g) = float_scene("float-32", "hdrF32", base);
    let (previews, _) = stage_scene(&dir, &g);
    let entry = &previews[0];
    assert_eq!(entry.kind, AtlasKind::Hdr);
    assert_eq!(entry.layouts, [Some(Layout::Float32), None, None]);
    assert_eq!(
        entry.blocks[0].len(),
        preview_layout_bytes(256, 256, Layout::Float32)
    );
    assert_eq!((entry.first_level, entry.baked_levels), (2, 2));
    // The tail's first texel, exact: the colour of the file's texel, not rounded to a half-float.
    let first = f32::from_le_bytes(entry.blocks[0][..4].try_into().unwrap());
    assert_eq!(first, 3.125);
    let native = dir.join("cache").join("native");
    assert!(native
        .join(level_path(&entry.sha256, AtlasKind::Hdr, 0, "rgba32f"))
        .exists());
}

// Behaviour: `singleFloat` and `halfFloat` keep the red channel alone, as 32-bit floats or
// half-floats, in the data atlas: `r32f` and `r16f` files, the sidecar's own texels a grey proxy.
#[test]
fn single_channel_float_settings_keep_one_channel() {
    for (setting, layout, file, bytes) in [
        ("singleFloat", Layout::SingleFloat, "r32f", 4),
        ("halfFloat", Layout::HalfSingle, "r16f", 2),
    ] {
        let (dir, g) = float_scene(setting, setting, json!({"occlusionTexture": {"index": 0}}));
        let (previews, _) = stage_scene(&dir, &g);
        let entry = &previews[0];
        assert_eq!(entry.kind, AtlasKind::Data);
        assert_eq!(entry.layouts, [Some(layout), None, None]);
        assert_eq!(
            entry.blocks[0].len(),
            preview_layout_bytes(256, 256, layout)
        );
        assert_eq!(
            entry.pixels.len(),
            preview_pixel_bytes(256, 256, AtlasKind::Data)
        );
        let native = dir.join("cache").join("native");
        let path = native.join(level_path(&entry.sha256, AtlasKind::Data, 0, file));
        assert!(path.exists(), "{setting}: {file}");
        // 16 texels of `bytes` each in a square.
        assert_eq!(layout.block_bytes(), 16 * bytes);
    }
}
