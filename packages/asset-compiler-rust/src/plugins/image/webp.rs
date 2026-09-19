//! WebP driver, **lossless only**. Read from the format's public specification — RIFF
//! container ("WebP Container Specification", Google) and VP8L lossless stream ("WebP
//! Lossless Bitstream Specification") — and decoded by the `webp` feature of the `image`
//! 0.25.10 crate, which delegates to `image-webp`, a pure-Rust decoder (MIT or Apache-2.0,
//! notices kept with the dependency). No vendor code or SDK, no re-encoding.
//!
//! **Policy.** The repository's fidelity rule forbids adding loss; it therefore only admits
//! lossless WebP. The driver reads the RIFF header itself and decides **before** decoding:
//! a `VP8L` stream enters, a `VP8 ` (lossy) stream comes back as a named refusal, an
//! animation too. A refusal is not a compilation error: the texture lets the engine fall
//! back to white, as for any other unreadable format.
//!
//! **Patents.** libwebp's patent grant (BSD-3 licence with an *additional IP rights grant*)
//! covers conforming implementations of the specification, `image-webp` included.
//! Documentary note, not legal advice: the repository's legal policy is in
//! `packages/asset-compiler-rust/FORMATS.md`.
use super::crate_image::{self, ANIMATED};
use super::{ImageDecoded, ImageDecoder, Plugin};

pub(super) static WEBP: Webp = Webp;
pub(super) struct Webp;

/// Container header: `RIFF`, the size of the rest of the file, then the form type.
const HEADER_BYTES: usize = 12;
/// Header of a RIFF chunk: four name bytes, four of size.
const CHUNK_HEADER_BYTES: usize = 8;
/// The lossy stream: refused without being decoded, the fidelity rule forbids it.
const LOSSY: &str = "image-lossy-unsupported";

impl Plugin for Webp {
    fn name(&self) -> &'static str {
        "webp"
    }
    /// The policy enters the version: admitting only lossless is part of what the driver
    /// produces, hence of the cache identity.
    fn version(&self) -> &'static str {
        "webp-lossless-image-0.25"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["webp"]
    }
}

impl ImageDecoder for Webp {
    fn mime(&self) -> &'static str {
        "image/webp"
    }
    /// The RIFF container and its form type. A lossy WebP is recognized here *on purpose*:
    /// better to refuse it by naming it than to let it pass as an unknown format.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.len() >= HEADER_BYTES && head.starts_with(b"RIFF") && &head[8..12] == b"WEBP"
    }
    /// Lossless only, and under the received allocation ceiling. Everything else — lossy
    /// stream, animation, truncated file, empty image — comes back as a named report reason,
    /// never as a panic or a compilation failure.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        admitted(bytes)?;
        crate_image::decode(bytes, max_alloc, image::ImageFormat::WebP)
    }
}

/// Walks the container's chunks up to the image stream and says whether that stream is admitted.
///
/// The format's three forms go through the same walk: a lone `VP8L` (simple lossless), a lone
/// `VP8 ` (lossy), and the extended `VP8X` container whose image stream arrives after the
/// optional chunks. `ICCP`, `ALPH`, `EXIF` and `XMP` are crossed without changing any pixel:
/// ignoring them loses no colour, a lossless image's alpha being carried by VP8L itself.
/// `ANIM` and `ANMF` stop the walk: an animation is not a texture.
fn admitted(bytes: &[u8]) -> std::result::Result<(), &'static str> {
    if !container_is_whole(bytes) {
        return Err("image-decode-failed");
    }
    let mut offset = HEADER_BYTES;
    while offset + CHUNK_HEADER_BYTES <= bytes.len() {
        let size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        match &bytes[offset..offset + 4] {
            b"VP8L" => return Ok(()),
            b"VP8 " => return Err(LOSSY),
            b"ANIM" | b"ANMF" => return Err(ANIMATED),
            _ => {}
        }
        // A chunk occupies its header, its payload, and a padding byte if its size is odd.
        let Some(next) = offset
            .checked_add(CHUNK_HEADER_BYTES)
            .and_then(|at| at.checked_add(size))
            .and_then(|at| at.checked_add(size & 1))
        else {
            return Err("image-decode-failed");
        };
        offset = next;
    }
    // No image stream: the file stops before, or only carries metadata.
    Err("image-decode-failed")
}

/// Size announced by the RIFF header against the bytes actually there. A file shorter than
/// what it declares is truncated: saying so here avoids handing the decoder a cut stream.
fn container_is_whole(bytes: &[u8]) -> bool {
    let Some(declared) = bytes.get(4..8) else {
        return false;
    };
    let declared = u32::from_le_bytes([declared[0], declared[1], declared[2], declared[3]]);
    bytes.len() as u64 >= u64::from(declared) + 8
}
