//! Ce qu'un KTX 2.0 **déclare** autour de ses texels : la fonction de transfert de son descripteur
//! de format, et les clés de sa section clé-valeur. Le pilote ne les lisait pas du tout.
//!
//! Les conteneurs de ces cas sont écrits champ par champ par `bytes::described` : une seule charge
//! utile, et la déclaration seule qui change d'un cas à l'autre.
use super::super::super::image as registry;
use super::{bytes, MAX_ALLOC, RGBA8_SRGB, SIDE};

/// `KHR_DF_TRANSFER_LINEAR` et `KHR_DF_TRANSFER_SRGB`, les deux valeurs que le pilote reconnaît ;
/// zéro est `KHR_DF_TRANSFER_UNSPECIFIED`, que le fichier laisse indéterminé.
const LINEAR: u8 = 1;
const SRGB: u8 = 2;
const UNSPECIFIED: u8 = 0;
/// `VK_FORMAT_R8G8B8A8_UNORM`, le jumeau linéaire de `RGBA8_SRGB`.
const RGBA8_UNORM: u32 = 37;
/// Les seize texels d'un niveau RGBA8 de 4 × 4 : une charge utile quelconque, la même partout.
fn level() -> Vec<u8> {
    (0..64u16).map(|value| value as u8).collect()
}

/// Ce que ce conteneur déclare, et les octets de son image.
fn declared(case: &str, file: &[u8]) -> (registry::Transfer, Vec<&'static str>, Vec<u8>) {
    let decoded =
        registry::decode(file, MAX_ALLOC).unwrap_or_else(|reason| panic!("{case} : {reason}"));
    let (transfer, notes) = (decoded.transfer, decoded.notes.clone());
    (transfer, notes, super::super::rgba8(decoded).into_raw())
}

// Reproduction du constat 56, moitié KTX 2.0 : la même charge utile, son descripteur de format
// déclarant une fonction de transfert linéaire puis sRGB. Les texels sont les mêmes et la
// déclaration change ; le pilote prêtait auparavant le sRGB aux deux, si bien qu'une texture
// linéaire était relue comme si elle portait la courbe.
#[test]
fn le_meme_niveau_declare_lineaire_puis_srgb_rend_deux_transferts() {
    let level = level();
    let file =
        |transfer| bytes::described(RGBA8_SRGB, SIDE, SIDE, &level, 1, Some((transfer, 0)), &[]);
    let (linear, _, pixels) = declared("dfd linéaire", &file(LINEAR));
    let (srgb, _, same) = declared("dfd sRGB", &file(SRGB));
    assert_eq!(pixels, same, "le codec est le même, les octets aussi");
    assert_eq!(linear, registry::Transfer::Linear);
    assert_eq!(srgb, registry::Transfer::Srgb);
}

// Contrat du pilote : sans descripteur, ou quand celui-ci laisse la fonction de transfert
// indéterminée, c'est le `vkFormat` qui la nomme — le registre Vulkan publie chaque codec en
// `_UNORM` et en `_SRGB`. Hors de ces deux voies, la convention prête le sRGB.
#[test]
fn le_vkformat_nomme_le_transfert_quand_le_descripteur_se_tait() {
    let level = level();
    for (case, format, dfd, expected) in [
        (
            "sans descripteur, _SRGB",
            RGBA8_SRGB,
            None,
            registry::Transfer::Srgb,
        ),
        (
            "sans descripteur, _UNORM",
            RGBA8_UNORM,
            None,
            registry::Transfer::Linear,
        ),
        (
            "descripteur muet, _UNORM",
            RGBA8_UNORM,
            Some((UNSPECIFIED, 0)),
            registry::Transfer::Linear,
        ),
    ] {
        let file = bytes::described(format, SIDE, SIDE, &level, 1, dfd, &[]);
        assert_eq!(declared(case, &file).0, expected, "{case}");
    }
}

/// `KHR_DF_FLAG_ALPHA_PREMULTIPLIED`, le premier bit des drapeaux du bloc de base.
const PREMULTIPLIED: u8 = 1;

/// Un niveau RGBA8 de 4 × 4 dont chaque ligne porte une valeur différente : de quoi voir un
/// retournement vertical. `line` donne le quadruplet de la ligne.
fn rows(line: impl Fn(usize) -> [u8; 4]) -> Vec<u8> {
    (0..4).flat_map(|row| line(row).repeat(4)).collect()
}

