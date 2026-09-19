//! Geometry of a texture's progressive pyramid, shared by the computation, sidecar
//! writing and the TypeScript reader (`packages/sdk-core/texturePreviewLevels.ts`).
//!
//! A level `k` is exactly mip level `k` of the source: integer division of both
//! sides by `2^k`, never less than one texel. The engine can therefore write the
//! received level `k` into mip level `k` of its atlas layer without recomputing
//! anything, and sample it as-is.
use super::*;

/// Dimensions of level `level` of a `width`×`height` image.
pub fn preview_level_size(width: u32, height: u32, level: u32) -> (u32, u32) {
    let shift = level.min(31);
    ((width >> shift).max(1), (height >> shift).max(1))
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

/// RGBA8 bytes of every carried level, end to end from finest to coarsest.
pub fn preview_pixel_bytes(width: u32, height: u32) -> usize {
    let mut bytes = 0usize;
    for level in preview_first_level(width, height)..=preview_last_level(width, height) {
        let (w, h) = preview_level_size(width, height, level);
        bytes += (w as usize) * (h as usize) * 4;
    }
    bytes
}
