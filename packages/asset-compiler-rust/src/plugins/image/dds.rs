//! Pilote DDS (DirectDraw Surface), lu depuis la spécification publique de Microsoft
//! « DDS — Programming Guide » (`DDS_HEADER`, `DDS_PIXELFORMAT`, `DDS_HEADER_DXT10`, énumération
//! `DXGI_FORMAT`), écrite à la main d'après cette documentation : aucun SDK ni code d'éditeur.
//! Les blocs compressés sont développés par la crate `texture2ddecoder` 0.1.2 (MIT ou Apache-2.0,
//! `UniversalGameExtraction/texture2ddecoder`, Rust pur, notices conservées avec la dépendance).
//!
//! **On n'ajoute aucune perte.** Un DDS BCn a déjà perdu ce qu'il devait perdre chez son encodeur ;
//! le pilote se contente de l'interpolation entière que la spécification définit, bloc par bloc,
//! sans filtre, sans arrondi de plus, sans réencodage. Le fichier source n'est jamais modifié.
//!
//! **Le décodage est un repli, pas la destination.** La règle du dépôt veut qu'une texture reçue
//! déjà compressée pour le GPU garde ses blocs compressés sur le GPU quand la machine les accepte.
//! Ce lot ne construit pas cette chaîne — transport, atlas et GPU sont un autre chantier — et le
//! contrat `DecodedImage` n'a qu'une variante `Rgba8` que le cœur déconstruit par `let` irréfutable
//! (`src/texture_preview.rs`). Ce qu'il faudra ajouter est écrit dans `orchestration/JOURNAL.md` :
//! une variante `DecodedImage::Blocks` portant le codec, les dimensions et les octets bruts de la
//! surface. Le pilote est déjà découpé pour cela : `codec` nomme le codec et sa géométrie de bloc,
//! `header` rend la surface et l'offset de ses octets, `blocks` n'est que la reconstruction.
//!
//! Codecs déclarés un par un : BC1, BC2, BC3, BC4, BC5, BC7, et les surfaces non compressées
//! RGBA8, BGRA8 et BGRX8. Tout le reste — BC6H flottant, variantes signées, `DXT2`/`DXT4` à alpha
//! prémultiplié, formats 16 bits, YUV, cubes, volumes, tableaux — est un refus nommé, jamais une
//! panique : une texture illisible laisse le moteur retomber sur son blanc.
use super::{DecodedImage, ImageDecoder, Plugin};

mod blocks;
mod codec;
mod header;

pub(super) static DDS: Dds = Dds;
pub(super) struct Dds;

/// Le nombre magique de quatre octets que tout DDS porte avant son entête.
const MAGIC: &[u8] = b"DDS ";

/// Moins d'octets que l'entête n'en exige : le fichier est coupé avant d'avoir tout dit.
const HEADER_TRUNCATED: &str = "dds-header-truncated";
/// Un entête présent mais hors domaine : taille annoncée fausse, dimension nulle, mips absurdes.
const HEADER_INVALID: &str = "dds-header-invalid";
/// Un codec hors de la liste déclarée. Le pilote ne devine jamais : il refuse en le nommant.
const CODEC_UNSUPPORTED: &str = "dds-codec-unsupported";
/// Une disposition hors du plan simple : cube, volume, tableau, pas de ligne inattendu.
const LAYOUT_UNSUPPORTED: &str = "dds-layout-unsupported";
/// L'entête est cohérent mais les pixels annoncés ne sont pas tous là.
const DATA_TRUNCATED: &str = "dds-data-truncated";
/// L'image dépasse le plafond d'allocation reçu : un refus, jamais une allocation tentée.
const TOO_LARGE: &str = "dds-image-too-large";

impl Plugin for Dds {
    fn name(&self) -> &'static str {
        "dds"
    }
    fn version(&self) -> &'static str {
        "dds-texture2ddecoder-0.1.2"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["dds"]
    }
}

impl ImageDecoder for Dds {
    fn mime(&self) -> &'static str {
        "image/vnd.ms-dds"
    }
    /// Le nombre magique suffit : il n'appartient qu'à ce conteneur. La cohérence de l'entête est
    /// vérifiée au décodage, où elle se rapporte au lieu de faire taire le pilote.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(MAGIC)
    }
    /// Seul le niveau 0 est consommé ; la chaîne de mips annoncée est comptée et doit tenir dans le
    /// fichier — un DDS qui promet neuf niveaux et n'en porte que deux est tronqué, pas à moitié bon.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str> {
        blocks::decode(&header::parse(bytes)?, bytes, max_alloc)
    }
}
