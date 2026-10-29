//! Geometry of a texture's progressive pyramid, shared by the computation, sidecar
//! writing and the TypeScript reader (`packages/sdk-core/src/texture/previewLevels.ts`).
//!
//! A level `k` is exactly mip level `k` of the source: integer division of both
//! sides by `2^k`, never less than one texel (`trillion3d_math::scalar::mip_size`, the one rule
//! of every halving pyramid); its first and last levels are held to the reader's by
//! `golden/preview_levels.json`. The engine can therefore write the
//! received level `k` into mip level `k` of its atlas layer without recomputing
//! anything, and sample it as-is.
use super::*;
use trillion3d_math::scalar::mip_size;

/// Dimensions of level `level` of a `width`×`height` image.
pub fn preview_level_size(width: u32, height: u32, level: u32) -> (u32, u32) {
    (mip_size(width, level), mip_size(height, level))
}

/// Finest level the sidecar carries: the first whose neither side exceeds
/// `PREVIEW_BASE`. Above it there is only full resolution, which the engine
/// already loads as the source image.
pub fn preview_first_level(width: u32, height: u32) -> u32 {
    let mut level = 0;
    while level < 31 {
        let (w, h) = preview_level_size(width, height, level);
        if w <= PREVIEW_BASE && h <= PREVIEW_BASE {
            break;
        }
        level += 1;
    }
    level
}

/// Last carried level: the one where both sides are one texel.
pub fn preview_last_level(width: u32, height: u32) -> u32 {
    31 - width.max(height).max(1).leading_zeros()
}

/// Levels carried by an entry, from the finest through 1×1 inclusive. At most `PREVIEW_MAX_LEVELS`.
pub fn preview_level_count(width: u32, height: u32) -> u32 {
    preview_last_level(width, height) - preview_first_level(width, height) + 1
}

/// Dimensions of every level of the chain, level 0 first through 1×1.
pub fn preview_level_sizes(width: u32, height: u32) -> impl Iterator<Item = (u32, u32)> {
    (0..=preview_last_level(width, height))
        .map(move |level| preview_level_size(width, height, level))
}

/// Dimensions of every carried level, from finest to coarsest.
fn carried_sizes(width: u32, height: u32) -> impl Iterator<Item = (u32, u32)> {
    preview_level_sizes(width, height).skip(preview_first_level(width, height) as usize)
}

/// Bytes of every carried level of a chain of the atlas `kind`, end to end from finest to
/// coarsest: RGBA8 in the colour and data atlases, half-float RGBA in the other.
pub fn preview_pixel_bytes(width: u32, height: u32, kind: AtlasKind) -> usize {
    carried_sizes(width, height)
        .map(|(w, h)| (w as usize) * (h as usize) * kind.texel_bytes())
        .sum()
}

/// Bytes of every carried level once block-compressed in `layout`, whole 4 × 4 blocks, end to
/// end from finest to coarsest.
pub fn preview_layout_bytes(width: u32, height: u32, layout: super::Layout) -> usize {
    carried_sizes(width, height)
        .map(|(w, h)| super::blocks::layout_block_bytes(w, h, layout))
        .sum()
}

/// The same for the layouts of sixteen-byte blocks, which is every one the gate writes — the
/// same in every family.
pub fn preview_block_bytes(width: u32, height: u32) -> usize {
    preview_layout_bytes(width, height, super::Layout::Rgba)
}

/// A streamed tile's side in texels: the engine's (`texture/tiles.ts`), printed there.
pub const TILE_SIZE: u32 = 128;
/// A streamed tile's gutter on each side, in texels.
pub const TILE_BORDER: u32 = 4;

