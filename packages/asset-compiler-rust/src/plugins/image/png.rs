//! Pilote PNG, standard W3C PNG 1.2 / ISO 15948, décodé sans perte par la crate `image`
//! (feature `png`). Aucun réencodage : ce qui entre sans perte ressort octet pour octet.
//!
//! Profondeurs lues, toutes vers RGBA8 exact : 1, 2, 4 et 8 bits par canal, palette, niveaux de
//! gris et alpha compris — jusqu'à huit bits, l'expansion vers RGBA8 ne perd rien, elle recopie.
//!
//! Le 16 bits par canal est refusé et nommé : voir `DEPTH`. La profondeur se lit dans l'IHDR avant
//! tout décodage, parce qu'après il est trop tard — la bibliothèque rendrait un `Rgb16` que
//! `to_rgba8()` rognerait à huit bits sans que personne ne l'ait demandé.
use super::{crate_image, DecodedImage, ImageDecoder, Plugin};

pub(super) static PNG: Png = Png;
pub(super) struct Png;

/// Un PNG 16 bits par canal. Ce n'est pas un profil exotique : c'est de la précision que
/// `DecodedImage` ne sait pas encore porter, sa seule variante étant RGBA8. La rogner en silence
/// ajouterait une perte que la source n'avait pas, ce que la politique d'import interdit. Pour
/// l'accepter il faudrait une variante `Rgba16` au contrat d'image et son traitement explicite chez
/// chaque consommateur — `texture_preview` aujourd'hui, la pyramide d'aperçus ensuite.
const DEPTH: &str = "image-depth-unsupported";

/// Le type du premier morceau, qui est toujours l'IHDR : signature de huit octets, puis la longueur
/// du morceau sur quatre.
const FIRST_CHUNK: std::ops::Range<usize> = 12..16;
/// L'octet de profondeur dans l'IHDR : les huit de la signature, les huit de la longueur et du type
/// du morceau, les huit de la largeur et de la hauteur.
const BIT_DEPTH: usize = 24;

impl Plugin for Png {
    fn name(&self) -> &'static str {
        "png"
    }
    fn version(&self) -> &'static str {
        "png-image-0.25"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["png"]
    }
}

impl ImageDecoder for Png {
    fn mime(&self) -> &'static str {
        "image/png"
    }
    /// La signature de huit octets que tout PNG porte en tête.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(b"\x89PNG\r\n\x1a\n")
    }
    /// La profondeur d'abord, les pixels ensuite. Un fichier trop court pour porter son IHDR n'est
    /// pas jugé ici : il part au décodeur, qui le refuse comme avant.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str> {
        if bytes.get(FIRST_CHUNK) == Some(b"IHDR") && bytes.get(BIT_DEPTH) == Some(&16) {
            return Err(DEPTH);
        }
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Png)
    }
}
