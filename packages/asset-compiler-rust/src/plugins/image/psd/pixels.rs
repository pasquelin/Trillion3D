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
use super::sections::{self, Declared};
use super::{Header, COMPOSITE_MISSING, DATA_TRUNCATED};
use crate::plugins::image::{blocks, DecodedImage, RGBA8_PIXEL_BYTES};

/// Les deux octets qui annoncent la compression du composite.
const MARKER_BYTES: usize = 2;
/// Les octets d'un pixel du contrat de sortie, comptés comme le plafond d'allocation les compte.
const RGBA_BYTES: usize = RGBA8_PIXEL_BYTES as usize;

/// Saute les trois sections qui séparent l'entête des données composites, et rend ce qu'elles
/// déclarent avec le mode de compression du composite et les octets qui le suivent. Un fichier qui
/// s'arrête avant cette section n'a pas d'image aplatie : on ne recompose pas ses calques à sa place.
pub(super) fn composite<'a>(
    header: &Header,
    after_header: &'a [u8],
) -> std::result::Result<(Declared, u16, &'a [u8]), &'static str> {
    let (declared, rest) = sections::walk(header, after_header)?;
    if rest.is_empty() {
        return Err(COMPOSITE_MISSING);
    }
    let marker = rest.get(..MARKER_BYTES).ok_or(DATA_TRUNCATED)?;
    Ok((
        declared,
        u16::from_be_bytes([marker[0], marker[1]]),
        &rest[MARKER_BYTES..],
    ))
}

/// L'image RGBA8 du composite. Le tampon part tout à `u8::MAX` : les canaux de couleur du mode sont
/// toujours écrits, et l'alpha reste donc opaque exactement quand aucun plan ne le porte.
pub(super) fn decode(
    header: &Header,
    declared: &Declared,
    compression: u16,
    body: &[u8],
) -> std::result::Result<DecodedImage, &'static str> {
    let (width, height) = (header.width as usize, header.height as usize);
    let mut lines = Lines::new(header, compression, body)?;
    let mut rgba = vec![u8::MAX; width * height * RGBA_BYTES];
    let mut line = vec![0u8; width];
    for channel in 0..header.channels {
        let targets = targets(header, declared, channel);
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
/// n'est l'alpha du composite que si le fichier l'a déclaré — par le signe de son compte de
/// calques. Sinon c'est un canal alpha enregistré, une sélection : il est lu, pour que le curseur
/// avance d'un plan, et écrit nulle part. Le tampon garde son alpha opaque.
fn targets(header: &Header, declared: &Declared, channel: usize) -> &'static [usize] {
    if channel >= header.color_channels {
        return if declared.transparency { &[3] } else { &[] };
    }
    match (header.color_channels, channel) {
        (1, _) => &[0, 1, 2],
        (_, 0) => &[0],
        (_, 1) => &[1],
        _ => &[2],
    }
}
