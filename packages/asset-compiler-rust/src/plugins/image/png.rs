//! Pilote PNG, standard W3C PNG 1.2 / ISO 15948, décodé sans perte par la crate `image`
//! (feature `png`). Aucun réencodage : ce qui entre sans perte ressort octet pour octet.
//!
//! Profondeurs lues, toutes vers RGBA8 exact : 1, 2, 4 et 8 bits par canal, palette, niveaux de
//! gris et alpha compris — jusqu'à huit bits, l'expansion vers RGBA8 ne perd rien, elle recopie.
//!
//! Le 16 bits par canal est refusé et nommé : voir `DEPTH`. La profondeur se lit dans l'IHDR avant
//! tout décodage, parce qu'après il est trop tard — la bibliothèque rendrait un `Rgb16` que
//! `to_rgba8()` rognerait à huit bits sans que personne ne l'ait demandé.
//!
//! **Ce que le fichier déclare autour des pixels** se lit dans ses morceaux, pas dans son image.
//! Un PNG animé (APNG) porte un morceau `acTL` et plusieurs trames ; le contrat n'en rend qu'une —
//! l'image par défaut, celle des `IDAT`, comme la spécification APNG la définit — et le pilote
//! compte l'animation plutôt que de laisser les autres trames disparaître sans un mot.
use super::{crate_image, ImageDecoded, ImageDecoder, Plugin};

mod chunks;

pub(super) static PNG: Png = Png;
pub(super) struct Png;

/// Un PNG 16 bits par canal. Ce n'est pas un profil exotique : c'est de la précision que
/// `DecodedImage` ne sait pas encore porter, sa seule variante étant RGBA8. La rogner en silence
/// ajouterait une perte que la source n'avait pas, ce que la politique d'import interdit. Pour
/// l'accepter il faudrait une variante `Rgba16` au contrat d'image et son traitement explicite chez
/// chaque consommateur — `texture_preview` aujourd'hui, la pyramide d'aperçus ensuite.
const DEPTH: &str = "image-depth-unsupported";

/// Le fichier déclare une animation — morceau `acTL` — et le contrat ne rend qu'une image. C'est
/// l'image par défaut qui sort, les autres trames sont comptées sous ce nom plutôt que perdues en
/// silence. Ce n'est pas un refus : une texture animée reste une texture, sa première image vaut.
const ANIMATION: &str = "image-animation-first-frame";
/// Le morceau qui déclare l'animation : compte de trames et compte de répétitions.
const ANIMATION_CHUNK: &[u8] = b"acTL";

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
    /// Les suffixes nomment ce que ce pilote rend en propre : la profondeur maximale au-delà de
    /// laquelle il refuse, et le compte de l'animation. La version entre dans l'identité du cache —
    /// sans elle, une entrée produite quand le 16 bits était abaissé, ou quand un APNG était aplati
    /// sans un mot, continuerait d'être relue comme si elle était juste.
    fn version(&self) -> &'static str {
        "png-image-0.25-depth8-apng"
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
    ) -> std::result::Result<ImageDecoded, &'static str> {
        if bytes.get(FIRST_CHUNK) == Some(b"IHDR") && bytes.get(BIT_DEPTH) == Some(&16) {
            return Err(DEPTH);
        }
        let decoded = crate_image::decode(bytes, max_alloc, image::ImageFormat::Png)?;
        Ok(decoded.with_notes(declarations(bytes)))
    }
}

/// Ce que les morceaux déclarent et que la sortie ne porte pas. Le parcours s'arrête au premier
/// morceau coupé : un fichier tronqué est jugé par le décodeur de pixels, pas deviné ici.
fn declarations(bytes: &[u8]) -> Vec<&'static str> {
    chunks::of(bytes)
        .filter_map(|(kind, _)| (kind == ANIMATION_CHUNK).then_some(ANIMATION))
        .collect()
}
