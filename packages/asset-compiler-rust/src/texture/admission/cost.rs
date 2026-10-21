use super::*;
use crate::texture::blocks::level_block_bytes;

/// Account for the pipeline's image-sized buffers, not allocator metadata or
/// process RSS. Saturation makes impossible dimensions fail admission, never wrap.
pub(super) fn estimate(
    width: u32,
    height: u32,
    source_and_payload: usize,
    readers: usize,
    families: usize,
) -> Cost {
    let pixels = (width as usize).saturating_mul(height as usize);
    let rgba = pixels.saturating_mul(4);
    let mut chain = 0usize;
    let mut blocks = 0usize;
    let mut tail = 0usize;
    let first = preview_first_level(width, height) as usize;
    for (level, (w, h)) in preview_level_sizes(width, height).enumerate() {
        let bytes = (w as usize).saturating_mul(h as usize).saturating_mul(4);
        let block = level_block_bytes(w, h);
        // Level 0 is the source's texels, borrowed (`reduce::chain`): only the levels below own theirs.
        if level > 0 {
            chain = chain.saturating_add(bytes);
        }
        blocks = blocks.saturating_add(block);
        if level >= first {
            tail = tail
                .saturating_add(bytes)
                .saturating_add(block.saturating_mul(families));
        }
    }
    // One atlas chain at a time: source + its mips below level 0, then each family cooking it
    // holds its fast block chain and the slow one built on it (`quality::slow_chain`), one level's
    // RGBA read-back, the level's alike-block table — a digest and a rank a block, at most one
    // block's bytes and a half (`quality::first_alike`) — and a level's file — its deflated
    // records, at most its blocks, held twice while assembled. The stored family cooks alone
    // first; the other families then cook side by side (`bake.rs`); no family, no block chain.
    // Coverage's scale table is 256*256 bytes. Two temporary tails coexist with clones.
    let family = blocks.saturating_mul(6).saturating_add(rgba);
    let cooking = match families {
        0 => 0,
        _ => families.saturating_sub(1).max(1),
    };
    let bake = rgba
        .saturating_add(chain)
        .saturating_add(family.saturating_mul(cooking))
        .saturating_add(256 * 256)
        .saturating_add(tail.saturating_mul(2));
    Cost {
        working: source_and_payload.saturating_add(decode_and_alpha(pixels).max(bake)),
        retained: tail.saturating_mul(readers),
    }
}

/// The cutout step's decode, measured and dropped: the bake's decode and alpha buffers alone, no
/// chain and no tail retained.
pub(super) fn decoding(width: u32, height: u32, source_and_payload: usize) -> Cost {
    let pixels = (width as usize).saturating_mul(height as usize);
    Cost {
        working: source_and_payload.saturating_add(decode_and_alpha(pixels)),
        retained: 0,
    }
}

/// The larger of a decode and an alpha classification of `pixels` texels.
fn decode_and_alpha(pixels: usize) -> usize {
    let rgba = pixels.saturating_mul(4);
    // An RGBA32F intermediate (16 bytes/texel) plus the returned RGBA8.
    // Float-only drivers are still rejected by bake, without changing their pixels.
    let decode = pixels.saturating_mul(16).saturating_add(rgba);
    // Alpha classification owns one byte/texel of contour distances.
    let alpha = rgba.saturating_add(pixels);
    decode.max(alpha)
}
