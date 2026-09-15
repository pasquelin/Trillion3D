//! Pilote PSD et PSB (Photoshop), lecteur écrit ici depuis la spécification publiée par Adobe pour
//! les lecteurs tiers — « Adobe Photoshop File Formats Specification » —, qui définit l'entête de
//! vingt-six octets, les trois sections à longueur préfixée qui le suivent et la section de données
//! composites en fin de fichier. Aucun code ni SDK d'éditeur, aucune bibliothèque tierce : ces
//! quatre morceaux se lisent d'un bout à l'autre, ce qui ne justifie pas une dépendance.
//!
//! **Le composite aplati, et lui seul.** Un PSD porte ses calques ; les recomposer demanderait de
//! refaire les modes de fusion, les masques et les effets de l'éditeur, donc de produire une image
//! que le fichier ne contient pas. Ce pilote lit la seule image que le fichier contient déjà : les
//! données composites que l'éditeur écrit en fin de fichier. Un fichier sauvé sans elles ressort en
//! raison de rapport, il ne se recompose pas.
//!
//! **On n'ajoute aucune perte.** Le contrat de sortie est du RGBA8, donc seules les sources de huit
//! bits par canal entrent. Seize ou trente-deux bits sont refusés par leur nom plutôt que rognés ;
//! CMJN, Lab, indexé, duotone, multicanal et bitmap le sont aussi, parce que les convertir
//! demanderait un profil, une matrice ou une palette que le pilote choisirait à la place de la
//! source. L'alpha du composite est lu tel quel, droit : rien n'est démultiplié.
//!
//! **Sous-ensemble accepté** : modes RVB et niveaux de gris, huit bits par canal, avec ou sans un
//! plan d'alpha, données composites brutes ou compressées par plages (PackBits), PSD comme PSB.
use super::{rgba8_budget, DecodedImage, ImageDecoder, Plugin};

mod lines;
mod pixels;

pub(super) static PSD: Psd = Psd;
pub(super) struct Psd;

/// Les quatre octets de signature que le format porte en tête.
const SIGNATURE: &[u8] = b"8BPS";
/// L'entête complet : signature, version, six octets réservés, canaux, hauteur, largeur, profondeur
/// et mode de couleur.
const HEADER_BYTES: usize = 26;
/// Version 1, le PSD ; version 2, le PSB, qui n'en diffère que par ses plafonds de taille et par la
/// largeur de deux champs de longueur.
const VERSION_PSD: u16 = 1;
const VERSION_PSB: u16 = 2;
/// Les deux modes de couleur du sous-ensemble : niveaux de gris et RVB.
const MODE_GRAYSCALE: u16 = 1;
const MODE_RGB: u16 = 3;
/// La seule profondeur qu'un contrat RGBA8 porte sans rien perdre.
const DEPTH_8: u16 = 8;
/// Plafonds de côté de la spécification : trente mille pixels en PSD, dix fois plus en PSB.
const MAX_SIDE_PSD: u32 = 30_000;
const MAX_SIDE_PSB: u32 = 300_000;
/// Plafond de canaux de la spécification.
const MAX_CHANNELS: u16 = 56;

/// Signature absente, version inconnue, octets réservés non nuls, dimension nulle ou hors plafond,
/// nombre de canaux hors plafond ou inférieur aux canaux de couleur du mode.
const HEADER_INVALID: &str = "psd-header-invalid";
/// Une profondeur que le contrat RGBA8 ne porte pas : un, seize ou trente-deux bits par canal.
const DEPTH_UNSUPPORTED: &str = "psd-depth-unsupported";
/// Un mode de couleur hors du sous-ensemble : bitmap, indexé, CMJN, multicanal, duotone, Lab.
const COLOR_MODE_UNSUPPORTED: &str = "psd-color-mode-unsupported";
/// Plus d'un canal au-delà des canaux de couleur du mode : rien dans l'entête ne dit si ce plan est
/// une transparence, une sélection enregistrée ou une couleur d'appoint.
const CHANNELS_UNSUPPORTED: &str = "psd-channels-unsupported";
/// Une compression du composite hors du sous-ensemble : les deux variantes ZIP de la spécification.
const COMPRESSION_UNSUPPORTED: &str = "psd-compression-unsupported";
/// Le fichier s'arrête avant sa section de données composites : il n'y a pas d'image aplatie à lire.
const COMPOSITE_MISSING: &str = "psd-composite-missing";
/// Les octets annoncés ne sont pas tous là, ou une ligne compressée ne rend pas sa largeur.
const DATA_TRUNCATED: &str = "psd-data-truncated";
/// L'image dépasse le plafond d'allocation reçu : un refus, jamais une allocation tentée.
const TOO_LARGE: &str = "psd-image-too-large";

