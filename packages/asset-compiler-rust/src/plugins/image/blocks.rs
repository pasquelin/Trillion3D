//! La reconstruction d'une surface en blocs de 4 × 4 vers RGBA8, partagée par les pilotes qui
//! reçoivent des blocs déjà compressés pour le GPU : `dds` et `ktx2` nomment leurs codecs chacun à
//! sa façon — `dwFourCC`, `dxgiFormat`, `vkFormat` — mais une fois le décodeur choisi, promener ses
//! pixels est exactement le même travail, et il ne s'écrit qu'une fois.
//!
//! `texture2ddecoder` développe chaque bloc par l'interpolation entière que la spécification du
//! codec définit — aucun arrondi ni filtre n'est ajouté ici — et rend un pixel par mot de
//! trente-deux bits, octets B, G, R, A en mémoire. La seule chose que fait ce module ensuite est de
//! remettre ces octets dans l'ordre du contrat, R, G, B, A.
use super::DecodedImage;

/// La signature d'un décodeur de blocs : les octets du niveau, ses dimensions, les pixels rendus.
pub(super) type BlockDecode = fn(&[u8], usize, usize, &mut [u32]) -> Result<(), &'static str>;

/// Développe le niveau 0 d'une surface en blocs de 4 × 4. Le décodeur travaille une rangée de blocs
/// à la fois dans un tampon de quatre lignes de pixels, recopiées aussitôt dans l'image : aucun
/// second tampon de la taille de l'image. Chaque bloc se décode seul, donc découper par rangée rend
/// exactement les mêmes pixels. `truncated` est la raison que le pilote appelant donne à un niveau
/// plus court que le nombre de blocs annoncé — un refus nommé, jamais une panique.
pub(super) fn to_rgba8(
    decode: BlockDecode,
    block_bytes: usize,
    level: &[u8],
    width: usize,
    height: usize,
    truncated: &'static str,
) -> std::result::Result<Vec<u8>, &'static str> {
    let row_bytes = width.div_ceil(4) * block_bytes;
    let mut strip = vec![0u32; width * height.min(4)];
    let mut rgba = Vec::with_capacity(width * height * 4);
    for (row, top) in (0..height).step_by(4).enumerate() {
        let lines = (height - top).min(4);
        let blocks = level.get(row * row_bytes..).ok_or(truncated)?;
        decode(blocks, width, lines, &mut strip).map_err(|_| truncated)?;
        rgba.extend(strip[..width * lines].iter().flat_map(|pixel| {
            let [b, g, r, a] = pixel.to_le_bytes();
            [r, g, b, a]
        }));
    }
    Ok(rgba)
}

/// L'image RGBA8 de ces octets, ou la raison nommée du pilote quand ils ne remplissent pas la
/// surface annoncée. Le contrat d'image interdit une image vide : `from_raw` est la seule porte.
pub(super) fn image(
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    truncated: &'static str,
) -> std::result::Result<DecodedImage, &'static str> {
    ::image::RgbaImage::from_raw(width, height, rgba)
        .map(DecodedImage::Rgba8)
        .ok_or(truncated)
}