// Reproduction du constat 57 : le descripteur de format lève le drapeau d'alpha prémultiplié, et le
// contrat de sortie demande un alpha droit. Le pilote ne lisait pas ce drapeau : les couleurs déjà
// multipliées par leur alpha sortaient telles quelles, puis l'aperçu les prémultipliait une
// seconde fois. Chaque composante est désormais divisée par l'alpha du texel, sans diviser par zéro.
#[test]
fn le_drapeau_premultiplie_du_descripteur_ramene_lalpha_a_droit() {
    // Ligne 0 : un demi-gris prémultiplié à mi-alpha, qui vaut un blanc droit. Ligne 1 : un noir,
    // qui reste noir. Ligne 2 : un alpha nul, sous lequel il n'y a pas de couleur droite à
    // retrouver. Ligne 3 : un texel opaque, que la division laisse exactement tel quel.
    let level = rows(|row| match row {
        0 => [128, 128, 128, 128],
        1 => [0, 0, 0, 128],
        2 => [10, 20, 30, 0],
        _ => [7, 8, 9, 255],
    });
    let file = bytes::described(
        RGBA8_SRGB,
        SIDE,
        SIDE,
        &level,
        1,
        Some((SRGB, PREMULTIPLIED)),
        &[],
    );
    let attendu = rows(|row| match row {
        0 => [255, 255, 255, 128],
        1 => [0, 0, 0, 128],
        2 => [10, 20, 30, 0],
        _ => [7, 8, 9, 255],
    });
    let (_, notes, pixels) = declared("prémultiplié", &file);
    assert_eq!(pixels, attendu);
    assert!(notes.is_empty(), "le drapeau est appliqué, pas compté");
    // Sans le drapeau, les mêmes octets sortent tels quels : c'est bien lui qui décide.
    let droit = bytes::described(RGBA8_SRGB, SIDE, SIDE, &level, 1, Some((SRGB, 0)), &[]);
    assert_eq!(declared("droit", &droit).2, level);
}

// Reproduction du constat 57, seconde moitié : les clés `KTXorientation` et `KTXswizzle` étaient
// ignorées sans un mot. L'orientation par défaut du format est `rd` — vers la droite, vers le bas —,
// celle du contrat ; `ru` demande un retournement vertical, que le pilote applique. Tout le reste
// est compté par son nom, jamais appliqué de travers.
#[test]
fn les_cles_dorientation_et_de_permutation_sont_appliquees_ou_comptees() {
    let level = rows(|row| [row as u8 * 10, 0, 0, 255]);
    let file =
        |keys: &[(&str, &str)]| bytes::described(RGBA8_SRGB, SIDE, SIDE, &level, 1, None, keys);
    // `rd` est l'orientation du contrat : rien ne bouge, rien n'est compté.
    let (_, notes, pixels) = declared("rd", &file(&[("KTXorientation", "rd")]));
    assert_eq!(pixels, level);
    assert!(notes.is_empty());
    // `ru` écrit ses lignes du bas vers le haut : le pilote les remet dans l'ordre du contrat.
    let (_, notes, pixels) = declared("ru", &file(&[("KTXorientation", "ru")]));
    assert_eq!(pixels, rows(|row| [(3 - row) as u8 * 10, 0, 0, 255]));
    assert!(
        notes.is_empty(),
        "un retournement s'applique, il ne se compte pas"
    );
    // Une orientation qui part vers la gauche demanderait un retournement horizontal que le pilote
    // ne déclare pas : elle est comptée, et les texels restent où le fichier les a mis.
    let (_, notes, pixels) = declared("lu", &file(&[("KTXorientation", "lu")]));
    assert_eq!(pixels, level);
    assert_eq!(notes, vec!["ktx2-orientation-unsupported"]);
    // Une permutation de canaux autre que l'identité est comptée de la même façon.
    let (_, notes, pixels) = declared("bgra", &file(&[("KTXswizzle", "bgra")]));
    assert_eq!(pixels, level);
    assert_eq!(notes, vec!["ktx2-swizzle-unsupported"]);
    // `rgba` est l'identité : elle ne compte rien.
    assert!(declared("rgba", &file(&[("KTXswizzle", "rgba")]))
        .1
        .is_empty());
}
