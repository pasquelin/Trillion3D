//! Socle des pilotes servis par la crate `image`, dont les features sont déclarées une par une dans
//! `Cargo.toml` : un format absent des features ne se décode pas, même si ses octets se devinent.
//!
//! Le format est imposé par le pilote appelant, jamais deviné ici : c'est le registre qui a désigné
//! le pilote, et lui seul décide de ce qu'il accepte.
//! Le plafond d'allocation porte sur l'image **rendue** : ces pilotes rendent tous du RGBA8, donc
//! sur largeur par hauteur par quatre octets. Les dimensions se lisent dans l'entête, sous le même
//! plafond, avant que le moindre pixel ne soit décodé : un fichier de trois octets qui s'étend à
//! quatre passait sinon sous un plafond de trois.
use super::{surface_budget, DecodedImage, ImageDecoded, RGBA8_PIXEL_BYTES};

/// Une animation n'est pas une texture : refusée, jamais aplatie, quel que soit le format qui la porte.
pub(super) const ANIMATED: &str = "image-animation-unsupported";
/// L'image, une fois étendue en RGBA8, demande plus que le plafond d'allocation reçu.
const TOO_LARGE: &str = "image-too-large";

pub(super) fn decode(
    bytes: &[u8],
    max_alloc: u64,
    format: image::ImageFormat,
) -> std::result::Result<ImageDecoded, &'static str> {
    let reader = || {
        let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes));
        reader.set_format(format);
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(max_alloc);
        reader.limits(limits);
        reader
    };
    let (width, height) = reader()
        .into_dimensions()
        .map_err(|_| "image-decode-failed")?;
    if width == 0 || height == 0 {
        return Err("image-empty");
    }
    surface_budget(width, height, RGBA8_PIXEL_BYTES, max_alloc, TOO_LARGE)?;
    let decoded = reader().decode().map_err(|_| "image-decode-failed")?;
    Ok(ImageDecoded::srgb(DecodedImage::Rgba8(
        decoded.into_rgba8(),
    )))
}
