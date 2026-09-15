//! Contrat des pilotes d'image : reconnaître un format, en décoder les pixels.
//!
//! Un pilote par format, désigné par son extension ou par son nombre magique. Ce que le registre ne
//! reconnaît pas ressort en raison de rapport nommée — jamais en échec de compilation : une texture
//! illisible laisse le moteur retomber sur son blanc, elle n'interrompt rien.
use super::Plugin;
use std::path::Path;

mod crate_image;
mod jpeg;
mod png;
mod tga;
mod tiff;

/// Version du contrat des pilotes d'image. La changer impose de relire chaque pilote.
pub const VERSION: &str = "image-plugin-1";

/// Le registre : un pilote par format. Ajouter un format, c'est un module et une ligne ici.
pub static DECODERS: &[&dyn ImageDecoder] = &[&png::PNG, &jpeg::JPEG, &tga::TGA, &tiff::TIFF];

/// Ce qu'un pilote rend. Les formats flottants — EXR, Radiance HDR — entreront par une variante de
/// plus, que chaque consommateur devra alors traiter explicitement plutôt que ramener à 8 bits.
pub enum DecodedImage {
    /// RGBA 8 bits par canal, sRGB, alpha droit, au moins un pixel.
    Rgba8(image::RgbaImage),
}

/// Un pilote d'image. Il ne rend jamais d'image vide et ne panique jamais : un octet imprévu est une
/// raison de rapport, une chaîne stable que le manifeste compte.
pub trait ImageDecoder: Plugin + Sync {
    /// Type MIME publié dans le glTF intermédiaire pour une image de ce format.
    fn mime(&self) -> &'static str;
    /// Reconnaît le format à ses premiers octets.
    fn accepts_head(&self, head: &[u8]) -> bool;
    /// Décode sous ce plafond d'allocation. Une image plus grande est un refus, pas une panique.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str>;
}

/// Le pilote qui revendique l'extension de ce chemin.
pub fn by_extension(path: &Path) -> Option<&'static dyn ImageDecoder> {
    let name = path.file_name()?.to_str()?;
    super::claiming(DECODERS, &super::extension_of(name)?)
}

/// Le pilote qui reconnaît ces octets.
pub fn by_head(bytes: &[u8]) -> Option<&'static dyn ImageDecoder> {
    DECODERS
        .iter()
        .copied()
        .find(|decoder| decoder.accepts_head(bytes))
}

/// Toutes les extensions du registre, dans l'ordre des pilotes : c'est l'ordre dans lequel on
/// cherche un fichier voisin décodable à côté d'une texture que l'on ne sait pas lire.
pub fn extensions() -> impl Iterator<Item = &'static str> {
    DECODERS
        .iter()
        .flat_map(|decoder| decoder.extensions().iter().copied())
}

/// Décode des octets par le pilote qui les reconnaît. Un format hors registre rend la raison de
/// rapport `image-format-unknown`.
pub fn decode(bytes: &[u8], max_alloc: u64) -> std::result::Result<DecodedImage, &'static str> {
    by_head(bytes)
        .ok_or("image-format-unknown")?
        .decode(bytes, max_alloc)
}
