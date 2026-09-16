//! Les profils colorimétriques que les fichiers portent, et que la sortie du contrat ne porte pas.
//!
//! `into_rgba8`, chez la caisse `image` comme chez le lecteur PSD, rend des octets que tout le reste
//! de la chaîne lit comme du sRGB. Un fichier peut pourtant embarquer un profil ICC qui dit une
//! autre chose : d'autres primaires, une autre courbe, un autre point blanc. Le convertir demanderait
//! une gestion de couleur complète, qui n'est pas ce lot ; le taire ferait passer une texture pour
//! ce qu'elle n'est pas.
//!
//! Ce module ne convertit donc rien. Il répond à une seule question — ce profil est-il autre chose
//! que le sRGB de la sortie ? — et rend la raison à compter quand la réponse est oui.
//!
//! **Comment un profil se nomme.** Un profil ICC porte sa description en clair dans son étiquette
//! `desc` ; chercher la suite ASCII « sRGB » dans ses octets suffit à reconnaître les profils sRGB,
//! qui la portent tous dans leur description. Un PNG, lui, compresse son profil mais en écrit le nom
//! en clair devant : c'est ce nom qu'on lit, et l'appelant passe ce qu'il a.
//!
//! Un faux positif — un profil d'un autre espace dont la description contiendrait « sRGB » — ne fait
//! que taire un compteur ; un faux négatif ne fait qu'en lever un de trop. Aucun des deux ne touche
//! un pixel.

/// Le fichier porte un profil colorimétrique que la sortie ne porte pas, et qu'aucune conversion ne
/// vient appliquer. Compté par texture, jamais tu, jamais un refus.
pub(super) const IGNORED: &str = "image-icc-profile-ignored";

/// La suite que tout profil sRGB porte dans sa description.
const SRGB: &[u8] = b"sRGB";
/// L'entête que la spécification de l'ICC impose aux segments APP2 d'un JPEG qui portent un profil.
const JPEG_MARKER: &[u8] = b"ICC_PROFILE\0";
/// Le premier octet de tout marqueur JPEG, et les deux marqueurs où le parcours des segments
/// s'arrête : le début des données entropiques, et la fin de l'image.
const MARKER: u8 = 0xff;
const START_OF_SCAN: u8 = 0xda;
const END_OF_IMAGE: u8 = 0xd9;
/// Le second segment d'application, celui où la spécification de l'ICC place le profil.
const APP2: u8 = 0xe2;
/// Les deux octets de la signature de début d'image, que le parcours saute.
const START_OF_IMAGE: usize = 2;
/// La longueur d'un segment, deux octets qui se comptent eux-mêmes.
const SEGMENT_LENGTH: usize = 2;

/// La raison à compter pour ces octets — le profil lui-même, ou le nom qu'un conteneur lui donne —
/// quand ils ne nomment pas le sRGB de la sortie.
pub(super) fn note(profile: &[u8]) -> Option<&'static str> {
    let named_srgb = profile.windows(SRGB.len()).any(|window| window == SRGB);
    (!named_srgb).then_some(IGNORED)
}

/// Le profil d'un JPEG, cherché dans ses segments. La spécification de l'ICC le transporte dans un
/// ou plusieurs APP2 dont la charge s'ouvre sur « ICC_PROFILE\0 », le numéro du morceau et leur
/// compte ; le premier morceau suffit, puisque la description y est. Le parcours s'arrête au début
/// des données entropiques : au-delà, les octets ne sont plus des segments.
pub(super) fn jpeg(bytes: &[u8]) -> Option<&'static str> {
    let mut at = START_OF_IMAGE;
    while let Some(&[MARKER, kind]) = bytes.get(at..at + 2) {
        if kind == START_OF_SCAN || kind == END_OF_IMAGE {
            return None;
        }
        let field: [u8; 2] = bytes.get(at + 2..at + 4)?.try_into().ok()?;
        let length = usize::from(u16::from_be_bytes(field));
        let payload = bytes.get(at + 2 + SEGMENT_LENGTH..at + 2 + length)?;
        if kind == APP2 {
            if let Some(profile) = payload.strip_prefix(JPEG_MARKER) {
                return note(profile);
            }
        }
        at += 2 + length;
    }
    None
}
