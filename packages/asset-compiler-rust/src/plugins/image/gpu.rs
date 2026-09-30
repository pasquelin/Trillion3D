//! Native 4 × 4 texture blocks, retained until the graphics boundary requests pixels instead.
use super::{DecodedImage, ImageDecoded, Transfer};

/// One complete mip level, tightly packed in row-major blocks.
pub struct BlockLevel {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

/// GPU format names match WebGPU's linear format names; transfer is carried separately.
pub struct CompressedImage {
    pub format: &'static str,
    pub transfer: Transfer,
    pub levels: Vec<BlockLevel>,
}

/// A driver either supplies GPU blocks, requests the pixel path, or names a malformed source.
pub type BlockResult = std::result::Result<Option<CompressedImage>, &'static str>;

/// Reads blocks when the requested device supports their codec. None asks the consumer to use
/// the existing pixel driver; Basis payloads transcode directly to a supported block format.
pub fn decode_for_gpu(
    bytes: &[u8],
    max_alloc: u64,
    supported: &[&str],
) -> std::result::Result<Option<ImageDecoded>, &'static str> {
    let driver = super::by_head(bytes).ok_or("image-format-unknown")?;
    Ok(driver
        .compressed(bytes, max_alloc, supported)?
        .map(|blocks| {
            let transfer = blocks.transfer;
            ImageDecoded::new(DecodedImage::Blocks(blocks), transfer)
        }))
}

/// Total retained blocks checked before allocation or transcoder construction.
pub(super) fn budget(
    width: u32,
    height: u32,
    levels: u32,
    block: u64,
    max: u64,
) -> std::result::Result<(), &'static str> {
    let bytes = (0..levels).fold(0u64, |total, level| {
        let w = (width >> level.min(31)).max(1);
        let h = (height >> level.min(31)).max(1);
        total.saturating_add(
            u64::from(w.div_ceil(4))
                .saturating_mul(u64::from(h.div_ceil(4)))
                .saturating_mul(block),
        )
    });
    if bytes > max {
        Err("image-block-budget-exceeded")
    } else {
        Ok(())
    }
}
