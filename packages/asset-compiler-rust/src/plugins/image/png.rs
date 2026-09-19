//! PNG driver, W3C PNG 1.2 / ISO 15948 standard, decoded losslessly by the `image` crate
//! (`png` feature). No re-encoding: what enters losslessly comes out byte for byte.
//!
//! Depths read, all to exact RGBA8: 1, 2, 4 and 8 bits per channel, palette, greyscale and
//! alpha included — up to eight bits, expansion to RGBA8 loses nothing, it copies.
//!
//! 16 bits per channel is refused and named: see `DEPTH`. Depth is read from the IHDR before
//! any decode, because afterwards it is too late — the library would return an `Rgb16` that
//! `to_rgba8()` would clip to eight bits without anyone having asked.
//!
//! **What the file declares around the pixels** is read in its chunks, not in its image.
//! An animated PNG (APNG) carries an `acTL` chunk and several frames; the contract returns
//! only one — the default image, that of the `IDAT`s, as the APNG specification defines it —
//! and the driver counts the animation rather than letting the other frames vanish without a
//! word. An `iCCP` chunk carries a colour profile that the output does not carry: its name,
//! written in the clear in front of the compressed profile, is enough to say whether it is
//! the output sRGB or something else to count.
use super::{crate_image, icc, ImageDecoded, ImageDecoder, Plugin, Transfer};

mod chunks;

pub(super) static PNG: Png = Png;
pub(super) struct Png;

/// A 16-bit-per-channel PNG. This is not an exotic profile: it is precision that
/// `DecodedImage` cannot yet carry, its only variant being RGBA8. Clipping it in silence
/// would add a loss the source did not have, which the import policy forbids. Accepting it
/// would need an `Rgba16` variant on the image contract and its explicit handling at every
/// consumer — `texture_preview` today, the preview pyramid next.
const DEPTH: &str = "image-depth-unsupported";

/// The file declares an animation — `acTL` chunk — and the contract returns only one image.
/// It is the default image that comes out, the other frames are counted under this name
/// rather than lost in silence. This is not a refusal: an animated texture remains a
/// texture, its first image counts.
const ANIMATION: &str = "image-animation-first-frame";
/// Chunk that declares the animation: frame count and loop count.
const ANIMATION_CHUNK: &[u8] = b"acTL";
/// Chunk that carries a colour profile: its name in the clear, one compression-method byte,
/// then the compressed profile. Only the name is read without decompressing anything.
const PROFILE_CHUNK: &[u8] = b"iCCP";
/// Chunk that declares the output written in sRGB space, and the rendering intent with it.
const SRGB_CHUNK: &[u8] = b"sRGB";
/// Chunk that declares the file's gamma, multiplied by one hundred thousand over four bytes.
const GAMMA_CHUNK: &[u8] = b"gAMA";
/// Gamma of an image written in the sRGB curve: 1/2.2, which the specification rounds thus.
const SRGB_GAMMA: u32 = 45_455;
/// Gamma of an image whose samples are proportional to light: 1 exactly.
const LINEAR_GAMMA: u32 = 100_000;
/// A gamma that is neither that of the sRGB curve nor unity. The contract carries two curves
/// and cannot apply a third: the image comes out treated as sRGB, as convention wants for a
/// file that stays silent, and the gap is counted rather than passed over in silence.
const TRANSFER: &str = "image-transfer-unsupported";

/// Type of the first chunk, which is always the IHDR: eight-byte signature, then the chunk
/// length over four.
const FIRST_CHUNK: std::ops::Range<usize> = 12..16;
/// Depth byte in the IHDR: the eight of the signature, the eight of the chunk length and
/// type, the eight of the width and height.
const BIT_DEPTH: usize = 24;

impl Plugin for Png {
    fn name(&self) -> &'static str {
        "png"
    }
    /// The suffixes name what this driver returns of its own: the maximum depth beyond which
    /// it refuses, and the animation count. The version enters the cache identity — without
    /// it, an entry produced when 16-bit was lowered, or when an APNG was flattened without a
    /// word, would keep being reread as if it were correct.
    fn version(&self) -> &'static str {
        "png-image-0.25-depth8-apng-icc-gama"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["png"]
    }
}

impl ImageDecoder for Png {
    fn mime(&self) -> &'static str {
        "image/png"
    }
    /// The eight-byte signature that every PNG carries at the front.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(b"\x89PNG\r\n\x1a\n")
    }
    /// Depth first, pixels next. A file too short to carry its IHDR is not judged here: it
    /// goes to the decoder, which refuses it as before.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        if bytes.get(FIRST_CHUNK) == Some(b"IHDR") && bytes.get(BIT_DEPTH) == Some(&16) {
            return Err(DEPTH);
        }
        let decoded = crate_image::decode(bytes, max_alloc, image::ImageFormat::Png)?;
        let (transfer, notes) = declarations(bytes);
        Ok(decoded.with_transfer(transfer).with_notes(notes))
    }
}

/// The curve the file declares, and what else it declares that the output does not carry.
/// The walk stops at the first cut chunk: a truncated file is judged by the pixel decoder,
/// not guessed here.
///
/// Priority is the format's, from most precise to vaguest: an `iCCP` profile describes the
/// curve itself, an `sRGB` chunk names it, and `gAMA` alone only says a gamma. The first two
/// therefore leave the output in sRGB — the profile is already counted as not converted —,
/// and it is in their absence that gamma decides.
fn declarations(bytes: &[u8]) -> (Transfer, Vec<&'static str>) {
    let mut notes = Vec::new();
    let mut described = false;
    let mut gamma = None;
    for (kind, data) in chunks::of(bytes) {
        match kind {
            ANIMATION_CHUNK => notes.push(ANIMATION),
            PROFILE_CHUNK => {
                described = true;
                notes.extend(icc::note(name(data)));
            }
            SRGB_CHUNK => described = true,
            GAMMA_CHUNK => {
                gamma = data
                    .get(..4)
                    .map(|value| u32::from_be_bytes([value[0], value[1], value[2], value[3]]));
            }
            _ => {}
        }
    }
    match gamma.filter(|_| !described) {
        Some(LINEAR_GAMMA) => (Transfer::Linear, notes),
        Some(SRGB_GAMMA) | None => (Transfer::Srgb, notes),
        Some(_) => {
            notes.push(TRANSFER);
            (Transfer::Srgb, notes)
        }
    }
}

/// Name of a profile, the part of the `iCCP` chunk that precedes the first null byte. The
/// profile itself is compressed: its name is all this driver reads, and it is what the
/// specification asks it to write in the clear.
fn name(chunk: &[u8]) -> &[u8] {
    let end = chunk.iter().position(|byte| *byte == 0);
    &chunk[..end.unwrap_or(chunk.len())]
}
