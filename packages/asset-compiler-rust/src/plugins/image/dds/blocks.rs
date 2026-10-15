//! Reconstruction of level 0 to RGBA8, and nothing else.
//!
//! The shared `image::blocks` base does the work (`Layout::rgba8`): `dds` and `ktx2` name their
//! codecs each in their own way, but once the layout is chosen, walking its pixels in contract
//! order is the same work, written once.
use super::header::Surface;
use super::{DATA_TRUNCATED, TOO_LARGE};
use crate::plugins::image::blocks;
use crate::plugins::image::DecodedImage;
use crate::plugins::image::{surface_budget, RGBA8_PIXEL_BYTES};

pub(super) fn decode(
    surface: &Surface,
    bytes: &[u8],
    max_alloc: u64,
) -> std::result::Result<DecodedImage, &'static str> {
    surface_budget(
        surface.width,
        surface.height,
        RGBA8_PIXEL_BYTES,
        max_alloc,
        TOO_LARGE,
    )?;
    let level = &bytes[surface.data..];
    let (width, height) = (surface.width as usize, surface.height as usize);
    let rgba = surface
        .codec
        .layout()
        .rgba8(level, width, height, DATA_TRUNCATED)?;
    blocks::image(surface.width, surface.height, rgba, DATA_TRUNCATED)
}
