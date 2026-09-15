//! Les données composites d'un PSD ou d'un PSB : l'image aplatie que le fichier porte déjà, plan
//! par plan. Trois sections à longueur préfixée séparent l'entête de ces octets — données de mode
//! de couleur, ressources d'image, calques et masques — et se sautent par leur longueur, sans que
//! rien n'y soit lu : les calques ne sont pas recomposés.
//!
//! La section commence par son mode de compression, puis porte un plan entier après l'autre, dans
//! l'ordre des canaux de l'entête. Les plans bruts sont la surface telle quelle ; les plans
//! compressés sont des lignes PackBits, précédées d'une table qui donne la longueur compressée de
//! chaque ligne de chaque canal — deux octets par entrée en PSD, quatre en PSB.
use super::lines::Lines;
use super::{Header, COMPOSITE_MISSING, DATA_TRUNCATED};
use crate::plugins::image::{blocks, DecodedImage, RGBA8_PIXEL_BYTES};

/// Les deux octets qui annoncent la compression du composite.
const MARKER_BYTES: usize = 2;
/// Les octets d'un pixel du contrat de sortie, comptés comme le plafond d'allocation les compte.
const RGBA_BYTES: usize = RGBA8_PIXEL_BYTES as usize;

/// Saute les trois sections qui séparent l'entête des données composites, et rend le mode de
/// compression de celles-ci avec les octets qui le suivent. Un fichier qui s'arrête avant cette
/// section n'a pas d'image aplatie : on ne recompose pas ses calques à sa place.
pub(super) fn composite<'a>(
    header: &Header,
    after_header: &'a [u8],
) -> std::result::Result<(u16, &'a [u8]), &'static str> {
    let mut rest = after_header;
    // Les deux premières longueurs tiennent sur quatre octets dans les deux versions du format ;
    // seule celle de la section des calques double de largeur en PSB.
    for wide in [false, false, header.psb] {
        rest = skip(rest, wide)?;
    }
    if rest.is_empty() {
        return Err(COMPOSITE_MISSING);
    }
    let marker = rest.get(..MARKER_BYTES).ok_or(DATA_TRUNCATED)?;
    Ok((
        u16::from_be_bytes([marker[0], marker[1]]),
        &rest[MARKER_BYTES..],
    ))
}

/// Une section à longueur préfixée, sautée par sa longueur. Une longueur qui sort du fichier est
/// une troncature nommée, jamais une lecture à côté.
fn skip(bytes: &[u8], wide: bool) -> std::result::Result<&[u8], &'static str> {
    let prefix = if wide { 8 } else { 4 };
    let field = bytes.get(..prefix).ok_or(DATA_TRUNCATED)?;
    let length = field
        .iter()
        .fold(0u64, |value, byte| value << 8 | u64::from(*byte));
    let end = usize::try_from(length)
        .ok()
        .and_then(|length| prefix.checked_add(length))
        .ok_or(DATA_TRUNCATED)?;
    bytes.get(end..).ok_or(DATA_TRUNCATED)
}

/// L'image RGBA8 du composite. Le tampon part tout à `u8::MAX` : les canaux de couleur du mode sont
/// toujours écrits, et l'alpha reste donc opaque exactement quand aucun plan ne le porte.
pub(super) fn decode(
    header: &Header,
    compression: u16,
    body: &[u8],
) -> std::result::Result<DecodedImage, &'static str> {
    let (width, height) = (header.width as usize, header.height as usize);
    let mut lines = Lines::new(header, compression, body)?;
    let mut rgba = vec![u8::MAX; width * height * RGBA_BYTES];
    let mut line = vec![0u8; width];
    for channel in 0..header.channels {
        let targets = targets(header, channel);
        for row in 0..height {
            lines.read(channel * height + row, &mut line)?;
            let start = row * width * RGBA_BYTES;
            let quads = rgba
                .get_mut(start..start + width * RGBA_BYTES)
                .ok_or(DATA_TRUNCATED)?;
            let (quads, _) = quads.as_chunks_mut::<RGBA_BYTES>();
            for (pixel, value) in quads.iter_mut().zip(line.iter().copied()) {
                for target in targets {
                    pixel[*target] = value;
                }
            }
        }
    }
    blocks::image(header.width, header.height, rgba, DATA_TRUNCATED)
}

/// Où va un plan dans le quadruplet de sortie. En niveaux de gris, l'unique canal de couleur porte
/// les trois composantes ; en RVB, chacun porte la sienne. Le plan qui suit les canaux de couleur
/// est l'alpha du composite — l'entête n'en admet pas d'autre.
fn targets(header: &Header, channel: usize) -> &'static [usize] {
    if channel >= header.color_channels {
        return &[3];
    }
    match (header.color_channels, channel) {
        (1, _) => &[0, 1, 2],
        (_, 0) => &[0],
        (_, 1) => &[1],
        _ => &[2],
    }
}
