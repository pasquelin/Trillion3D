use super::*;

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
        let block = (w.div_ceil(4) as usize)
            .saturating_mul(h.div_ceil(4) as usize)
            .saturating_mul(16);
        chain = chain.saturating_add(bytes);
        blocks = blocks.saturating_add(block);
        if level >= first {
            tail = tail
                .saturating_add(bytes)
                .saturating_add(block.saturating_mul(families));
        }
    }
    // An RGBA32F intermediate (16 bytes/texel) plus the returned RGBA8.
    // Float-only drivers are still rejected by bake, without changing their pixels.
    let decode = pixels.saturating_mul(16).saturating_add(rgba);
    // Alpha classification owns one byte/texel of contour distances.
    let alpha = rgba.saturating_add(pixels);
    // One atlas chain at a time: source + RGBA mip chain, PNG output growth
    // (two full RGBA capacities), one block chain and its RGBA read-back.
    // The block decoder additionally owns a four-row u32 strip. Coverage's
    // scale table is 256*256 bytes. Two temporary tails coexist with clones.
    let bake = rgba
        .saturating_add(chain)
        .saturating_add(rgba.saturating_mul(2))
        .saturating_add(if families > 0 {
            blocks.saturating_add(rgba)
        } else {
            0
        })
        .saturating_add(
            (width as usize)
                .saturating_mul(height.min(4) as usize)
                .saturating_mul(4),
        )
        .saturating_add(256 * 256)
        .saturating_add(tail.saturating_mul(2));
    Cost {
        working: source_and_payload.saturating_add(decode.max(alpha).max(bake)),
        retained: tail.saturating_mul(readers),
    }
}
