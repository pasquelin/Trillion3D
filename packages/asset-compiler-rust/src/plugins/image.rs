//! Contrat des pilotes d'image : reconnaître un format, en décoder les pixels.
//!
//! Un pilote par format, désigné par son extension ou par son nombre magique. Ce que le registre ne
//! reconnaît pas ressort en raison de rapport nommée — jamais en échec de compilation : une texture
//! illisible laisse le moteur retomber sur son blanc, elle n'interrompt rien.
use super::Plugin;
use std::path::Path;

mod blocks;
mod bmp;
mod crate_image;
mod dds;
mod exr;
mod gif;
mod hdr;
mod jpeg;
mod ktx2;
mod png;
mod psd;
mod tga;
mod tiff;
mod webp;

/// Version du contrat des pilotes d'image. La changer impose de relire chaque pilote, et invalide
/// les caches : depuis `image-plugin-2`, un pilote peut rendre une seconde sortie que tout
/// consommateur doit trancher explicitement.
pub const VERSION: &str = "image-plugin-2";

/// Le registre : un pilote par format. Ajouter un format, c'est un module et une ligne ici.
pub static DECODERS: &[&dyn ImageDecoder] = &[
    &png::PNG,
    &jpeg::JPEG,
    &tga::TGA,
    &tiff::TIFF,
    &dds::DDS,
    &webp::WEBP,
    &exr::EXR,
    &hdr::HDR,
    &ktx2::KTX2,
    &psd::PSD,
    &bmp::BMP,
    &gif::GIF,
];

/// Ce qu'un pilote rend. Deux sorties, et aucun pont de l'une vers l'autre : ramener un flottant à
/// huit bits demanderait une courbe de report de tons, donc une perte que la source n'avait pas, ce
/// que la politique d'import interdit. Un consommateur qui ne sait traiter qu'une variante refuse
/// l'autre par une raison de rapport nommée.
pub enum DecodedImage {
    /// RGBA 8 bits par canal, sRGB, alpha droit, au moins un pixel.
    Rgba8(image::RgbaImage),
    /// RGBA 32 bits flottants par canal, **linéaire** et à alpha droit, au moins un pixel : ce que
    /// rendent les formats à grande gamme dynamique. `data` porte `width * height * 4` valeurs, un
    /// pixel après l'autre, ligne du haut d'abord.
    RgbaF32 {
        width: u32,
        height: u32,
        data: Vec<f32>,
    },
}

/// Une texture de 2³² texels de côté n'a que trente-trois niveaux : au-delà, le champ ment. `dds`
/// et `ktx2` lisent ce compte dans leur entête respectif et posent la même borne.
const MAX_LEVELS: u32 = 33;

/// Octets qu'occupe un pixel de la variante flottante : quatre canaux de quatre octets.
const FLOAT_PIXEL_BYTES: u64 = 16;

/// Octets qu'occupe un pixel RGBA8.
const RGBA8_PIXEL_BYTES: u64 = 4;

/// Le plafond d'allocation d'une surface, vérifié avant de décoder quoi que ce soit, à
/// `pixel_bytes` octets par pixel. `saturating_mul` garde la comparaison juste quand une dimension
/// ment, là où une multiplication qui déborde laisserait passer. Le vide n'est pas jugé ici : `dds`
/// et `ktx2` le refusent à la lecture de leur entête, les pilotes flottants dans `float_budget`.
fn surface_budget(
    width: u32,
    height: u32,
    pixel_bytes: u64,
    max_alloc: u64,
    too_large: &'static str,
) -> std::result::Result<(), &'static str> {
    if u64::from(width)
        .saturating_mul(u64::from(height))
        .saturating_mul(pixel_bytes)
        > max_alloc
    {
        return Err(too_large);
    }
    Ok(())
}

/// Ce qu'un pilote flottant vérifie avant d'allouer quoi que ce soit : une image d'au moins un pixel
/// dont la surface tient sous le plafond reçu, comptée à seize octets par pixel. Un dépassement est
/// une raison de rapport — celle du pilote appelant —, jamais une allocation tentée puis une panique.
fn float_budget(
    width: u32,
    height: u32,
    max_alloc: u64,
    too_large: &'static str,
) -> std::result::Result<(), &'static str> {
    if width == 0 || height == 0 {
        return Err("image-empty");
    }
    surface_budget(width, height, FLOAT_PIXEL_BYTES, max_alloc, too_large)
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
