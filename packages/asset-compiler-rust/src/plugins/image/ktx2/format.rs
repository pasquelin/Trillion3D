//! Les `vkFormat` que le pilote `ktx2` déclare, un par un, et rien d'autre.
//!
//! Un KTX 2.0 nomme son codec par la valeur `VkFormat` de Vulkan, sauf quand il porte une charge
//! Basis Universal : il écrit alors `VK_FORMAT_UNDEFINED` et laisse son descripteur de format dire
//! ce qu'il contient. Les numéros ci-dessous sont ceux du registre Vulkan, cités en commentaire ;
//! tout ce qui n'est pas dans la liste rend `None`, et c'est l'appelant qui en fait un refus nommé.
//!
//! Hors liste, exprès : les variantes signées (BC4, BC5, EAC), BC6H et ses flottants, tous les
//! `VkFormat` de plus de huit bits par canal, les ordres d'octets autres que R, G, B, A, et les
//! treize empreintes ASTC autres que 4 × 4 — la reconstruction par rangée de quatre lignes de
//! `image::blocks` ne sait promener que des blocs de quatre pixels de haut.
use crate::plugins::image::blocks::BlockDecode;
use texture2ddecoder::{
    decode_astc, decode_bc1, decode_bc1a, decode_bc2, decode_bc3, decode_bc4, decode_bc5,
    decode_bc7, decode_eacr, decode_eacrg, decode_etc2_rgb, decode_etc2_rgba1, decode_etc2_rgba8,
};

/// `VK_FORMAT_UNDEFINED` : le conteneur porte une charge Basis Universal.
pub(super) const UNDEFINED: u32 = 0;

/// Comment les octets d'un niveau deviennent des pixels. C'est la seule description d'un codec :
/// le poids d'un niveau et sa reconstruction en dérivent toutes les deux.
pub(super) enum Layout {
    /// Des blocs de 4 × 4 texels : les octets d'un bloc et le décodeur qui les développe.
    Blocks { bytes: usize, decode: BlockDecode },
    /// Non compressé, quatre octets par texel, déjà dans l'ordre R, G, B, A du contrat.
    Rgba8,
}

impl Layout {
    /// Les octets qu'occupe un niveau de cette taille. Les blocs couvrent toujours des multiples de
    /// quatre texels : un niveau de 1 × 1 pèse encore un bloc entier. Le compte sature plutôt que
    /// de déborder : des dimensions absurdes donnent un besoin absurde, donc un refus.
    pub(super) fn level_bytes(&self, width: u32, height: u32) -> u64 {
        match self {
            Layout::Blocks { bytes, .. } => u64::from(width.div_ceil(4))
                .saturating_mul(u64::from(height.div_ceil(4)))
                .saturating_mul(*bytes as u64),
            Layout::Rgba8 => u64::from(width)
                .saturating_mul(u64::from(height))
                .saturating_mul(4),
        }
    }
}

/// La disposition de ce `vkFormat` : la seule table qui relie un format déclaré à ses octets. Les
/// variantes `_SRGB` portent les mêmes octets que leurs `_UNORM` — le contrat d'image est déjà sRGB.
pub(super) fn layout(format: u32) -> Option<Layout> {
    let blocks = |bytes, decode: BlockDecode| Layout::Blocks { bytes, decode };
    Some(match format {
        // R8G8B8A8_UNORM, R8G8B8A8_SRGB
        37 | 43 => Layout::Rgba8,
        // BC1_RGB_UNORM_BLOCK, BC1_RGB_SRGB_BLOCK : le bit d'alpha du bloc ne code qu'un noir,
        // la surface est opaque.
        131 | 132 => blocks(8, decode_bc1),
        // BC1_RGBA_UNORM_BLOCK, BC1_RGBA_SRGB_BLOCK : le même bloc, alpha d'un bit honoré.
        133 | 134 => blocks(8, decode_bc1a),
        // BC2_UNORM_BLOCK, BC2_SRGB_BLOCK
        135 | 136 => blocks(16, decode_bc2),
        // BC3_UNORM_BLOCK, BC3_SRGB_BLOCK
        137 | 138 => blocks(16, decode_bc3),
        // BC4_UNORM_BLOCK
        139 => blocks(8, decode_bc4),
        // BC5_UNORM_BLOCK
        141 => blocks(16, decode_bc5),
        // BC7_UNORM_BLOCK, BC7_SRGB_BLOCK
        145 | 146 => blocks(16, decode_bc7),
        // ETC2_R8G8B8_UNORM_BLOCK, ETC2_R8G8B8_SRGB_BLOCK
        147 | 148 => blocks(8, decode_etc2_rgb),
        // ETC2_R8G8B8A1_UNORM_BLOCK, ETC2_R8G8B8A1_SRGB_BLOCK
        149 | 150 => blocks(8, decode_etc2_rgba1),
        // ETC2_R8G8B8A8_UNORM_BLOCK, ETC2_R8G8B8A8_SRGB_BLOCK
        151 | 152 => blocks(16, decode_etc2_rgba8),
        // EAC_R11_UNORM_BLOCK
        153 => blocks(8, decode_eacr),
        // EAC_R11G11_UNORM_BLOCK
        155 => blocks(16, decode_eacrg),
        // ASTC_4x4_UNORM_BLOCK, ASTC_4x4_SRGB_BLOCK
        157 | 158 => blocks(16, astc_4x4),
        _ => return None,
    })
}

/// ASTC ne se nomme pas par une fonction de la forme attendue : son décodeur reçoit en plus la
/// géométrie du bloc, que le format n'a pas fixée. Ce court relais la fixe à 4 × 4, la seule
/// empreinte déclarée.
fn astc_4x4(
    level: &[u8],
    width: usize,
    height: usize,
    image: &mut [u32],
) -> Result<(), &'static str> {
    decode_astc(level, width, height, 4, 4, image)
}
