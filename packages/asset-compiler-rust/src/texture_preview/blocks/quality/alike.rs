//! Blocks alike their neighbours: the inside of an image, its first alike blocks, their encoding.
use super::super::super::coverage::Cut;
use super::super::decode::decode_block;
use super::super::{blocks_of, encode_block, fit, BlockFormat, Effort, Layout, BLOCK_BYTES};
use super::{flipped, Channels, Tally};
use rayon::prelude::*;

/// The part of block (`bx`, `by`) inside a `width` × `height` level: its columns and its rows,
/// four but at the right and bottom edges.
fn inside_of((width, height): (u32, u32), bx: usize, by: usize) -> (usize, usize) {
    (
        (width as usize - bx * 4).min(4),
        (height as usize - by * 4).min(4),
    )
}

/// The byte ranges of a block's sixteen RGBA8 texels, row-major, its `inside` part covers: one a
/// row.
pub(super) fn inside_rows(
    (across, down): (usize, usize),
) -> impl Iterator<Item = std::ops::Range<usize>> {
    (0..down).map(move |y| y * 16..y * 16 + across * 4)
}

/// A block's texels as RGBA8 bytes, row-major: the floats `fit::block_texels` holds are bytes.
pub(super) fn texel_bytes(texels: &fit::Texels) -> [u8; 64] {
    std::array::from_fn(|i| texels[i / 4][i % 4] as u8)
}

/// The tally of a block's read-back `back` against its `source` texels, on the part `inside` the
/// level only: what the block adds to the level's measure.
pub(super) fn inside_tally(
    source: &[u8; 64],
    back: &[u8; 64],
    inside: (usize, usize),
    channels: Channels,
    cutoffs: &[Cut],
) -> Tally {
    inside_rows(inside)
        .map(|row| Tally::of(&source[row.clone()], &back[row], channels, cutoffs))
        .fold(Tally::default(), Tally::merge)
}

/// For each block of a level, the first block with the same sixteen texels — the edge repeated
/// (`fit::block_texels`) — and the same part inside the level: the one searched, whose bytes and
/// read-back the others take, since a block is encoded from its texels alone.
fn first_alike(pixels: &[u8], size @ (width, height): (u32, u32)) -> Vec<u32> {
    use std::collections::HashMap;
    use std::hash::{DefaultHasher, Hash, Hasher};
    let (across, _) = blocks_of(width, height);
    let across = across as usize;
    let count = across * blocks_of(width, height).1 as usize;
    let key = |block: usize| {
        let (bx, by) = (block % across, block / across);
        let texels = fit::block_texels(pixels, width, height, bx as u32, by as u32);
        (texel_bytes(&texels), inside_of(size, bx, by))
    };
    let mut first: HashMap<u64, u32> = HashMap::new();
    (0..count)
        .map(|block| {
            let mine = key(block);
            let mut hasher = DefaultHasher::new();
            mine.hash(&mut hasher);
            let seen = *first.entry(hasher.finish()).or_insert(block as u32);
            // Two blocks whose digests meet but whose texels differ are each searched.
            if seen as usize == block || key(seen as usize) != mine {
                block as u32
            } else {
                seen
            }
        })
        .collect()
}

