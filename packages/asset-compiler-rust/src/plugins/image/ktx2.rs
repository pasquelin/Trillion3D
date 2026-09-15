//! Pilote KTX 2.0, le conteneur de texture de Khronos, lu depuis la spécification publique
//! « KTX File Format Specification, version 2.0 » : identifiant de douze octets, entête de
//! quatorze champs, index des sections et index des niveaux, tous écrits à la main d'après ce
//! document. Aucun SDK ni code d'éditeur.
//!
//! Trois bibliothèques permissives font le reste, chacune sur une matière :
//!
//! - `basisu` 0.1.0 (Apache-2.0, `marcogomez/basisu`, Rust pur, sans `cc` ni C++) transcode les
//!   charges Basis Universal — ETC1S sous supercompression BasisLZ, UASTC LDR 4 × 4 — vers RGBA8.
//!   C'est un portage du transcodeur de référence de Binomial, vérifié octet pour octet contre lui.
//! - `texture2ddecoder` 0.1.2 (MIT ou Apache-2.0) développe les blocs déjà compressés pour le GPU,
//!   par le socle `image::blocks` que ce pilote partage avec `dds` : le codec se nomme par
//!   `vkFormat` ici et par `dwFourCC` là, mais promener les pixels est le même travail.
//! - `ruzstd` 0.7.3 (MIT, Rust pur) défait la supercompression Zstandard d'un niveau.
//!
//! **On n'ajoute aucune perte.** Une charge ETC1S, UASTC ou BCn a déjà perdu ce qu'elle devait
//! perdre chez son encodeur ; le pilote se contente de la reconstruction que la spécification du
//! codec définit, sans filtre, sans arrondi de plus, sans réencodage. La source n'est jamais
//! modifiée.
//!
//! **Le décodage est un repli, pas la destination.** La règle du dépôt veut qu'une texture reçue
//! déjà compressée pour le GPU garde ses blocs compressés sur le GPU quand la machine les accepte.
//! Ce lot ne construit pas cette chaîne — transport, atlas et GPU sont un autre chantier — et le
//! contrat `DecodedImage` n'a qu'une variante `Rgba8`. Le pilote est découpé pour l'accueillir :
//! `header` rend la surface et les bornes de son niveau 0, `format` nomme le codec et sa géométrie
//! de bloc, `level` et `basis` ne sont que la reconstruction.
//!
//! Seul le niveau 0 est consommé, comme chez `dds` ; la chaîne annoncée est vérifiée entière, un
//! niveau qui sort du fichier est un refus. Tout le reste — cubes, tableaux, volumes, `vkFormat`
//! hors liste, supercompression inconnue, fichier tronqué, plafond d'allocation dépassé — est un
//! refus nommé, jamais une panique : une texture illisible laisse le moteur retomber sur son blanc.
use super::{DecodedImage, ImageDecoder, Plugin};

mod basis;
mod format;
mod header;
mod level;

pub(super) static KTX2: Ktx2 = Ktx2;
pub(super) struct Ktx2;

/// Les douze octets d'identifiant que tout KTX 2.0 porte en tête : « KTX 20 » entre guillemets
/// français, puis retour chariot, saut de ligne, substitut et saut de ligne.
const MAGIC: &[u8] = b"\xabKTX 20\xbb\r\n\x1a\n";

/// Moins d'octets que l'entête et son index de niveaux n'en exigent.
const HEADER_TRUNCATED: &str = "ktx2-header-truncated";
/// Un entête présent mais hors domaine : largeur nulle, `typeSize` inattendu, niveaux absurdes.
const HEADER_INVALID: &str = "ktx2-header-invalid";
/// Un `vkFormat` hors de la liste déclarée. Le pilote ne devine jamais : il refuse en le nommant.
const FORMAT_UNSUPPORTED: &str = "ktx2-format-unsupported";
/// Une disposition hors du plan simple : cube, tableau, volume, texture à une dimension.
const LAYOUT_UNSUPPORTED: &str = "ktx2-layout-unsupported";
/// Un `supercompressionScheme` hors des trois déclarés — ZLIB et les numéros à venir.
const SUPERCOMPRESSION_UNSUPPORTED: &str = "ktx2-supercompression-unsupported";
/// L'entête est cohérent mais les octets annoncés ne sont pas tous là.
const DATA_TRUNCATED: &str = "ktx2-data-truncated";
/// L'image dépasse le plafond d'allocation reçu : un refus, jamais une allocation tentée.
const TOO_LARGE: &str = "ktx2-image-too-large";
/// Une charge Basis Universal que le transcodeur refuse : codec hors liste, vidéo, flux corrompu.
const TRANSCODE_FAILED: &str = "ktx2-transcode-failed";

impl Plugin for Ktx2 {
    fn name(&self) -> &'static str {
        "ktx2"
    }
    /// Les trois lecteurs entrent dans la version : changer l'un d'eux change ce que le pilote
    /// rend, donc l'identité du cache.
    fn version(&self) -> &'static str {
        "ktx2-basisu-0.1.0-texture2ddecoder-0.1.2-ruzstd-0.7.3"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["ktx2"]
    }
}

impl ImageDecoder for Ktx2 {
    fn mime(&self) -> &'static str {
        "image/ktx2"
    }
    /// L'identifiant suffit : ces douze octets n'appartiennent qu'à ce conteneur. La cohérence de
    /// l'entête est vérifiée au décodage, où elle se rapporte au lieu de faire taire le pilote.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(MAGIC)
    }
    /// Deux chemins, que l'entête sépare seul : un `vkFormat` nommé désigne un codec du registre de
    /// `format`, et `VK_FORMAT_UNDEFINED` annonce une charge Basis Universal décrite par le
    /// descripteur de format que `basisu` relit.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str> {
        let surface = header::parse(bytes)?;
        if surface.format == format::UNDEFINED {
            basis::decode(&surface, bytes, max_alloc)
        } else {
            level::decode(&surface, bytes, max_alloc)
        }
    }
}
