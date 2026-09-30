//! Native DDS levels copied without reconstructing a single texel.
use super::{codec::Codec, header};
use crate::plugins::image::{gpu::budget, BlockLevel, CompressedImage};

pub(super) fn read(
    bytes: &[u8],
    max_alloc: u64,
    supported: &[&str],
) -> std::result::Result<Option<CompressedImage>, &'static str> {
    let surface = header::parse(bytes)?;
    let (format, block) = match surface.codec {
        Codec::Bc1 => ("bc1-rgba-unorm", 8),
        Codec::Bc2 => ("bc2-rgba-unorm", 16),
        Codec::Bc3 => ("bc3-rgba-unorm", 16),
        Codec::Bc4 => ("bc4-r-unorm", 8),
        Codec::Bc5 => ("bc5-rg-unorm", 16),
        Codec::Bc7 => ("bc7-rgba-unorm", 16),
        _ => return Ok(None),
    };
    if !supported.contains(&format) {
        return Ok(None);
    }
    budget(
        surface.width,
        surface.height,
        surface.levels,
        block,
        max_alloc,
    )?;
    let mut offset = surface.data;
    let mut levels = Vec::new();
    for level in 0..surface.levels {
        let width = (surface.width >> level.min(31)).max(1);
        let height = (surface.height >> level.min(31)).max(1);
        let size = surface.codec.level_bytes(width, height) as usize;
        let data = bytes[offset..offset + size].to_vec();
        levels.push(BlockLevel {
            width,
            height,
            data,
        });
        offset += size;
    }
    Ok(Some(CompressedImage {
        format,
        transfer: surface.transfer,
        levels,
    }))
}
