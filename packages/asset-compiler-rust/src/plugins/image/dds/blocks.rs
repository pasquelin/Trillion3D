//! La reconstruction du niveau 0 vers RGBA8, et rien d'autre.
//!
//! Pour un codec compressé, `texture2ddecoder` développe chaque bloc de 4 × 4 par l'interpolation
//! entière que la spécification définit — aucun arrondi ni filtre n'est ajouté ici — et rend un
//! pixel par mot de trente-deux bits, octets B, G, R, A en mémoire. La seule chose que fait ce
//! module ensuite est de remettre ces octets dans l'ordre du contrat, R, G, B, A.
//!
//! Pour une surface non compressée, les octets sont déjà là : on les remet dans le même ordre.
use super::codec::{BlockDecode, Codec};
use super::{header::Surface, CODEC_UNSUPPORTED};
use super::{DecodedImage, DATA_TRUNCATED, TOO_LARGE};

pub(super) fn decode(
    surface: &Surface,
    bytes: &[u8],
    max_alloc: u64,
) -> std::result::Result<DecodedImage, &'static str> {
    let pixels = u64::from(surface.width).saturating_mul(u64::from(surface.height));
    if pixels.saturating_mul(4) > max_alloc {
        return Err(TOO_LARGE);
    }
    let level = &bytes[surface.data..];
    let (width, height) = (surface.width as usize, surface.height as usize);
    let rgba = match surface.codec.block_decode() {
        Some(decode) => from_blocks(decode, level, width, height)?,
        None => from_pixels(surface.codec, level, width * height)?,
    };
    ::image::RgbaImage::from_raw(surface.width, surface.height, rgba)
        .map(DecodedImage::Rgba8)
        .ok_or(DATA_TRUNCATED)
}

/// Les blocs compressés, développés par le décodeur du codec puis remis en RGBA8. Un niveau trop
/// court pour le nombre de blocs annoncé est un refus du décodeur, jamais une panique.
fn from_blocks(
    decode: BlockDecode,
    level: &[u8],
    width: usize,
    height: usize,
) -> std::result::Result<Vec<u8>, &'static str> {
    let mut packed = vec![0u32; width * height];
    decode(level, width, height, &mut packed).map_err(|_| DATA_TRUNCATED)?;
    Ok(packed
        .into_iter()
        .flat_map(|pixel| {
            let [b, g, r, a] = pixel.to_le_bytes();
            [r, g, b, a]
        })
        .collect())
}

/// Une surface non compressée, quatre octets par pixel. `Bgrx8` n'a pas de canal alpha : son
/// quatrième octet est ignoré par la spécification, la surface est opaque.
fn from_pixels(
    codec: Codec,
    level: &[u8],
    pixels: usize,
) -> std::result::Result<Vec<u8>, &'static str> {
    let (swapped, opaque) = match codec {
        Codec::Rgba8 => (false, false),
        Codec::Bgra8 => (true, false),
        Codec::Bgrx8 => (true, true),
        // Les codecs compressés ne passent jamais par ici : ils ont un décodeur de blocs.
        _ => return Err(CODEC_UNSUPPORTED),
    };
    let needed = pixels.saturating_mul(4);
    if level.len() < needed {
        return Err(DATA_TRUNCATED);
    }
    let (rows, _) = level[..needed].as_chunks::<4>();
    Ok(rows
        .iter()
        .flat_map(|px| {
            let (red, blue) = if swapped {
                (px[2], px[0])
            } else {
                (px[0], px[2])
            };
            [red, px[1], blue, if opaque { 255 } else { px[3] }]
        })
        .collect())
}