/// What a level file's records are cut in: units `side` texels wide, `bytes` each — the 4 × 4
/// blocks of the block families, or the single half-float texels of the half-float atlas.
#[derive(Clone, Copy)]
pub struct Cell {
    pub side: u32,
    pub bytes: usize,
}
/// The cell of the block families' level files.
pub const BLOCK_CELL: Cell = Cell {
    side: crate::plugins::image::blocks::BLOCK_SIDE,
    bytes: super::blocks::BLOCK_BYTES,
};
/// The cell of the BC4 level files: eight-byte blocks.
pub const ONE_CHANNEL_CELL: Cell = Cell {
    side: crate::plugins::image::blocks::BLOCK_SIDE,
    bytes: super::Layout::OneChannel.block_bytes(),
};
/// The cell of the level files of a layout's blocks: 4 × 4 squares of `layout.block_bytes()`.
pub const fn layout_cell(layout: super::Layout) -> Cell {
    Cell {
        side: crate::plugins::image::blocks::BLOCK_SIDE,
        bytes: layout.block_bytes(),
    }
}
/// The cell of the half-float atlas's level files: one texel.
pub const HALF_CELL: Cell = Cell {
    side: 1,
    bytes: super::hdr::HALF_TEXEL_BYTES,
};

/// Cell columns — or rows — `[from, to)` of each tile's record along a side
/// `texels` long: the tile and its gutter, clipped at the level's edge.
fn record_spans(texels: u32, side: u32) -> impl Iterator<Item = (usize, usize)> {
    (0..texels.div_ceil(TILE_SIZE)).map(move |t| {
        let from = (t * TILE_SIZE).saturating_sub(TILE_BORDER) / side;
        let to = ((t + 1) * TILE_SIZE + TILE_BORDER)
            .min(texels)
            .div_ceil(side);
        (from as usize, to as usize)
    })
}

/// `parts` end to end as one raw DEFLATE stream (RFC 1951, no header), at the best level: what the
/// browser's `DecompressionStream('deflate-raw')` inflates.
pub fn deflate_raw<'a>(parts: impl IntoIterator<Item = &'a [u8]>) -> Vec<u8> {
    use flate2::{write::DeflateEncoder, Compression};
    use std::io::Write;
    let mut deflate = DeflateEncoder::new(Vec::new(), Compression::best());
    for part in parts {
        deflate.write_all(part).expect("a vector takes every byte");
    }
    deflate.finish().expect("a vector takes every byte")
}

/// A row-major level of `cell`s (`quality::encode_chain` for blocks, `hdr::chain` for half-floats)
/// as its file holds it (version 8 on): its tile records,
/// laid out as the engine reads them (`packages/sdk-browser/src/materials/texture/tileRecords.ts`), each
/// compressed alone by raw DEFLATE — the browser's own `DecompressionStream('deflate-raw')`
/// inflates it, no decoder downloaded —, after a head of one little-endian `u32` per record: the
/// end of its bytes, counted from the end of the head. The head's length follows from the level's
/// size, so one HTTP Range reads it and one more reads a tile.
pub fn tile_records(level: &[u8], width: u32, height: u32, cell: Cell) -> Vec<u8> {
    use rayon::prelude::*;
    let bytes = cell.bytes;
    let row = width.div_ceil(cell.side) as usize * bytes;
    let spans: Vec<((usize, usize), (usize, usize))> = record_spans(height, cell.side)
        .flat_map(|ys| record_spans(width, cell.side).map(move |xs| (ys, xs)))
        .collect();
    let records: Vec<Vec<u8>> = spans
        .par_iter()
        .map(|&((y0, y1), (x0, x1))| {
            deflate_raw((y0..y1).map(|by| &level[by * row + x0 * bytes..by * row + x1 * bytes]))
        })
        .collect();
    let mut out =
        Vec::with_capacity(records.len() * 4 + records.iter().map(Vec::len).sum::<usize>());
    let mut end = 0u32;
    for record in &records {
        end += record.len() as u32;
        out.extend_from_slice(&end.to_le_bytes());
    }
    for record in records {
        out.extend_from_slice(&record);
    }
    out
}
