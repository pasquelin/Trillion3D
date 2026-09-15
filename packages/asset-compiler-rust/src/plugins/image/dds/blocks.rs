//! La reconstruction du niveau 0 vers RGBA8, et rien d'autre.
//!
//! Pour un codec compressé, `texture2ddecoder` développe chaque bloc de 4 × 4 par l'interpolation
//! entière que la spécification définit — aucun arrondi ni filtre n'est ajouté ici — et rend un
//! pixel par mot de trente-deux bits, octets B, G, R, A en mémoire. La seule chose que fait ce
//! module ensuite est de remettre ces octets dans l'ordre du contrat, R, G, B, A.
//!
//! Pour une surface non compressée, les octets sont déjà là : on les remet dans le même ordre.
use super::codec::{BlockDecode, Layout, Order};
use super::header::Surface;
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
    let rgba = match surface.codec.layout() {
        Layout::Blocks { bytes, decode } => {
            from_blocks(decode, usize::from(bytes), level, width, height)?
        }
        Layout::Pixels(order) => from_pixels(order, level, width * height)?,
    };
    ::image::RgbaImage::from_raw(surface.width, surface.height, rgba)
        .map(DecodedImage::Rgba8)
        .ok_or(DATA_TRUNCATED)
}

/// Les blocs compressés, développés par le décodeur du codec puis remis en RGBA8. Le décodeur
/// travaille une rangée de blocs à la fois dans un tampon de quatre lignes de pixels, recopiées
/// aussitôt dans l'image : aucun second tampon de la taille de l'image. Chaque bloc se décode
/// seul, donc découper par rangée rend exactement les mêmes pixels. Un niveau trop court pour le
/// nombre de blocs annoncé est un refus du décodeur, jamais une panique.
fn from_blocks(
    decode: BlockDecode,
    block_bytes: usize,
    level: &[u8],
    width: usize,
    height: usize,
) -> std::result::Result<Vec<u8>, &'static str> {
    let row_bytes = width.div_ceil(4) * block_bytes;
    let mut strip = vec![0u32; width * height.min(4)];
    let mut rgba = Vec::with_capacity(width * height * 4);
    for (row, top) in (0..height).step_by(4).enumerate() {
        let lines = (height - top).min(4);
        let blocks = level.get(row * row_bytes..).ok_or(DATA_TRUNCATED)?;
        decode(blocks, width, lines, &mut strip).map_err(|_| DATA_TRUNCATED)?;
        rgba.extend(strip[..width * lines].iter().flat_map(|pixel| {
            let [b, g, r, a] = pixel.to_le_bytes();
            [r, g, b, a]
        }));
    }
    Ok(rgba)
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
