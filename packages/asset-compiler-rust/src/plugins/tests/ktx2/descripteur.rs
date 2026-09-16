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
