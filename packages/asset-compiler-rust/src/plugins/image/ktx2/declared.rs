//! Ce qu'un KTX 2.0 déclare autour de ses texels, appliqué ou compté — jamais ignoré en silence.
//!
//! Trois déclarations arrivent ici. Le drapeau d'alpha prémultiplié du descripteur de format : le
//! contrat de sortie demande un alpha droit, donc chaque composante est divisée par l'alpha de son
//! texel. La clé `KTXorientation` : `rd` est l'orientation du contrat, `ru` écrit ses lignes du bas
//! vers le haut et se remet à l'endroit par un retournement vertical. La clé `KTXswizzle` : seule
//! l'identité `rgba` se lit telle quelle.
//!
//! Tout ce qui sort de là — une orientation qui part vers la gauche, une permutation de canaux, une
//! troisième dimension — est compté par une raison nommée, et les texels restent où le fichier les a
//! mis. Appliquer de travers serait pire que dire qu'on ne sait pas faire.
use super::keys;
use super::{ORIENTATION_UNSUPPORTED, SWIZZLE_UNSUPPORTED};
use crate::plugins::image::DecodedImage;

/// L'orientation que le contrat d'image attend : vers la droite, vers le bas, ligne du haut d'abord.
const NATURAL: &str = "rd";
/// L'orientation qui ne diffère que par le sens vertical : le retournement la ramène au contrat.
const FLIPPED: &str = "ru";
/// La permutation identité : les canaux sont déjà ceux du contrat.
const IDENTITY: &str = "rgba";

/// Applique ce qui s'applique, compte le reste. L'image est modifiée en place ; les raisons
/// ressortent dans l'ordre où le pilote les a rencontrées.
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

/// Les composantes ramenées à un alpha droit, texel par texel et en place. Un alpha opaque laisse
/// le texel exactement tel quel, et un alpha nul ne divise rien : sous un alpha nul il n'y a pas de
/// couleur droite à retrouver. La division arrondit au plus proche et sature à l'octet plein, parce
/// qu'un encodeur peut avoir écrit une composante au-dessus de son alpha.
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

/// Les lignes remises dans l'ordre du contrat : la dernière en premier.
fn flip(pixels: &mut image::RgbaImage) {
    let stride = pixels.width() as usize * 4;
    let height = pixels.height() as usize;
    let raw: &mut [u8] = pixels;
    for row in 0..height / 2 {
        let (top, bottom) = raw.split_at_mut((height - 1 - row) * stride);
        top[row * stride..row * stride + stride].swap_with_slice(&mut bottom[..stride]);
    }
}
