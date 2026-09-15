//! Les codecs que le pilote `dds` déclare, un par un, et rien d'autre.
//!
//! Un DDS nomme son codec de trois façons, toutes documentées par Microsoft : le `dwFourCC` hérité
//! de Direct3D 9, le `dxgiFormat` de l'entête DX10, ou — pour une surface non compressée — ses
//! masques de bits. Les trois chemins arrivent ici et rendent `None` pour tout ce qui n'est pas
//! dans la liste : c'est l'appelant qui en fait un refus nommé.
use crate::plugins::image::blocks::BlockDecode;
use texture2ddecoder::{decode_bc1a, decode_bc2, decode_bc3, decode_bc4, decode_bc5, decode_bc7};

/// Les codecs déclarés. Rien ici n'est « deviné » : chaque variante a été inscrite exprès, avec
/// les identifiants de format qui y mènent.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Codec {
    /// BC1 (`DXT1`) : couleurs 565 interpolées, alpha d'un bit.
    Bc1,
    /// BC2 (`DXT3`) : couleurs BC1 et alpha explicite de quatre bits.
    Bc2,
    /// BC3 (`DXT5`) : couleurs BC1 et alpha interpolé de trois bits.
    Bc3,
    /// BC4 : un seul canal interpolé, rendu en rouge.
    Bc4,
    /// BC5 : deux canaux interpolés, rendus en rouge et vert — les normales tangentes.
    Bc5,
    /// BC7 : les huit modes de partitionnement, couleurs et alpha ensemble.
    Bc7,
    /// Non compressé, octets dans l'ordre R, G, B, A.
    Rgba8,
    /// Non compressé, octets dans l'ordre B, G, R, A — l'ordre natif de Direct3D 9.
    Bgra8,
    /// Non compressé, octets B, G, R puis un octet ignoré : la surface est opaque.
    Bgrx8,
}

/// Comment les octets d'un niveau deviennent des pixels. C'est la seule description d'un codec :
/// le poids d'un niveau, sa lecture et sa reconstruction en dérivent toutes.
#[derive(Clone, Copy)]
pub(super) enum Layout {
    /// Des blocs de 4 × 4 pixels : les octets d'un bloc et le décodeur qui les développe.
    Blocks { bytes: u8, decode: BlockDecode },
    /// Une surface non compressée, quatre octets par pixel dans l'ordre nommé.
    Pixels(Order),
}

/// L'ordre des quatre octets d'un pixel non compressé.
#[derive(Clone, Copy)]
pub(super) enum Order {
    /// R, G, B, A : déjà l'ordre du contrat.
    Rgba,
    /// B, G, R, A.
    Bgra,
    /// B, G, R puis un octet ignoré par la spécification : la surface est opaque.
    Bgrx,
}

impl Codec {
    /// La disposition de ce codec : la seule table qui relie un codec déclaré à ses octets.
    pub(super) fn layout(self) -> Layout {
        let blocks = |bytes, decode: BlockDecode| Layout::Blocks { bytes, decode };
        match self {
            Codec::Bc1 => blocks(8, decode_bc1a),
            Codec::Bc2 => blocks(16, decode_bc2),
            Codec::Bc3 => blocks(16, decode_bc3),
            Codec::Bc4 => blocks(8, decode_bc4),
            Codec::Bc5 => blocks(16, decode_bc5),
            Codec::Bc7 => blocks(16, decode_bc7),
            Codec::Rgba8 => Layout::Pixels(Order::Rgba),
            Codec::Bgra8 => Layout::Pixels(Order::Bgra),
            Codec::Bgrx8 => Layout::Pixels(Order::Bgrx),
        }
    }

    /// Une surface non compressée se lit ligne par ligne, quatre octets par pixel.
    pub(super) fn is_uncompressed(self) -> bool {
        matches!(self.layout(), Layout::Pixels(_))
    }

    /// Les octets qu'occupe un niveau de cette taille. Les blocs couvrent toujours des multiples
    /// de quatre pixels : un niveau de 1 × 1 pèse encore un bloc entier. Le compte sature plutôt
    /// que de déborder : des dimensions absurdes donnent un besoin absurde, donc un refus.
    pub(super) fn level_bytes(self, width: u32, height: u32) -> u64 {
        match self.layout() {
            Layout::Blocks { bytes, .. } => u64::from(width.div_ceil(4))
                .saturating_mul(u64::from(height.div_ceil(4)))
                .saturating_mul(u64::from(bytes)),
            Layout::Pixels(_) => u64::from(width)
                .saturating_mul(u64::from(height))
                .saturating_mul(4),
        }
    }
}

/// Le codec d'un `dwFourCC` de Direct3D 9. `DXT2` et `DXT4` portent les mêmes blocs que `DXT3` et
/// `DXT5` mais un alpha prémultiplié : le contrat d'image demande un alpha droit, donc ils sont
/// refusés plutôt que rendus faux. `BC4S` et `BC5S` sont signés, hors liste eux aussi.
pub(super) fn from_fourcc(fourcc: [u8; 4]) -> Option<Codec> {
    Some(match &fourcc {
        b"DXT1" => Codec::Bc1,
        b"DXT3" => Codec::Bc2,
        b"DXT5" => Codec::Bc3,
        b"ATI1" | b"BC4U" => Codec::Bc4,
        b"ATI2" | b"BC5U" => Codec::Bc5,
        _ => return None,
    })
}

/// Le codec d'un `dxgiFormat` de l'entête DX10, par les valeurs de l'énumération `DXGI_FORMAT`.
/// Les variantes `_SRGB` portent les mêmes octets que leurs `_UNORM` — le contrat d'image est déjà
/// sRGB —, les `_TYPELESS` ne déclarent pas leur interprétation et les signées, les flottantes
/// (BC6H), les 16 bits et les YUV sortent de la liste.
pub(super) fn from_dxgi(format: u32) -> Option<Codec> {
    Some(match format {
        // R8G8B8A8_UNORM, R8G8B8A8_UNORM_SRGB
        28 | 29 => Codec::Rgba8,
        // BC1_UNORM, BC1_UNORM_SRGB
        71 | 72 => Codec::Bc1,
        // BC2_UNORM, BC2_UNORM_SRGB
        74 | 75 => Codec::Bc2,
        // BC3_UNORM, BC3_UNORM_SRGB
        77 | 78 => Codec::Bc3,
        // BC4_UNORM
        80 => Codec::Bc4,
        // BC5_UNORM
        83 => Codec::Bc5,
        // B8G8R8A8_UNORM, B8G8R8A8_UNORM_SRGB
        87 | 91 => Codec::Bgra8,
        // B8G8R8X8_UNORM, B8G8R8X8_UNORM_SRGB
        88 | 93 => Codec::Bgrx8,
        // BC7_UNORM, BC7_UNORM_SRGB
        98 | 99 => Codec::Bc7,
        _ => return None,
    })
}

/// Le codec d'une surface non compressée, par ses masques `dwRBitMask`, `dwGBitMask`,
/// `dwBBitMask` et `dwABitMask`. Seuls les trois profils de trente-deux bits déclarés sont lus :
/// un masque inattendu — 16 bits, 24 bits, canaux décalés — est hors liste.
pub(super) fn from_masks(bit_count: u32, masks: [u32; 4]) -> Option<Codec> {
    if bit_count != 32 {
        return None;
    }
    Some(match masks {
        [0x0000_00ff, 0x0000_ff00, 0x00ff_0000, 0xff00_0000] => Codec::Rgba8,
        [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000] => Codec::Bgra8,
        [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0] => Codec::Bgrx8,
        _ => return None,
    })
}