/// One level encoded block by block by `search` — the block's rank, its texels and its part inside
/// the level, to its bytes and its read-back —, each set of alike blocks searched once
/// (`first_alike`): its blocks, and their read-back. Block rows are searched side by side on the
/// caller's pool, each beside the four rows of read-back it writes; the blocks alike an earlier
/// one then copy its bytes and its read-back. No buffer a block: the level's own two.
pub(super) fn encode_alike(
    pixels: &[u8],
    size @ (width, height): (u32, u32),
    search: impl Fn(usize, &fit::Texels, (usize, usize)) -> ([u8; BLOCK_BYTES], [u8; 64]) + Sync,
) -> (Vec<u8>, Vec<u8>) {
    let alike = first_alike(pixels, size);
    let (across, down) = blocks_of(width, height);
    let across = across as usize;
    let row_bytes = across * BLOCK_BYTES;
    let texel_row = width as usize * 4;
    let mut encoded = vec![0u8; row_bytes * down as usize];
    let mut decoded = vec![0u8; pixels.len()];
    encoded
        .par_chunks_mut(row_bytes)
        .zip(decoded.par_chunks_mut(texel_row * 4))
        .enumerate()
        .with_min_len(8)
        .for_each(|(by, (blocks, rows))| {
            for (bx, block) in blocks
                .as_chunks_mut::<BLOCK_BYTES>()
                .0
                .iter_mut()
                .enumerate()
            {
                let rank = by * across + bx;
                if alike[rank] as usize != rank {
                    continue;
                }
                let texels = fit::block_texels(pixels, width, height, bx as u32, by as u32);
                let (kept, back) = search(rank, &texels, inside_of(size, bx, by));
                *block = kept;
                put_block(rows, width, bx, &back);
            }
        });
    for (rank, &seen) in alike.iter().enumerate() {
        let seen = seen as usize;
        if seen == rank {
            continue;
        }
        encoded.copy_within(
            seen * BLOCK_BYTES..(seen + 1) * BLOCK_BYTES,
            rank * BLOCK_BYTES,
        );
        let (bx, by) = (rank % across, rank / across);
        let (sx, sy) = (seen % across, seen / across);
        let (columns, rows) = inside_of(size, bx, by);
        for y in 0..rows {
            let from = (sy * 4 + y) * texel_row + sx * 16;
            let to = (by * 4 + y) * texel_row + bx * 16;
            decoded.copy_within(from..from + columns * 4, to);
        }
    }
    (encoded, decoded)
}

/// Block `bx`'s read-back `back`, sixteen texels row-major, written over `rows`, the four rows or
/// fewer of a `width`-texel RGBA8 level its block row covers: the texels inside the level only.
fn put_block(rows: &mut [u8], width: u32, bx: usize, back: &[u8; 64]) {
    let row_bytes = width as usize * 4;
    for (y, row) in rows.chunks_mut(row_bytes).enumerate() {
        for x in (bx * 4..bx * 4 + 4).filter(|&x| x < width as usize) {
            let texel = y * 4 + x - bx * 4;
            row[x * 4..x * 4 + 4].copy_from_slice(&back[texel * 4..texel * 4 + 4]);
        }
    }
}

/// Rounds a block that flips a texel is encoded again at most (`sided`).
const SIDE_ROUNDS: usize = 3;

/// One block of `texels` in `codec` at `effort`, and its read-back. What a cut reads of a texel is
/// its side, and an encoder minimises squared error: an alpha one step under a cutoff can come
/// back one step over it — a 4-bit BC7 weight between 0 and 255 lands on 119 or 135, never 127 —,
/// a hole that closes. A block whose read-back flips a texel `inside` the level across one of
/// `cutoffs` is encoded again from its texels, each flipped alpha pushed away from the cut by the
/// error it came back with, round after round while a texel still flips; a round's block is kept
/// only when it flips fewer of its sixteen texels, and only a kept round's read-back steers the
/// next push. Measured against the source, as every block is.
pub(super) fn sided(
    texels: &fit::Texels,
    (format, layout): (BlockFormat, Layout),
    effort: Effort,
    cutoffs: &[Cut],
    inside: (usize, usize),
) -> ([u8; BLOCK_BYTES], [u8; 64]) {
    let mut block = encode_block(texels, format, layout, effort);
    let mut back = decode_block(&block, format, layout);
    if cutoffs.is_empty() {
        return (block, back);
    }
    let source = texel_bytes(texels);
    let flips_at = |back: &[u8; 64], t: usize| flipped(source[t * 4 + 3], back[t * 4 + 3], cutoffs);
    let (columns, rows) = inside;
    if !(0..16).any(|t| t % 4 < columns && t / 4 < rows && flips_at(&back, t)) {
        return (block, back);
    }
    let count = |back: &[u8; 64]| (0..16).filter(|&t| flips_at(back, t)).count();
    let mut best = count(&back);
    let mut nudged = *texels;
    for _ in 0..SIDE_ROUNDS {
        for t in (0..16).filter(|&t| flips_at(&back, t)) {
            let error = f32::from(back[t * 4 + 3]) - f32::from(source[t * 4 + 3]);
            nudged[t][3] = (nudged[t][3] - error).clamp(0.0, 255.0);
        }
        let again = encode_block(&nudged, format, layout, effort);
        let again_back = decode_block(&again, format, layout);
        let flips = count(&again_back);
        if flips < best {
            (best, block, back) = (flips, again, again_back);
        }
        if best == 0 {
            break;
        }
    }
    (block, back)
}
