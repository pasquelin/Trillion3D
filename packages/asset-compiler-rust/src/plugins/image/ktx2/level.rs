//! Le niveau 0 d'un KTX 2.0 dont le `vkFormat` nomme le codec : sa supercompression défaite, puis
//! sa reconstruction vers RGBA8 par le socle commun `image::blocks`.
//!
//! Rien n'est alloué avant d'avoir été borné : l'image finale contre le plafond reçu, le tampon de
//! décompression contre ce plafond et contre la longueur que l'index annonce. Une supercompression
//! qui rendrait autre chose que cette longueur est un refus, pas un tampon à moitié rempli.
use super::format::{self, Layout};
use super::header::{self, Surface};
use super::{DATA_TRUNCATED, FORMAT_UNSUPPORTED, TOO_LARGE};
use crate::plugins::image::blocks as shared;
use crate::plugins::image::DecodedImage;
use crate::plugins::image::{surface_budget, RGBA8_PIXEL_BYTES};
use std::borrow::Cow;
use std::io::Read;

pub(super) fn decode(
    surface: &Surface,
    bytes: &[u8],
    max_alloc: u64,
) -> std::result::Result<DecodedImage, &'static str> {
    let layout = format::layout(surface.format).ok_or(FORMAT_UNSUPPORTED)?;
    let (width, height) = (surface.width, surface.height);
    surface_budget(width, height, RGBA8_PIXEL_BYTES, max_alloc, TOO_LARGE)?;
    let needed = layout.level_bytes(width, height);
    let level = plain(surface, bytes, needed, max_alloc)?;
    let (width, height) = (width as usize, height as usize);
    let rgba = match layout {
        Layout::Blocks { bytes, decode } => {
            shared::to_rgba8(decode, bytes, &level, width, height, DATA_TRUNCATED)?
        }
        Layout::Rgba8 => level
            .get(..width * height * 4)
            .ok_or(DATA_TRUNCATED)?
            .to_vec(),
    };
    shared::image(surface.width, surface.height, rgba, DATA_TRUNCATED)
}

/// Les octets du niveau une fois sa supercompression défaite. Sans supercompression, ce sont ceux
/// du fichier, empruntés tels quels ; en Zstandard, l'index annonce la longueur attendue, qui borne
/// à la fois l'allocation et la lecture — un flux plus long est tronqué à cette borne, donc rendu
/// trop court, donc refusé juste après.
fn plain<'a>(
    surface: &Surface,
    bytes: &'a [u8],
    needed: u64,
    max_alloc: u64,
) -> std::result::Result<Cow<'a, [u8]>, &'static str> {
    let level = &bytes[surface.level.clone()];
    if surface.supercompression != header::ZSTD {
        return Ok(Cow::Borrowed(level));
    }
    let announced = surface.plain as u64;
    if announced > max_alloc {
        return Err(TOO_LARGE);
    }
    if announced < needed {
        return Err(DATA_TRUNCATED);
    }
    let mut decoder = ruzstd::StreamingDecoder::new(level).map_err(|_| DATA_TRUNCATED)?;
    let mut out = Vec::with_capacity(surface.plain);
    decoder
        .by_ref()
        .take(announced)
        .read_to_end(&mut out)
        .map_err(|_| DATA_TRUNCATED)?;
    if out.len() != surface.plain {
        return Err(DATA_TRUNCATED);
    }
    Ok(Cow::Owned(out))
}
