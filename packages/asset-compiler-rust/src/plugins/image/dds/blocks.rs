//! La reconstruction du niveau 0 vers RGBA8, et rien d'autre.
//!
//! Les blocs compressés sont développés par le socle commun `image::blocks` : `dds` et `ktx2`
//! nomment leurs codecs chacun à sa façon, mais une fois le décodeur choisi, promener ses pixels
//! dans l'ordre du contrat est le même travail, écrit une seule fois.
//!
//! Pour une surface non compressée, les octets sont déjà là : on les remet dans le même ordre.
use super::codec::{Layout, Order};
use super::header::Surface;
use super::{DecodedImage, DATA_TRUNCATED, TOO_LARGE};
use crate::plugins::image::blocks as shared;
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

/// Une surface non compressée, quatre octets par pixel. En `Rgba` les octets sont déjà ceux du
/// contrat ; sinon rouge et bleu s'échangent en place, et `Bgrx`, sans canal alpha, est opaque.
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
