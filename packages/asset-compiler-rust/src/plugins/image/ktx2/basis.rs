//! Basis Universal payloads of a KTX 2.0 — ETC1S under BasisLZ supercompression, UASTC LDR
//! 4 × 4 — transcoded to RGBA8 by the `basisu` 0.1.0 crate (Apache-2.0, `marcogomez/basisu`),
//! a pure-Rust port of Binomial's reference transcoder, verified byte for byte against it.
//!
//! Such a container writes `VK_FORMAT_UNDEFINED` and describes its payload in its format
//! descriptor: it is the transcoder that rereads that descriptor, not this driver. The driver
//! has already refused cubes, arrays and volumes; what it refuses here, in addition, comes
//! back under a single name — codec outside the transcoder's list, video with state from one
//! frame to the next, corrupt stream.
//!
//! The target is RGBA8 and nothing else. Keeping compressed blocks through to the GPU is
//! another job, which will need one more variant on the `DecodedImage` contract; it does not
//! start here.
use super::header::Surface;
use super::{DATA_TRUNCATED, TOO_LARGE, TRANSCODE_FAILED};
use crate::plugins::image::blocks as shared;
use crate::plugins::image::DecodedImage;
use crate::plugins::image::{surface_budget, RGBA8_PIXEL_BYTES};
use basisu::{DecodeFlags, TargetFormat, Transcoder};

pub(super) fn decode(
    surface: &Surface,
    bytes: &[u8],
    max_alloc: u64,
) -> std::result::Result<DecodedImage, &'static str> {
    surface_budget(
        surface.width,
        surface.height,
        RGBA8_PIXEL_BYTES,
        max_alloc,
        TOO_LARGE,
    )?;
    let texture = Transcoder::new(bytes).map_err(|_| TRANSCODE_FAILED)?;
    // Only level 0 is consumed, as everywhere in this driver: it is the base image, the one
    // the level index gives first.
    let rgba = texture
        .transcode(0, TargetFormat::Rgba32, DecodeFlags::NONE)
        .map_err(|_| TRANSCODE_FAILED)?;
    shared::image(surface.width, surface.height, rgba, DATA_TRUNCATED)
}
