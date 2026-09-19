//! Level 0 of a KTX 2.0 whose `vkFormat` names the codec: its supercompression undone, then
//! its reconstruction to RGBA8 by the shared `image::blocks` base.
//!
//! Nothing is allocated before it has been bounded: the final image against the received
//! ceiling, the decompression buffer against that ceiling and against the length the index
//! announces. A supercompression that would return something other than that length is a
//! refusal, not a half-filled buffer.
use super::format::{self, Layout};
use super::header::{self, Surface};
use super::{DATA_TRUNCATED, FORMAT_UNSUPPORTED, TOO_LARGE};
use crate::plugins::image::blocks as shared;
use crate::plugins::image::DecodedImage;
use crate::plugins::image::{surface_budget, RGBA8_PIXEL_BYTES};
use std::borrow::Cow;
use std::io::Read;

pub(super) fn decode(
    surface: &Surface,
    bytes: &[u8],
    max_alloc: u64,
) -> std::result::Result<DecodedImage, &'static str> {
    let layout = format::layout(surface.format).ok_or(FORMAT_UNSUPPORTED)?;
    let (width, height) = (surface.width, surface.height);
    surface_budget(width, height, RGBA8_PIXEL_BYTES, max_alloc, TOO_LARGE)?;
    let needed = layout.level_bytes(width, height);
    let level = plain(surface, bytes, needed, max_alloc)?;
    let (width, height) = (width as usize, height as usize);
    let rgba = match layout {
        Layout::Blocks { bytes, decode } => {
            shared::to_rgba8(decode, bytes, &level, width, height, DATA_TRUNCATED)?
        }
        Layout::Rgba8 => level
            .get(..width * height * 4)
            .ok_or(DATA_TRUNCATED)?
            .to_vec(),
    };
    shared::image(surface.width, surface.height, rgba, DATA_TRUNCATED)
}

/// The level's bytes once its supercompression is undone. Without supercompression, they are
/// the file's, borrowed as-is; in Zstandard, the index announces the expected length, which
/// bounds both the allocation and the read — a longer stream is truncated at that bound, hence
/// returned too short, hence refused just after.
fn plain<'a>(
    surface: &Surface,
    bytes: &'a [u8],
    needed: u64,
    max_alloc: u64,
) -> std::result::Result<Cow<'a, [u8]>, &'static str> {
    let level = &bytes[surface.level.clone()];
    if surface.supercompression != header::ZSTD {
        return Ok(Cow::Borrowed(level));
    }
    let announced = surface.plain as u64;
    if announced > max_alloc {
        return Err(TOO_LARGE);
    }
    if announced < needed {
        return Err(DATA_TRUNCATED);
    }
    let mut decoder = ruzstd::StreamingDecoder::new(level).map_err(|_| DATA_TRUNCATED)?;
    let mut out = Vec::with_capacity(surface.plain);
    decoder
        .by_ref()
        .take(announced)
        .read_to_end(&mut out)
        .map_err(|_| DATA_TRUNCATED)?;
    if out.len() != surface.plain {
        return Err(DATA_TRUNCATED);
    }
    Ok(Cow::Owned(out))
}
