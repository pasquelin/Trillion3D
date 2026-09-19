//! What a KTX 2.0 declares around its texels, applied or counted — never ignored in silence.
//!
//! Three declarations arrive here. The format descriptor's premultiplied-alpha flag: the
//! output contract asks for straight alpha, so each component is divided by its texel's
//! alpha. The `KTXorientation` key: `rd` is the contract orientation, `ru` writes its lines
//! from bottom to top and is put right-side up by a vertical flip. The `KTXswizzle` key: only
//! the `rgba` identity is read as-is.
//!
//! Anything outside that — an orientation that starts to the left, a channel permutation, a
//! third dimension — is counted as a named reason, and the texels stay where the file put
//! them. Applying them wrongly would be worse than saying we cannot do it.
use super::keys;
use super::{ORIENTATION_UNSUPPORTED, SWIZZLE_UNSUPPORTED};
use crate::plugins::image::DecodedImage;

/// Orientation the image contract expects: to the right, downward, top row first.
const NATURAL: &str = "rd";
/// Orientation that differs only by the vertical direction: the flip brings it back to the contract.
const FLIPPED: &str = "ru";
/// Identity permutation: the channels are already the contract's.
const IDENTITY: &str = "rgba";

/// Applies what applies, counts the rest. The image is modified in place; the reasons come
/// out in the order the driver met them.
pub(super) fn apply(
    image: &mut DecodedImage,
    premultiplied: bool,
    bytes: &[u8],
) -> Vec<&'static str> {
    let DecodedImage::Rgba8(pixels) = image else {
        return Vec::new();
    };
    if premultiplied {
        straight(pixels);
    }
    let declared = keys::read(bytes);
    let mut notes = Vec::new();
    match declared.get(keys::ORIENTATION).copied() {
        None | Some(NATURAL) => {}
        Some(FLIPPED) => flip(pixels),
        Some(_) => notes.push(ORIENTATION_UNSUPPORTED),
    }
    if declared
        .get(keys::SWIZZLE)
        .is_some_and(|swizzle| *swizzle != IDENTITY)
    {
        notes.push(SWIZZLE_UNSUPPORTED);
    }
    notes
}

/// Components brought back to straight alpha, texel by texel and in place. An opaque alpha
/// leaves the texel exactly as-is, and a null alpha divides nothing: under a null alpha there
/// is no straight colour to recover. Division rounds to nearest and saturates at a full byte,
/// because an encoder may have written a component above its alpha.
fn straight(pixels: &mut image::RgbaImage) {
    let raw: &mut [u8] = pixels;
    for texel in raw.as_chunks_mut::<4>().0 {
        let alpha = u32::from(texel[3]);
        if alpha == 0 || alpha == u32::from(u8::MAX) {
            continue;
        }
        for component in texel.iter_mut().take(3) {
            let value = (u32::from(*component) * u32::from(u8::MAX) + alpha / 2) / alpha;
            *component = value.min(u32::from(u8::MAX)) as u8;
        }
    }
}

/// Lines put back in contract order: the last one first.
fn flip(pixels: &mut image::RgbaImage) {
    let stride = pixels.width() as usize * 4;
    let height = pixels.height() as usize;
    let raw: &mut [u8] = pixels;
    for row in 0..height / 2 {
        let (top, bottom) = raw.split_at_mut((height - 1 - row) * stride);
        top[row * stride..row * stride + stride].swap_with_slice(&mut bottom[..stride]);
    }
}
