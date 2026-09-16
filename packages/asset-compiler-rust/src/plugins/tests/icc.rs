//! Les profils colorimétriques que les fichiers portent, et que la sortie du contrat ne porte pas.
//!
//! `into_rgba8` rend des octets que tout le reste de la chaîne lit comme du sRGB. Un fichier peut
//! pourtant embarquer un profil ICC qui dit autre chose, et le pilote le laissait tomber sans un
//! mot. Ce lot ne convertit rien — la gestion de couleur est un autre chantier — mais il compte.
//!
//! Les trois chemins par lesquels un profil arrive sont couverts ici : le morceau `iCCP` d'un PNG,
//! le segment APP2 d'un JPEG, et la ressource d'image 1039 d'un PSD.
use super::super::image as registry;
use super::{declared, fixture};
use std::path::PathBuf;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;
/// La raison que les trois chemins comptent.
const IGNORED: &str = "image-icc-profile-ignored";

/// La description d'un profil qui n'est pas celui de la sortie, et celle d'un profil sRGB.
const OTHER: &str = "Tirage papier";
const SRGB: &str = "sRGB IEC61966-2.1";

/// Les raisons nommées d'octets construits par le test.
fn notes(case: &str, bytes: &[u8]) -> Vec<&'static str> {
    registry::decode(bytes, MAX_ALLOC)
        .unwrap_or_else(|reason| panic!("{case} : {reason}"))
        .notes
}

// Reproduction du constat 58, chemin PNG : le morceau `iCCP` porte le nom du profil en clair, puis
// le profil compressé. Un nom qui n'est pas celui du sRGB de la sortie est compté ; le nom d'un
// profil sRGB ne compte rien, puisqu'il n'y aurait rien à convertir.
#[test]
fn le_profil_icc_dun_png_est_compte_sauf_sil_se_nomme_srgb() {
    assert_eq!(declared("png", "icc-autre.png", MAX_ALLOC).1, vec![IGNORED]);
    assert!(declared("png", "icc-srgb.png", MAX_ALLOC).1.is_empty());
    // Les deux fixtures portent le dessin de référence : un profil ne change aucun pixel ici.
    assert!(declared("png", "rgb8.png", MAX_ALLOC).1.is_empty());
}

// Reproduction du constat 58, chemin JPEG : la spécification de l'ICC transporte le profil dans des
// segments APP2 qui s'ouvrent sur « ICC_PROFILE\0 ». Le pilote les sautait tous.
#[test]
fn le_profil_icc_dun_jpeg_est_compte_sauf_sil_se_nomme_srgb() {
    let base = jpeg_sans_profil();
    assert!(notes("jpeg nu", &base).is_empty(), "aucun segment APP2");
    assert_eq!(notes("jpeg autre", &avec_app2(&base, OTHER)), vec![IGNORED]);
    assert!(notes("jpeg sRGB", &avec_app2(&base, SRGB)).is_empty());
}

// Reproduction du constat 58, chemin PSD : la ressource d'image 1039 porte le profil ICC du
// document. La section des ressources était sautée par sa longueur, sans qu'on y lise rien.
#[test]
fn le_profil_icc_dun_psd_est_compte_sauf_sil_se_nomme_srgb() {
    let base = fixture("psd", "rgb-brut.psd");
    assert!(notes("psd nu", &base).is_empty(), "aucune ressource");
    assert_eq!(
        notes("psd autre", &avec_ressource(&base, OTHER)),
        vec![IGNORED]
    );
    assert!(notes("psd sRGB", &avec_ressource(&base, SRGB)).is_empty());
}

/// Les octets d'un profil, réduits à ce que le pilote y lit : sa description. Un vrai profil la
/// porte dans son étiquette `desc`, entre son entête de cent vingt-huit octets et ses courbes ; rien
/// d'autre n'entre dans la décision, et le reste n'est pas écrit ici.
fn profil(description: &str) -> Vec<u8> {
    let mut out = Vec::from(*b"desc");
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&(description.len() as u32 + 1).to_be_bytes());
    out.extend_from_slice(description.as_bytes());
    out.push(0);
    out
}

/// Le JPEG de la dorée des aperçus, qui ne porte aucun segment APP2.
fn jpeg_sans_profil() -> Vec<u8> {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/apercus/atlas-couleur/lueur.jpg");
    std::fs::read(path).expect("lueur.jpg")
}

/// Le même JPEG, un segment APP2 porteur de profil inséré derrière sa signature de début d'image.
/// Un décodeur saute les segments d'application qu'il ne connaît pas : l'image reste la même.
fn avec_app2(base: &[u8], description: &str) -> Vec<u8> {
    let mut payload = Vec::from(*b"ICC_PROFILE\0");
    // Le numéro du morceau et leur compte : un seul morceau, qui porte tout le profil.
    payload.extend_from_slice(&[1, 1]);
    payload.extend_from_slice(&profil(description));
    let mut out = Vec::from(&base[..2]);
    out.extend_from_slice(&[0xff, 0xe2]);
    out.extend_from_slice(&(payload.len() as u16 + 2).to_be_bytes());
    out.extend_from_slice(&payload);
    out.extend_from_slice(&base[2..]);
    out
}

/// La fixture PSD, sa section de ressources vide remplacée par une section qui porte la ressource
/// 1039. Un bloc de ressource est la signature `8BIM`, l'identifiant sur deux octets, un nom Pascal
/// — vide ici, donc deux octets nuls —, la longueur des données, puis les données complétées jusqu'à
/// une longueur paire.
fn avec_ressource(base: &[u8], description: &str) -> Vec<u8> {
    let profil = profil(description);
    let mut block = Vec::from(*b"8BIM");
    block.extend_from_slice(&1039u16.to_be_bytes());
    block.extend_from_slice(&[0, 0]);
    block.extend_from_slice(&(profil.len() as u32).to_be_bytes());
    block.extend_from_slice(&profil);
    if block.len() % 2 != 0 {
        block.push(0);
    }
    let at = 26 + 4;
    let mut out = Vec::from(&base[..at]);
    out.extend_from_slice(&(block.len() as u32).to_be_bytes());
    out.extend_from_slice(&block);
    out.extend_from_slice(&base[at + 4..]);
    out
}
