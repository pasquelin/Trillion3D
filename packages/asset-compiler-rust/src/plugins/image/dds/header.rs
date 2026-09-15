//! L'entête DDS et son extension DX10, lus champ par champ depuis la spécification publique de
//! Microsoft. Les décalages sont ceux des structures `DDS_HEADER` (124 octets après le nombre
//! magique), `DDS_PIXELFORMAT` (32 octets à l'intérieur) et `DDS_HEADER_DXT10` (20 octets de plus).
//!
//! Ce module ne lit aucun pixel : il rend la surface — codec, dimensions, nombre de niveaux et
//! offset du niveau 0 — ou un refus nommé. Il vérifie aussi que la chaîne de mips annoncée tient
//! dans le fichier : un DDS qui promet neuf niveaux et n'en porte que deux est tronqué.
use super::codec::{self, Codec};
use super::{
    CODEC_UNSUPPORTED, DATA_TRUNCATED, HEADER_INVALID, HEADER_TRUNCATED, LAYOUT_UNSUPPORTED, MAGIC,
};
use crate::plugins::image::MAX_LEVELS;

/// Fin de `DDS_HEADER` : quatre octets de nombre magique et cent vingt-quatre d'entête.
const HEADER_END: usize = 128;
/// Fin de `DDS_HEADER_DXT10`, quand le `dwFourCC` vaut `DX10`.
const DX10_END: usize = HEADER_END + 20;
/// Taille qu'annoncent les deux structures. Une autre valeur n'est pas un DDS que l'on sait lire.
const HEADER_SIZE: u32 = 124;
const PIXEL_FORMAT_SIZE: u32 = 32;
/// `DDSD_PITCH` : `dwPitchOrLinearSize` porte alors le pas de ligne en octets.
const DDSD_PITCH: u32 = 0x8;
/// `DDPF_FOURCC` et `DDPF_RGB` : les deux façons dont `DDS_PIXELFORMAT` nomme son contenu.
const DDPF_FOURCC: u32 = 0x4;
const DDPF_RGB: u32 = 0x40;
/// `DDSCAPS2_CUBEMAP` et `DDSCAPS2_VOLUME` : des dispositions que ce pilote ne déclare pas.
const DDSCAPS2_CUBEMAP: u32 = 0x200;
const DDSCAPS2_VOLUME: u32 = 0x0020_0000;
/// `D3D10_RESOURCE_DIMENSION_TEXTURE2D` : la seule dimension de ressource déclarée.
const TEXTURE_2D: u32 = 3;
/// `DDS_RESOURCE_MISC_TEXTURECUBE`, et le masque d'alpha de `miscFlags2` avec sa valeur
/// `DDS_ALPHA_MODE_PREMULTIPLIED` : le contrat d'image demande un alpha droit.
const MISC_TEXTURECUBE: u32 = 0x4;
const ALPHA_MODE_MASK: u32 = 0x7;
const ALPHA_MODE_PREMULTIPLIED: u32 = 2;

/// La surface que le pilote va lire : son codec, sa taille, sa chaîne et où commence le niveau 0.
pub(super) struct Surface {
    pub(super) codec: Codec,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) data: usize,
}

/// Le mot de trente-deux bits à ce décalage, petit-boutien comme tout le format.
fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// La dimension d'un niveau de mip : chaque niveau divise par deux et s'arrête à un pixel.
fn level_size(size: u32, level: u32) -> u32 {
    (size >> level.min(31)).max(1)
}

pub(super) fn parse(bytes: &[u8]) -> std::result::Result<Surface, &'static str> {
    if bytes.len() < HEADER_END {
        return Err(HEADER_TRUNCATED);
    }
    if !bytes.starts_with(MAGIC) {
        return Err(HEADER_INVALID);
    }
    if word(bytes, 4) != HEADER_SIZE || word(bytes, 76) != PIXEL_FORMAT_SIZE {
        return Err(HEADER_INVALID);
    }
    let (height, width) = (word(bytes, 12), word(bytes, 16));
    let levels = word(bytes, 28).max(1);
    if width == 0 || height == 0 || levels > MAX_LEVELS {
        return Err(HEADER_INVALID);
    }
    // Profondeur, cube et volume : le pilote ne déclare que la surface plane unique.
    if word(bytes, 24) > 1 || word(bytes, 112) & (DDSCAPS2_CUBEMAP | DDSCAPS2_VOLUME) != 0 {
        return Err(LAYOUT_UNSUPPORTED);
    }
    let flags = word(bytes, 80);
    let mut data = HEADER_END;
    let codec = if flags & DDPF_FOURCC != 0 {
        let fourcc: [u8; 4] = bytes[84..88].try_into().unwrap_or([0; 4]);
        if &fourcc == b"DX10" {
            data = DX10_END;
            dx10(bytes)?
        } else {
            codec::from_fourcc(fourcc).ok_or(CODEC_UNSUPPORTED)?
        }
    } else if flags & DDPF_RGB != 0 {
        let masks = [
            word(bytes, 92),
            word(bytes, 96),
            word(bytes, 100),
            word(bytes, 104),
        ];
        codec::from_masks(word(bytes, 88), masks).ok_or(CODEC_UNSUPPORTED)?
    } else {
        return Err(CODEC_UNSUPPORTED);
    };
    // Un pas de ligne rembourré décalerait chaque ligne : on le refuse au lieu de rendre du bruit.
    if codec.is_uncompressed()
        && word(bytes, 8) & DDSD_PITCH != 0
        && u64::from(word(bytes, 20)) != u64::from(width) * 4
    {
        return Err(LAYOUT_UNSUPPORTED);
    }
    chain_fits(codec, width, height, levels, bytes.len() - data)?;
    Ok(Surface {
        codec,
        width,
        height,
        data,
    })
}

/// L'entête DX10 : dimension de ressource, tableau, cube et mode d'alpha, puis le `dxgiFormat`.
fn dx10(bytes: &[u8]) -> std::result::Result<Codec, &'static str> {
    if bytes.len() < DX10_END {
        return Err(HEADER_TRUNCATED);
    }
    if word(bytes, 132) != TEXTURE_2D
        || word(bytes, 136) & MISC_TEXTURECUBE != 0
        || word(bytes, 140) > 1
    {
        return Err(LAYOUT_UNSUPPORTED);
    }
    if word(bytes, 144) & ALPHA_MODE_MASK == ALPHA_MODE_PREMULTIPLIED {
        return Err(CODEC_UNSUPPORTED);
    }
    codec::from_dxgi(word(bytes, 128)).ok_or(CODEC_UNSUPPORTED)
}

/// La chaîne annoncée doit tenir dans ce qui reste du fichier. C'est le seul usage du nombre de
/// niveaux : on ne lit que le niveau 0, mais on refuse de le lire dans un fichier qui ment.
fn chain_fits(
    codec: Codec,
    width: u32,
    height: u32,
    levels: u32,
    available: usize,
) -> std::result::Result<(), &'static str> {
    let needed = (0..levels)
        .map(|level| codec.level_bytes(level_size(width, level), level_size(height, level)))
        .fold(0u64, u64::saturating_add);
    if needed <= available as u64 {
        Ok(())
    } else {
        Err(DATA_TRUNCATED)
    }
}
