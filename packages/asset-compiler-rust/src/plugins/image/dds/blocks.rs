//! Reconstruction of the stored levels to RGBA8, level 0 first.
//!
//! The shared `image::blocks` base does the work (`Layout::rgba8`): `dds` and `ktx2` name their
//! codecs each in their own way, but once the layout is chosen, walking its pixels in contract
//! order is the same work, written once.
use super::header::Surface;
use super::{DATA_TRUNCATED, TOO_LARGE};
use crate::plugins::image::blocks::image;
use crate::plugins::image::{pixel_surface_bytes, DecodedImage, RGBA8_PIXEL_BYTES};
use trillion3d_math::scalar::mip_size;

/// Level 0 as the image, and the levels the file stores below it as RGBA8 bytes.
pub(super) fn decode(
    surface: &Surface,
    bytes: &[u8],
    max_alloc: u64,
) -> std::result::Result<(DecodedImage, Vec<Vec<u8>>), &'static str> {
    let sides = |level| {
        (
            mip_size(surface.width, level),
            mip_size(surface.height, level),
        )
    };
    let held = (0..surface.levels)
        .map(|level| {
            let (width, height) = sides(level);
            pixel_surface_bytes(width, height, RGBA8_PIXEL_BYTES)
        })
        .fold(0u64, u64::saturating_add);
    if held > max_alloc {
        return Err(TOO_LARGE);
    }
    let layout = surface.codec.layout();
    let mut at = surface.data;
    let mut levels = (0..surface.levels).map(|level| {
        let (width, height) = sides(level);
        let rgba = layout.rgba8(
            &bytes[at..],
            width as usize,
            height as usize,
            DATA_TRUNCATED,
        );
        at += layout.level_bytes(width, height) as usize;
        rgba
    });
    let first = levels.next().ok_or(DATA_TRUNCATED)??;
    let image = image(surface.width, surface.height, first, DATA_TRUNCATED)?;
    Ok((image, levels.collect::<Result<_, _>>()?))
}
