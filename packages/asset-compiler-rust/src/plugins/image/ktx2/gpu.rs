//! GPU blocks from KTX2. Container supercompression is undone, texels are never expanded.
use super::{format, header, keys, level, DATA_TRUNCATED, TOO_LARGE, TRANSCODE_FAILED};
use crate::plugins::image::{gpu::budget, BlockLevel, CompressedImage};
use basisu::{DecodeFlags, TargetFormat, Transcoder};

fn native(format: u32) -> Option<(&'static str, u64)> {
    Some(match format {
        // BC1 RGB has different transparency semantics from WebGPU BC1 RGBA: use pixels.
        133 | 134 => ("bc1-rgba-unorm", 8),
        135 | 136 => ("bc2-rgba-unorm", 16),
        137 | 138 => ("bc3-rgba-unorm", 16),
        139 => ("bc4-r-unorm", 8),
        141 => ("bc5-rg-unorm", 16),
        145 | 146 => ("bc7-rgba-unorm", 16),
        147 | 148 => ("etc2-rgb8unorm", 8),
        149 | 150 => ("etc2-rgb8a1unorm", 8),
        151 | 152 => ("etc2-rgba8unorm", 16),
        153 => ("eac-r11unorm", 8),
        155 => ("eac-rg11unorm", 16),
        157 | 158 => ("astc-4x4-unorm", 16),
        _ => return None,
    })
}

pub(super) fn read(
    bytes: &[u8],
    max_alloc: u64,
    supported: &[&str],
) -> std::result::Result<Option<CompressedImage>, &'static str> {
    let mut surface = header::parse(bytes)?;
    let keys = keys::read(bytes);
    // Pixel changes cannot be applied to opaque compressed blocks without re-encoding.
    if surface.premultiplied
        || keys.get(keys::ORIENTATION).is_some_and(|v| *v != "rd")
        || keys.get(keys::SWIZZLE).is_some_and(|v| *v != "rgba")
    {
        return Ok(None);
    }
    let basis = surface.format == format::UNDEFINED;
    let target = [
        ("bc7-rgba-unorm", TargetFormat::Bc7Rgba),
        ("astc-4x4-unorm", TargetFormat::Astc4x4Rgba),
        ("etc2-rgba8unorm", TargetFormat::Etc2Rgba),
    ]
    .into_iter()
    .find(|(name, _)| supported.contains(name));
    let (name, block) = if basis {
        let Some((name, _)) = target else {
            return Ok(None);
        };
        (name, 16)
    } else {
        let Some(native) = native(surface.format) else {
            return Ok(None);
        };
        if !supported.contains(&native.0) {
            return Ok(None);
        }
        native
    };
    budget(
        surface.width,
        surface.height,
        surface.levels,
        block,
        max_alloc,
    )?;
    // Bound every decompressed container level before a Basis transcoder can inflate it.
    for rank in 0..surface.levels {
        if surface.supercompression == header::ZSTD
            && header::long(bytes, 80 + rank as usize * 24 + 16)? as u64 > max_alloc
        {
            return Err(TOO_LARGE);
        }
    }
    let transcoder = if basis {
        Some(Transcoder::new(bytes).map_err(|_| TRANSCODE_FAILED)?)
    } else {
        None
    };
    let (base_width, base_height) = (surface.width, surface.height);
    let mut levels = Vec::new();
    let mut retained = 0u64;
    for rank in 0..surface.levels {
        let width = (base_width >> rank.min(31)).max(1);
        let height = (base_height >> rank.min(31)).max(1);
        let needed = u64::from(width.div_ceil(4))
            .checked_mul(u64::from(height.div_ceil(4)))
            .and_then(|n| n.checked_mul(block))
            .ok_or(TOO_LARGE)?;
        let data = if let Some(transcoder) = &transcoder {
            transcoder
                .transcode(rank, target.unwrap().1, DecodeFlags::NONE)
                .map_err(|_| TRANSCODE_FAILED)?
        } else {
            let at = 80 + rank as usize * 24;
            let start = header::long(bytes, at)?;
            let length = header::long(bytes, at + 8)?;
            surface.level = start..start + length;
            surface.plain = header::long(bytes, at + 16)?;
            let plain = level::plain(&surface, bytes, needed, max_alloc - retained)?;
            if plain.len() as u64 != needed {
                return Err(DATA_TRUNCATED);
            }
            plain.into_owned()
        };
        if data.len() as u64 != needed {
            return Err(DATA_TRUNCATED);
        }
        retained += needed;
        levels.push(BlockLevel {
            width,
            height,
            data,
        });
    }
    Ok(Some(CompressedImage {
        format: name,
        transfer: surface.transfer,
        levels,
    }))
}
