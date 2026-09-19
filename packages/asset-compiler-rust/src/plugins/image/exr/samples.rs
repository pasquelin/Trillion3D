//! Samples of the single OpenEXR layer, and the straight alpha the contract asks for.
//!
//! This module judges nothing: the subset has already been checked by `exr.rs`, which only
//! calls here once the size is known and the allocation ceiling applied. It reads the four
//! channels, checks that the returned surface is the one that was announced, then brings the
//! samples back to straight alpha.
use super::{DecodedImage, ImageDecoded, Transfer, UNREADABLE};
use ::exr::image::RgbaChannels;
use ::exr::math::Vec2;
use ::exr::prelude::traits::{read, ReadChannels, ReadLayers};

/// Pixels of the single layer, at its largest resolution level, stored top row first.
/// A file with no `A` channel returns opaque alpha, as the specification requires. The read is
/// sequential: the compiler bounds its own threads, a texture decoder does not take others
/// behind its back.
pub(super) fn read_all(
    bytes: &[u8],
    width: u32,
    height: u32,
) -> std::result::Result<ImageDecoded, &'static str> {
    let stride = width as usize;
    let image = read()
        .no_deep_data()
        .largest_resolution_level()
        .rgba_channels(
            move |size: Vec2<usize>, _: &RgbaChannels| vec![0.0_f32; size.area() * 4],
            move |data: &mut Vec<f32>, at: Vec2<usize>, (r, g, b, a): (f32, f32, f32, f32)| {
                let base = (at.y() * stride + at.x()) * 4;
                if let Some(pixel) = data.get_mut(base..base + 4) {
                    pixel.copy_from_slice(&[r, g, b, a]);
                }
            },
        )
        .first_valid_layer()
        .all_attributes()
        .non_parallel()
        .from_buffered(std::io::Cursor::new(bytes))
        .map_err(|_| UNREADABLE)?;
    let mut data = image.layer_data.channel_data.pixels;
    if data.len() != stride * height as usize * 4 {
        return Err(UNREADABLE);
    }
    straight(&mut data);
    Ok(ImageDecoded::new(
        DecodedImage::RgbaF32 {
            width,
            height,
            data,
        },
        Transfer::Linear,
    ))
}

/// Associated samples brought back to straight alpha, pixel by pixel and in place. An alpha of
/// one leaves the pixel exactly as-is — the division is a no-op —, and a null or negative alpha
/// divides nothing at all: that is the only value under which the straight colour does not exist.
fn straight(data: &mut [f32]) {
    for pixel in data.as_chunks_mut::<4>().0 {
        let alpha = pixel[3];
        if alpha <= 0.0 || alpha == 1.0 {
            continue;
        }
        for component in pixel.iter_mut().take(3) {
            *component /= alpha;
        }
    }
}
