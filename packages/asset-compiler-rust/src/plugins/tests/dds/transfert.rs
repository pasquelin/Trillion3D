//! La fonction de transfert qu'un DDS déclare, et qui ne change pas un octet de ses blocs.
//!
//! L'énumération `DXGI_FORMAT` publie chaque codec en deux variantes, `_UNORM` et `_UNORM_SRGB`.
//! Elles portent exactement les mêmes octets et ne veulent pas dire la même chose : la première
//! annonce des échantillons proportionnels à la lumière, la seconde des octets encodés par la
//! courbe sRGB. Les confondre éclaircit ou assombrit toute la texture chez le consommateur.
//!
//! Un DDS hérité — codec nommé par son `dwFourCC`, ou surface décrite par ses masques — ne déclare
//! rien : Direct3D 9 n'avait pas de format sRGB. La convention lui prête le sRGB, et c'est dit ici.
use super::super::super::image as registry;
use super::{bytes, MAX_ALLOC, SIDE};

/// `DXGI_FORMAT_BC1_UNORM` et `DXGI_FORMAT_BC1_UNORM_SRGB`, les deux noms du même bloc.
const BC1_UNORM: u32 = 71;
const BC1_SRGB: u32 = 72;

/// Le transfert déclaré par ce conteneur, et les octets de son image.
fn declared(case: &str, file: &[u8]) -> (registry::Transfer, Vec<u8>) {
    let decoded =
        registry::decode(file, MAX_ALLOC).unwrap_or_else(|reason| panic!("{case} : {reason}"));
    let transfer = decoded.transfer;
    (transfer, super::super::rgba8(decoded).into_raw())
}

// Reproduction du constat 56, moitié DDS : la même charge utile déclarée `_UNORM` puis `_SRGB`. Les
// pixels sont les mêmes — le codec ne change pas —, et la fonction de transfert que le pilote rend
// change avec la déclaration. Le pilote la prêtait auparavant au sRGB dans les deux cas, si bien
// qu'une texture linéaire était relue comme si elle portait la courbe sRGB.
#[test]
fn le_meme_bloc_declare_unorm_puis_srgb_rend_deux_transferts() {
    let block = vec![0x1f, 0x00, 0x00, 0xf8, 0x1b, 0x1b, 0x1b, 0x1b];
    let (linear, pixels) = declared("bc1 unorm", &bytes::dx10(BC1_UNORM, SIDE, SIDE, &block));
    let (srgb, same) = declared("bc1 srgb", &bytes::dx10(BC1_SRGB, SIDE, SIDE, &block));
    assert_eq!(pixels, same, "le codec est le même, les octets aussi");
    assert_eq!(linear, registry::Transfer::Linear, "`_UNORM`");
    assert_eq!(srgb, registry::Transfer::Srgb, "`_UNORM_SRGB`");
}

// Contrat du pilote : un DDS hérité ne déclare aucun transfert, et la convention lui prête le sRGB.
// C'est un choix nommé, pas un oubli : Direct3D 9 n'avait pas de format sRGB, et une texture de
// couleur écrite à cette époque est encodée par cette courbe.
#[test]
fn un_dds_herite_ne_declare_rien_et_garde_le_srgb_de_convention() {
    let block = vec![0x1f, 0x00, 0x00, 0xf8, 0x1b, 0x1b, 0x1b, 0x1b];
    let fourcc = bytes::container(bytes::fourcc_format(b"DXT1"), SIDE, SIDE, 1, &block);
    assert_eq!(declared("dxt1", &fourcc).0, registry::Transfer::Srgb);
    let masks = bytes::mask_format(32, [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000]);
    let surface = bytes::container(masks, 1, 1, 1, &[1, 2, 3, 4]);
    assert_eq!(declared("bgra8", &surface).0, registry::Transfer::Srgb);
}
