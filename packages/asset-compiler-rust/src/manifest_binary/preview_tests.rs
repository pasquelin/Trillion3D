use super::*;
use crate::texture_preview::{AtlasKind, PreviewSource};

fn templates() -> Templates<'static> {
    Templates {
        binary: "clusters.bin",
        page: "../../objects/{sha}.bin",
        geometry: "../../objects/{sha}.bin",
        bundle: "../../objects/{sha}.bin",
    }
}
fn preview(texture: u32, width: u32, height: u32, fill: u8) -> TexturePreview {
    TexturePreview {
        texture,
        image: texture,
        width,
        height,
        source: PreviewSource::Uri,
        sha256: std::iter::repeat_n('a', 64).collect(),
        kind: AtlasKind::Color,
        first_level: preview_first_level(width, height),
        baked_levels: preview_first_level(width, height),
        pixels: vec![fill; preview_pixel_bytes(width, height)],
    }
}

// Behavior 9 (a): sidecar does round-trip write/read of preview section —
// each field written by `split` reads back identical bit-for-bit, without decoder.
#[test]
fn texture_previews_round_trip_through_the_binary_columns() {
    let previews = vec![preview(0, 32, 16, 11), preview(3, 8, 8, 222)];
    let (_, bytes) = split(&json!({"primitives": []}), &templates(), &previews).expect("split");
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let column = |index: usize| {
        let at = (HEADER_WORDS + index * 2) * 4;
        (word(at) as usize, word(at + 4) as usize)
    };
    let (words_off, words_len) = column(TEXTURE_PREVIEW_U32);
    let (sha_off, _) = column(TEXTURE_PREVIEW_SHA);
    let (pixels_off, _) = column(TEXTURE_PREVIEW_PIXELS);
    assert_eq!(words_len, previews.len() * PREVIEW_WORDS * 4);
    let mut offset = 0usize;
    for (entry, source) in previews.iter().enumerate() {
        let base = words_off + entry * PREVIEW_WORDS * 4;
        assert_eq!(word(base), source.texture);
        assert_eq!(word(base + 4), source.image);
        assert_eq!(word(base + 8), source.width);
        assert_eq!(word(base + 12), source.height);
        assert_eq!(word(base + 16), source.source.kind());
        assert_eq!(word(base + 20), source.source.buffer_view());
        assert_eq!(word(base + 24), source.first_level);
        assert_eq!(
            word(base + 28),
            preview_level_count(source.width, source.height)
        );
        assert_eq!(word(base + 40), source.kind.word());
        assert_eq!(word(base + 44), source.baked_levels);
        let sha = std::str::from_utf8(&bytes[sha_off + entry * 64..sha_off + entry * 64 + 64])
            .expect("ascii");
        assert_eq!(sha, source.sha256);
        // Entry byte range is what entry declares, following previous one.
        let (start, length) = (word(base + 32) as usize, word(base + 36) as usize);
        assert_eq!(start, offset);
        assert_eq!(length, source.pixels.len());
        assert_eq!(
            &bytes[pixels_off + start..pixels_off + start + length],
            source.pixels.as_slice()
        );
        offset += length;
    }
}

// Behavior 9 (b): file from earlier version (here 3, fixed-length previews)
// refused outright, never read as if it had new section.
#[test]
fn a_sidecar_of_an_older_version_is_refused() {
    let (_, bytes) = split(&json!({"primitives": []}), &templates(), &[]).expect("split");
    let mut old = bytes.clone();
    old[4..8].copy_from_slice(&3u32.to_le_bytes());
    assert!(digests(&old).is_err());
}

// Behavior 9 (c): pair (texture, atlas) that does not advance refused — same texture
// can have one entry per atlas, color before data, never same atlas twice.
#[test]
fn encode_previews_rejects_a_decreasing_texture_index() {
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let previews = vec![preview(3, 4, 4, 1), preview(2, 4, 4, 1)];
    let error =
        crate::manifest_binary::preview::encode_previews(&previews, &mut columns).unwrap_err();
    assert_eq!(error.code, "INVALID_MANIFEST");
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let mut data = preview(2, 4, 4, 1);
    data.kind = AtlasKind::Data;
    let both = vec![preview(2, 4, 4, 1), data];
    crate::manifest_binary::preview::encode_previews(&both, &mut columns)
        .expect("one entry per atlas");
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let twice = vec![preview(2, 4, 4, 1), preview(2, 4, 4, 1)];
    assert!(crate::manifest_binary::preview::encode_previews(&twice, &mut columns).is_err());
}

// Behavior 9 (g): more baked levels than tail leaves above it refused.
#[test]
fn encode_previews_rejects_more_baked_levels_than_the_tail_leaves() {
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let mut malformed = preview(0, 128, 128, 1);
    malformed.baked_levels += 1;
    assert!(crate::manifest_binary::preview::encode_previews(&[malformed], &mut columns).is_err());
}

// Behavior 9 (d): zero source dimension refused.
#[test]
fn encode_previews_rejects_a_null_dimension() {
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let previews = vec![preview(0, 0, 4, 1)];
    assert!(crate::manifest_binary::preview::encode_previews(&previews, &mut columns).is_err());
}

// Behavior 9 (e): wrong pixel byte count — false level shift viewed
// from level constants — refused.
#[test]
fn encode_previews_rejects_the_wrong_pixel_byte_length() {
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let mut malformed = preview(0, 4, 4, 1);
    malformed.pixels.pop();
    assert!(crate::manifest_binary::preview::encode_previews(&[malformed], &mut columns).is_err());
}

// Behavior 9 (f): entry whose announced first level contradicts dimensions
// refused, even when pixel bytes have right length for errant first level
// not at fault: declared geometry, not pixel size, lies here.
#[test]
fn encode_previews_rejects_a_first_level_that_disagrees_with_the_dimensions() {
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let mut malformed = preview(0, 128, 128, 1);
    malformed.first_level += 1;
    let error =
        crate::manifest_binary::preview::encode_previews(&[malformed], &mut columns).unwrap_err();
    assert_eq!(error.code, "INVALID_MANIFEST");
}
