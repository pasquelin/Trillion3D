//! The chains a texture's setting settles without the gate (`setting.rs`): one channel in BC4
//! blocks (`alpha`), one channel kept to the bit in eight-bit texels (`grayscale`,
//! `displacementmap`), or no block at all (`vectorDisplacementmap`). The setting is the asking:
//! nothing is measured, the chain is what was asked.
use super::write::{write_levels, LEVEL_WRITE_FAILED};
use super::{Baked, Source};
use crate::texture::blocks::{encode_channel, encode_one_channel, BlockFormat, Layout, FAMILIES};
use crate::texture::collect::AtlasTexture;
use crate::texture::reduce::{self, AtlasKind};
use crate::texture::*;

/// The key the chains of a setting live under: the source's fingerprint, the atlas and the codec.
fn key(sha256: &str, kind: AtlasKind, codec: &str) -> String {
    crate::hash(format!("{sha256}-{}-{codec}", kind.name()).as_bytes())
}

/// The chain of `readers` in the atlas of `kind` as BC4 blocks of its first channel, the family
/// `BlockFormat::STORED` holds: its tail in the sidecar, its levels above it as files. A job that
/// cooks no family keeps the chain lossless.
pub(super) fn cook_one_channel(
    source: &Source<'_>,
    kind: AtlasKind,
    readers: &[&AtlasTexture],
) -> std::result::Result<Baked, &'static str> {
    let pixels = reduce::tail(&source.chain(kind), source.first_level);
    cook_blocks(
        source,
        kind,
        readers,
        Layout::OneChannel,
        pixels,
        ONE_CHANNEL_CELL,
        encode_one_channel,
    )
}

/// The chain of `readers` in the atlas of `kind` as the eight-bit texels of one channel, the family
/// `BlockFormat::STORED` holds: the red channel for `Layout::Gray`, the alpha channel for
/// `Layout::Displacement`. The tail's RGBA8 texels hold what the engine reads of the chain — the
/// channel in RGB and opaque for a grey, in all four for a displacement — so that a lane that
/// decodes no block reads the same. A job that cooks no family keeps the chain lossless.
pub(super) fn cook_channel(
    source: &Source<'_>,
    kind: AtlasKind,
    readers: &[&AtlasTexture],
    layout: Layout,
) -> std::result::Result<Baked, &'static str> {
    let channel = if layout == Layout::Displacement { 3 } else { 0 };
    let mut pixels = reduce::tail(&source.chain(kind), source.first_level);
    for texel in pixels.chunks_exact_mut(4) {
        let value = texel[channel];
        let alpha = if layout == Layout::Displacement {
            value
        } else {
            255
        };
        texel.copy_from_slice(&[value, value, value, alpha]);
    }
    cook_blocks(
        source,
        kind,
        readers,
        layout,
        pixels,
        BLOCK_CELL,
        move |level, w, h| encode_channel(level, w, h, channel),
    )
}

/// The chain of `readers` in the atlas of `kind` in `layout`'s blocks, `encode` giving a level's
/// blocks from its RGBA8 texels and `cell` cutting its files; `pixels` the tail's RGBA8 texels.
fn cook_blocks(
    source: &Source<'_>,
    kind: AtlasKind,
    readers: &[&AtlasTexture],
    layout: Layout,
    pixels: Vec<u8>,
    cell: Cell,
    encode: impl Fn(&[u8], u32, u32) -> Vec<u8> + Sync,
) -> std::result::Result<Baked, &'static str> {
    let file = BlockFormat::STORED.file_name(layout);
    let key = key(source.sha256, kind, file);
    if source.o.texture_formats.is_empty() {
        return lossless_pixels(source, kind, readers, &key, &pixels);
    }
    let (levels, size, first) = (source.chain(kind), source.size, source.first_level);
    let blocks_of = |level: usize| {
        let (w, h) = preview_level_size(size.0, size.1, level as u32);
        encode(&levels[level], w, h)
    };
    let tail: Vec<u8> = (first as usize..levels.len()).flat_map(blocks_of).collect();
    let written = {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureWrite);
        write_levels(source.o, &key, kind, size, file, first, |level, (w, h)| {
            Ok(tile_records(&blocks_of(level), w, h, cell))
        })
    };
    let mut baked = Baked::default();
    let (layouts, blocks, baked_levels) = match written {
        Ok(count) => {
            let mut layouts = [None; FAMILIES];
            layouts[BlockFormat::STORED.index()] = Some(layout);
            let mut blocks: [Vec<u8>; FAMILIES] = Default::default();
            blocks[BlockFormat::STORED.index()] = tail;
            (layouts, blocks, count)
        }
        Err(_) => {
            baked.add_note(LEVEL_WRITE_FAILED);
            ([None; FAMILIES], Default::default(), 0)
        }
    };
    for reader in readers {
        baked.previews.push(source.entry(
            reader.texture,
            (&key, kind),
            baked_levels,
            (&pixels, layouts, &blocks),
        )?);
    }
    Ok(baked)
}

/// The chain of `readers` in the atlas of `kind` with no block: its tail in RGBA8 and no level
/// file, the engine reads the source image.
pub(super) fn cook_lossless(
    source: &Source<'_>,
    kind: AtlasKind,
    readers: &[&AtlasTexture],
) -> std::result::Result<Baked, &'static str> {
    let pixels = reduce::tail(&source.chain(kind), source.first_level);
    lossless_pixels(
        source,
        kind,
        readers,
        &key(source.sha256, kind, "lossless"),
        &pixels,
    )
}

/// The same with the tail's RGBA8 texels given.
fn lossless_pixels(
    source: &Source<'_>,
    kind: AtlasKind,
    readers: &[&AtlasTexture],
    key: &str,
    pixels: &[u8],
) -> std::result::Result<Baked, &'static str> {
    let blocks: [Vec<u8>; FAMILIES] = Default::default();
    let previews = readers
        .iter()
        .map(|reader| {
            source.entry(
                reader.texture,
                (key, kind),
                0,
                (pixels, [None; FAMILIES], &blocks),
            )
        })
        .collect::<std::result::Result<_, _>>()?;
    Ok(Baked {
        previews,
        ..Baked::default()
    })
}
