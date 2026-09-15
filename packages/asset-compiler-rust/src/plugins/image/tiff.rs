//! Pilote TIFF, lu depuis la spécification publique « TIFF Revision 6.0 » (Adobe Developers
//! Association, 3 juin 1992) et décodé par la crate `image` (feature `tiff`, qui embarque la crate
//! `tiff`, MIT, notices conservées avec la dépendance). Aucun SDK d'éditeur, aucun réencodage.
//!
//! TIFF est un conteneur de champs plutôt qu'un format : il décrit aussi bien un RGB8 non compressé
//! qu'un scan CCITT, un JPEG emballé, un document de trente pages ou un 16 bits scientifique. Le
//! pilote ne revendique donc pas « le TIFF » : il **déclare ses profils un par un**, lit l'IFD du
//! fichier avant tout décodage (`profile`), et refuse en le nommant tout ce qui n'y est pas.
//!
//! Profils lus, tous vers RGBA8 exact :
//! - gris 8 bits, noir à zéro — la valeur est recopiée sur les trois canaux, alpha 255 ;
//! - RGB 8 bits — alpha 255 ;
//! - RGBA 8 bits à alpha non associé (droit) — les quatre octets passent tels quels ;
//! - compressions : aucune, LZW, Deflate (tags 8 et 32946), PackBits ; toutes rendent les octets
//!   d'origine, aucune n'ajoute de perte. Bandes comme tuiles : c'est la même image écrite
//!   autrement, et la configuration entrelacée est la seule acceptée.
//!
//! Refusés, nommés, jamais devinés : BigTIFF, multi-pages, palette, CMJN, YCbCr, CIELab, alpha
//! associé (prémultiplié), configuration séparée, JPEG-in-TIFF, CCITT, et toute profondeur autre
//! que 8 bits. Le 16 bits a sa propre raison : voir `DEPTH`.
use super::{crate_image, DecodedImage, ImageDecoder, Plugin};

mod profile;

pub(super) static TIFF: Tiff = Tiff;
pub(super) struct Tiff;

/// Entête ou IFD illisibles : pour l'hôte c'est le même symptôme qu'un décodage manqué, et la
/// texture retombe sur son blanc.
const UNREADABLE: &str = "image-decode-failed";
/// Un TIFF valide, mais hors des profils que ce pilote déclare lire.
const PROFILE: &str = "image-profile-unsupported";
/// Un TIFF 16 bits par composante. Ce n'est pas un profil exotique : c'est de la précision que
/// `DecodedImage` ne sait pas encore porter, sa seule variante étant RGBA8. La rogner en silence
/// ajouterait une perte que la source n'avait pas, ce que la politique d'import interdit. Pour
/// l'accepter il faudrait une variante `Rgba16` au contrat d'image et son traitement explicite chez
/// chaque consommateur — `texture_preview` aujourd'hui, la pyramide d'aperçus ensuite.
const DEPTH: &str = "image-depth-unsupported";

impl Plugin for Tiff {
    fn name(&self) -> &'static str {
        "tiff"
    }
    fn version(&self) -> &'static str {
        "tiff-image-0.25"
    }
    /// Les deux extensions du même format : `.tif` vient de la limite à trois lettres, `.tiff` est
    /// celle que posent les outils d'aujourd'hui.
    fn extensions(&self) -> &'static [&'static str] {
        &["tif", "tiff"]
    }
}

impl ImageDecoder for Tiff {
    fn mime(&self) -> &'static str {
        "image/tiff"
    }
    /// L'ordre des octets puis le nombre magique. BigTIFF (43) est reconnu ici bien qu'il soit
    /// refusé au décodage : mieux vaut le nommer que le laisser sortir en format inconnu.
    fn accepts_head(&self, head: &[u8]) -> bool {
        matches!(
            head.get(..4),
            Some(b"II\x2a\x00" | b"MM\x00\x2a" | b"II\x2b\x00" | b"MM\x00\x2b")
        )
    }
    /// Le profil d'abord, les pixels ensuite : ce qui n'est pas déclaré ne va jamais jusqu'au
    /// décodeur, et ce qui y va en ressort octet pour octet.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str> {
        profile::check(bytes)?;
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Tiff)
    }
}
