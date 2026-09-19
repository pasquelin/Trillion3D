//! Reconstruction of level 0 to RGBA8, and nothing else.
//!
//! Compressed blocks are expanded by the shared `image::blocks` base: `dds` and `ktx2` name their
//! codecs each in their own way, but once the decoder is chosen, walking its pixels in contract
//! order is the same work, written once.
//!
//! For an uncompressed surface, the bytes are already there: they are put back in the same order.
use super::codec::{Layout, Order};
use super::header::Surface;
use super::{DATA_TRUNCATED, TOO_LARGE};
use crate::plugins::image::blocks as shared;
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
    let rgba = match surface.codec.layout() {
        Layout::Blocks { bytes, decode } => shared::to_rgba8(
            decode,
            usize::from(bytes),
            level,
            width,
            height,
            DATA_TRUNCATED,
        )?,
        Layout::Pixels(order) => from_pixels(order, level, width * height)?,
    };
    shared::image(surface.width, surface.height, rgba, DATA_TRUNCATED)
}

/// An uncompressed surface, four bytes per pixel. In `Rgba` the bytes are already the contract's;
/// otherwise red and blue swap in place, and `Bgrx`, with no alpha channel, is opaque.
fn from_pixels(
    order: Order,
    level: &[u8],
    pixels: usize,
) -> std::result::Result<Vec<u8>, &'static str> {
    let mut rgba = level
        .get(..pixels.saturating_mul(4))
        .ok_or(DATA_TRUNCATED)?
        .to_vec();
    let opaque = match order {
        Order::Rgba => return Ok(rgba),
        Order::Bgra => false,
        Order::Bgrx => true,
    };
    for pixel in rgba.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
        if opaque {
            pixel[3] = 255;
        }
    }
    Ok(rgba)
}
