//! Pilote Radiance HDR (RGBE), lecteur écrit ici depuis la spécification publique du format :
//! « Real Pixels » de Greg Ward (Graphics Gems II, 1991), qui définit l'encodage RGBE et sa
//! compression par plages, et le manuel Radiance (Lawrence Berkeley National Laboratory), qui
//! définit l'entête, ses variables et sa ligne de résolution. Aucun SDK ni code d'éditeur, aucun
//! décodeur tiers : la caisse `image` ne reconnaît que la signature `#?RADIANCE` et ne laisse pas
//! nommer ce qu'elle refuse, deux choses que ce pilote doit faire.
//!
//! **On n'ajoute aucune perte.** Un RGBE porte trois mantisses de huit bits et un exposant commun ;
//! la mantisse multipliée par `2^(e - 136)` est exactement le flottant que le fichier décrit, et
//! `f32` le porte sans arrondi. Rien n'est ramené à huit bits, rien n'est reporté en tons — d'où la
//! variante `DecodedImage::RgbaF32`. L'alpha est opaque : le format n'en a pas.
//!
//! **Sous-ensemble accepté** : signature `#?RADIANCE` ou `#?RGBE`, `FORMAT=32-bit_rle_rgbe`
//! (absent, c'est le défaut de Radiance), résolution `-Y hauteur +X largeur`, lignes brutes,
//! compression par plages ancienne (marqueur `1,1,1,n`) comme nouvelle (entête `2,2,largeur`).
//! Refusés et nommés : `32-bit_rle_xyze`, qui est un autre espace de couleur, et toute autre
//! orientation que haut-en-bas gauche-à-droite, qui demanderait de retourner l'image.
use super::{float_budget, DecodedImage, ImageDecoder, Plugin};

mod scanlines;

pub(super) static HDR: Hdr = Hdr;
pub(super) struct Hdr;

/// Les deux signatures que le format porte en tête. `#?RADIANCE` est celle qu'écrivent les outils
/// d'aujourd'hui ; `#?RGBE` est celle des fichiers anciens et de plusieurs exporteurs.
const SIGNATURES: [&[u8]; 2] = [b"#?RADIANCE", b"#?RGBE"];
/// Le seul encodage de pixels de ce pilote. `32-bit_rle_xyze` décrit les mêmes octets dans l'espace
/// CIE XYZ : le convertir en RGB demanderait une matrice et un choix de primaires.
const FORMAT_RGBE: &str = "32-bit_rle_rgbe";
/// La variable d'entête qui nomme l'encodage.
const FORMAT_KEY: &str = "FORMAT=";
/// Plafond de l'entête, en lignes : un fichier qui n'annonce toujours pas sa résolution après cela
/// n'est pas un HDR, c'est un fichier texte que l'on refuse au lieu de le parcourir entier.
const MAX_HEADER_LINES: usize = 128;

/// Entête absent, tronqué, illisible ou sans ligne de résolution valide.
const HEADER_INVALID: &str = "hdr-header-invalid";
/// Un encodage de pixels hors du sous-ensemble : `32-bit_rle_xyze` aujourd'hui.
const FORMAT_UNSUPPORTED: &str = "hdr-format-unsupported";
/// Une orientation de balayage autre que `-Y … +X …`.
const ORIENTATION: &str = "hdr-orientation-unsupported";
/// L'image dépasse le plafond d'allocation reçu : un refus, jamais une allocation tentée.
const TOO_LARGE: &str = "hdr-image-too-large";

impl Plugin for Hdr {
    fn name(&self) -> &'static str {
        "hdr"
    }
    fn version(&self) -> &'static str {
        "hdr-radiance-rgbe-1"
    }
    /// `.hdr` est l'extension courante, `.rgbe` celle que posent quelques exporteurs, `.pic` celle
    /// des fichiers Radiance d'origine. L'extension ne fait que désigner le pilote : ce sont les
    /// octets qui décident, et un `.pic` d'un autre format ressort en format inconnu.
    fn extensions(&self) -> &'static [&'static str] {
        &["hdr", "rgbe", "pic"]
    }
}

impl ImageDecoder for Hdr {
    fn mime(&self) -> &'static str {
        "image/vnd.radiance"
    }
    fn accepts_head(&self, head: &[u8]) -> bool {
        SIGNATURES
            .iter()
            .any(|signature| head.starts_with(signature))
    }
    /// L'entête d'abord — il donne la taille, donc le plafond s'applique avant toute allocation —,
    /// puis les lignes de pixels, chacune dans l'une des trois écritures du format.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str> {
        let (width, height, body) = header(bytes)?;
        float_budget(width, height, max_alloc, TOO_LARGE)?;
        let data = scanlines::decode(body, width, height)?;
        Ok(DecodedImage::RgbaF32 {
            width,
            height,
            data,
        })
    }
}

/// L'entête : la signature, des lignes de variables et de commentaires, une ligne vide, puis la
/// ligne de résolution. Rend la taille et les octets qui suivent — les pixels et rien d'autre.
fn header(bytes: &[u8]) -> std::result::Result<(u32, u32, &[u8]), &'static str> {
    if !SIGNATURES
        .iter()
        .any(|signature| bytes.starts_with(signature))
    {
        return Err(HEADER_INVALID);
    }
    let mut rest = bytes;
    for _ in 0..MAX_HEADER_LINES {
        let (line, tail) = next_line(rest)?;
        rest = tail;
        if line.is_empty() {
            let (resolution, body) = next_line(rest)?;
            return size(resolution).map(|(width, height)| (width, height, body));
        }
        if let Some(value) = line.strip_prefix(FORMAT_KEY) {
            if value.trim() != FORMAT_RGBE {
                return Err(FORMAT_UNSUPPORTED);
            }
        }
    }
    Err(HEADER_INVALID)
}

/// Une ligne de l'entête, sans son saut de ligne, et ce qui la suit. L'entête est du texte : des
/// octets qui n'en sont pas ne sont pas un entête Radiance.
fn next_line(bytes: &[u8]) -> std::result::Result<(&str, &[u8]), &'static str> {
    let end = bytes
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or(HEADER_INVALID)?;
    let line = std::str::from_utf8(&bytes[..end]).map_err(|_| HEADER_INVALID)?;
    Ok((line.trim_end_matches('\r'), &bytes[end + 1..]))
}

/// La ligne de résolution. Seul `-Y hauteur +X largeur` est accepté : c'est le balayage haut-en-bas
/// gauche-à-droite, celui dans lequel le contrat range ses pixels. Les sept autres combinaisons de
/// signes et d'axes décrivent la même image écrite dans un autre sens ; les accepter voudrait dire
/// la retourner, et un pilote qui retourne en silence est un pilote dont on doute.
fn size(line: &str) -> std::result::Result<(u32, u32), &'static str> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    let [y_axis, height, x_axis, width] = fields[..] else {
        return Err(HEADER_INVALID);
    };
    if !matches!(y_axis, "-Y" | "+Y") || !matches!(x_axis, "+X" | "-X") {
        return Err(HEADER_INVALID);
    }
    if (y_axis, x_axis) != ("-Y", "+X") {
        return Err(ORIENTATION);
    }
    let height = height.parse::<u32>().map_err(|_| HEADER_INVALID)?;
    let width = width.parse::<u32>().map_err(|_| HEADER_INVALID)?;
    Ok((width, height))
}
