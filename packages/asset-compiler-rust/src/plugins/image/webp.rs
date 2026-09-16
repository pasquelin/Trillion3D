//! Pilote WebP, **sans perte uniquement**. Lu d'après la spécification publique du format —
//! conteneur RIFF (« WebP Container Specification », Google) et flux sans perte VP8L (« WebP
//! Lossless Bitstream Specification ») — et décodé par la feature `webp` de la crate `image`
//! 0.25.10, qui délègue à `image-webp`, décodeur en Rust pur (MIT ou Apache-2.0, notices conservées
//! avec la dépendance). Aucun code ni SDK d'éditeur, aucun réencodage.
//!
//! **Politique.** La règle de fidélité du dépôt interdit d'ajouter de la perte ; elle n'admet donc
//! WebP que sans perte. Le pilote lit l'entête RIFF lui-même et tranche **avant** de décoder :
//! un flux `VP8L` entre, un flux `VP8 ` (avec perte) ressort en refus nommé, une animation aussi.
//! Un refus n'est pas une erreur de compilation : la texture laisse le moteur retomber sur son
//! blanc, comme pour tout autre format illisible.
//!
//! **Brevets.** La concession de brevets de libwebp (licence BSD-3 assortie d'un *additional IP
//! rights grant*) porte sur les implémentations conformes de la spécification, `image-webp`
//! compris. Note documentaire, pas un avis d'avocat : la politique juridique du dépôt est dans
//! `packages/asset-compiler-rust/FORMATS.md`.
use super::crate_image::{self, ANIMATED};
use super::{ImageDecoded, ImageDecoder, Plugin};

pub(super) static WEBP: Webp = Webp;
pub(super) struct Webp;

/// L'entête du conteneur : `RIFF`, la taille du reste du fichier, puis le type de formulaire.
const HEADER_BYTES: usize = 12;
/// L'entête d'un chunk RIFF : quatre octets de nom, quatre de taille.
const CHUNK_HEADER_BYTES: usize = 8;
/// Le flux avec perte : refusé sans être décodé, la règle de fidélité l'interdit.
const LOSSY: &str = "image-lossy-unsupported";

impl Plugin for Webp {
    fn name(&self) -> &'static str {
        "webp"
    }
    /// La politique entre dans la version : n'admettre que le sans-perte fait partie de ce que le
    /// pilote produit, donc de l'identité du cache.
    fn version(&self) -> &'static str {
        "webp-lossless-image-0.25"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["webp"]
    }
}

impl ImageDecoder for Webp {
    fn mime(&self) -> &'static str {
        "image/webp"
    }
    /// Le conteneur RIFF et son type de formulaire. Un WebP avec perte est reconnu ici *exprès* :
    /// mieux vaut le refuser en le nommant que le laisser passer pour un format inconnu.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.len() >= HEADER_BYTES && head.starts_with(b"RIFF") && &head[8..12] == b"WEBP"
    }
    /// Sans perte seulement, et sous le plafond d'allocation reçu. Tout le reste — flux avec perte,
    /// animation, fichier tronqué, image vide — ressort en raison de rapport nommée, jamais en
    /// panique ni en échec de compilation.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        admitted(bytes)?;
        crate_image::decode(bytes, max_alloc, image::ImageFormat::WebP)
    }
}

/// Parcourt les chunks du conteneur jusqu'au flux d'image et dit si ce flux est admis.
///
/// Les trois formes du format passent par le même parcours : un `VP8L` seul (sans perte simple), un
/// `VP8 ` seul (avec perte), et le conteneur étendu `VP8X` dont le flux d'image arrive après les
/// chunks facultatifs. `ICCP`, `ALPH`, `EXIF` et `XMP` sont franchis sans rien changer aux pixels :
/// les ignorer ne perd aucune couleur, l'alpha d'une image sans perte étant porté par VP8L même.
/// `ANIM` et `ANMF` arrêtent le parcours : une animation n'est pas une texture.
fn admitted(bytes: &[u8]) -> std::result::Result<(), &'static str> {
    if !container_is_whole(bytes) {
        return Err("image-decode-failed");
    }
    let mut offset = HEADER_BYTES;
    while offset + CHUNK_HEADER_BYTES <= bytes.len() {
        let size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        match &bytes[offset..offset + 4] {
            b"VP8L" => return Ok(()),
            b"VP8 " => return Err(LOSSY),
            b"ANIM" | b"ANMF" => return Err(ANIMATED),
            _ => {}
        }
        // Un chunk occupe son entête, sa charge, et un octet de bourrage si sa taille est impaire.
        let Some(next) = offset
            .checked_add(CHUNK_HEADER_BYTES)
            .and_then(|at| at.checked_add(size))
            .and_then(|at| at.checked_add(size & 1))
        else {
            return Err("image-decode-failed");
        };
        offset = next;
    }
    // Aucun flux d'image : le fichier s'arrête avant, ou ne porte que des métadonnées.
    Err("image-decode-failed")
}

/// La taille annoncée par l'entête RIFF contre les octets réellement là. Un fichier plus court que
/// ce qu'il déclare est tronqué : le dire ici évite de tendre au décodeur un flux amputé.
fn container_is_whole(bytes: &[u8]) -> bool {
    let Some(declared) = bytes.get(4..8) else {
        return false;
    };
    let declared = u32::from_le_bytes([declared[0], declared[1], declared[2], declared[3]]);
    bytes.len() as u64 >= u64::from(declared) + 8
}
