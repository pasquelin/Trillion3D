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
//! compte l'animation plutôt que de laisser les autres trames disparaître sans un mot. Un morceau
//! `iCCP` porte un profil colorimétrique que la sortie ne porte pas : son nom, écrit en clair devant
//! le profil compressé, suffit à dire s'il s'agit du sRGB de la sortie ou d'autre chose à compter.
use super::{crate_image, icc, ImageDecoded, ImageDecoder, Plugin, Transfer};

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
/// Le morceau qui porte un profil colorimétrique : son nom en clair, un octet de méthode de
/// compression, puis le profil compressé. Seul le nom se lit sans décompresser quoi que ce soit.
const PROFILE_CHUNK: &[u8] = b"iCCP";
/// Le morceau qui déclare la sortie écrite dans l'espace sRGB, et l'intention de rendu avec.
const SRGB_CHUNK: &[u8] = b"sRGB";
/// Le morceau qui déclare la gamma du fichier, multipliée par cent mille sur quatre octets.
const GAMMA_CHUNK: &[u8] = b"gAMA";
/// La gamma d'une image écrite dans la courbe sRGB : 1/2,2, que la spécification arrondit ainsi.
const SRGB_GAMMA: u32 = 45_455;
/// La gamma d'une image dont les échantillons sont proportionnels à la lumière : 1 exactement.
const LINEAR_GAMMA: u32 = 100_000;
/// Une gamma qui n'est ni celle de la courbe sRGB ni l'unité. Le contrat porte deux courbes et ne
/// sait pas en appliquer une troisième : l'image sort traitée en sRGB, comme le veut la convention
/// pour un fichier qui se tait, et l'écart est compté plutôt que passé sous silence.
const TRANSFER: &str = "image-transfer-unsupported";

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
        "png-image-0.25-depth8-apng-icc-gama"
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
        let (transfer, notes) = declarations(bytes);
        Ok(decoded.with_transfer(transfer).with_notes(notes))
    }
}

/// La courbe que le fichier déclare, et ce qu'il déclare d'autre que la sortie ne porte pas. Le
/// parcours s'arrête au premier morceau coupé : un fichier tronqué est jugé par le décodeur de
/// pixels, pas deviné ici.
///
/// La priorité est celle du format, du plus précis au plus vague : un profil `iCCP` décrit la
/// courbe lui-même, un morceau `sRGB` la nomme, et `gAMA` seul ne dit qu'une gamma. Les deux
/// premiers laissent donc la sortie en sRGB — le profil est déjà compté comme non converti —, et
/// c'est faute d'eux que la gamma décide.
fn declarations(bytes: &[u8]) -> (Transfer, Vec<&'static str>) {
    let mut notes = Vec::new();
    let mut described = false;
    let mut gamma = None;
    for (kind, data) in chunks::of(bytes) {
        match kind {
            ANIMATION_CHUNK => notes.push(ANIMATION),
            PROFILE_CHUNK => {
                described = true;
                notes.extend(icc::note(name(data)));
            }
            SRGB_CHUNK => described = true,
            GAMMA_CHUNK => {
                gamma = data
                    .get(..4)
                    .map(|value| u32::from_be_bytes([value[0], value[1], value[2], value[3]]));
            }
            _ => {}
        }
    }
    match gamma.filter(|_| !described) {
        Some(LINEAR_GAMMA) => (Transfer::Linear, notes),
        Some(SRGB_GAMMA) | None => (Transfer::Srgb, notes),
        Some(_) => {
            notes.push(TRANSFER);
            (Transfer::Srgb, notes)
        }
    }
}

/// Le nom d'un profil, la partie du morceau `iCCP` qui précède le premier octet nul. Le profil
/// lui-même est compressé : son nom est tout ce que ce pilote lit, et c'est ce que la spécification
/// lui demande d'écrire en clair.
fn name(chunk: &[u8]) -> &[u8] {
    let end = chunk.iter().position(|byte| *byte == 0);
    &chunk[..end.unwrap_or(chunk.len())]
}