/// Ce que l'entête annonce, une fois tous ses champs jugés dans leur domaine et les uns contre les
/// autres : de quoi lire les plans du composite et rien de plus.
struct Header {
    /// Un PSB : ses deux champs de longueur — section des calques et compte d'octets d'une ligne
    /// compressée — sont deux fois plus larges que ceux d'un PSD.
    psb: bool,
    width: u32,
    height: u32,
    /// Les plans que le composite porte, canaux de couleur puis l'alpha s'il y en a un.
    channels: usize,
    /// Les canaux de couleur du mode : trois en RVB, un en niveaux de gris.
    color_channels: usize,
}

impl Plugin for Psd {
    fn name(&self) -> &'static str {
        "psd"
    }
    fn version(&self) -> &'static str {
        "psd-composite-aplati-1"
    }
    /// `.psd` et `.psb` sont les deux extensions du format. L'extension ne fait que désigner le
    /// pilote : ce sont les octets qui décident.
    fn extensions(&self) -> &'static [&'static str] {
        &["psd", "psb"]
    }
}

impl ImageDecoder for Psd {
    fn mime(&self) -> &'static str {
        "image/vnd.adobe.photoshop"
    }
    /// La signature et le numéro de version, six octets que seul ce format porte. Le reste de
    /// l'entête se juge au décodage, pour qu'un défaut y ressorte par son nom plutôt que par un
    /// format inconnu.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.len() >= SIGNATURE.len() + 2
            && head.starts_with(SIGNATURE)
            && matches!(
                u16::from_be_bytes([head[4], head[5]]),
                VERSION_PSD | VERSION_PSB
            )
    }
    /// L'entête d'abord — il donne la taille, donc le plafond s'applique avant toute allocation —,
    /// puis les trois sections à sauter, puis les plans du composite.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str> {
        let (header, rest) = header(bytes)?;
        rgba8_budget(header.width, header.height, max_alloc, TOO_LARGE)?;
        let (compression, body) = pixels::composite(&header, rest)?;
        pixels::decode(&header, compression, body)
    }
}

/// L'entête, champ par champ puis champ contre champ, et les octets qui le suivent. Le nombre de
/// canaux se juge contre le mode de couleur : un plan de plus que les canaux de couleur est l'alpha
/// du composite, deux plans de plus sont une ambiguïté que l'entête ne lève pas.
fn header(bytes: &[u8]) -> std::result::Result<(Header, &[u8]), &'static str> {
    let head = bytes.get(..HEADER_BYTES).ok_or(HEADER_INVALID)?;
    if !head.starts_with(SIGNATURE) || head[6..12].iter().any(|byte| *byte != 0) {
        return Err(HEADER_INVALID);
    }
    let word = |at: usize| u16::from_be_bytes([head[at], head[at + 1]]);
    let long = |at: usize| u32::from_be_bytes([head[at], head[at + 1], head[at + 2], head[at + 3]]);
    let psb = match word(4) {
        VERSION_PSD => false,
        VERSION_PSB => true,
        _ => return Err(HEADER_INVALID),
    };
    let (channels, height, width) = (word(12), long(14), long(18));
    let max_side = if psb { MAX_SIDE_PSB } else { MAX_SIDE_PSD };
    let sides_valid = (1..=max_side).contains(&width) && (1..=max_side).contains(&height);
    if !sides_valid || !(1..=MAX_CHANNELS).contains(&channels) {
        return Err(HEADER_INVALID);
    }
    if word(22) != DEPTH_8 {
        return Err(DEPTH_UNSUPPORTED);
    }
    let color_channels = match word(24) {
        MODE_RGB => 3,
        MODE_GRAYSCALE => 1,
        _ => return Err(COLOR_MODE_UNSUPPORTED),
    };
    let channels = usize::from(channels);
    match channels.checked_sub(color_channels).ok_or(HEADER_INVALID)? {
        0 | 1 => {}
        _ => return Err(CHANNELS_UNSUPPORTED),
    }
    let header = Header {
        psb,
        width,
        height,
        channels,
        color_channels,
    };
    Ok((header, &bytes[HEADER_BYTES..]))
}
