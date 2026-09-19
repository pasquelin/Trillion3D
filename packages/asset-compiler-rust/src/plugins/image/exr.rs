//! OpenEXR driver, read from the Academy Software Foundation public specifications
//! ("Technical Introduction to OpenEXR" and "OpenEXR File Layout", openexr.com) for the version
//! field and the channel set, and decoded by the `exr` 1.74.2 crate (BSD-3-Clause,
//! `johannesvollmer/exrs`, pure Rust and no `unsafe`, notices kept with the dependency).
//! No vendor SDK or code, no C library, no re-encoding.
//!
//! **No extra loss is added.** Samples leave as `f32`: a half-float expands into it exactly, a
//! single-precision float passes through as-is. Nothing is reduced to eight bits, nothing is
//! tone-mapped, nothing is rescaled — hence the `DecodedImage::RgbaF32` variant.
//!
//! **An OpenEXR's alpha is associated.** The "Technical Introduction to OpenEXR" defines the
//! RGB components as already multiplied by the pixel's alpha; the output contract, itself,
//! asks for straight alpha. This driver therefore divides each component by alpha before
//! returning the image — otherwise the preview, which premultiplies in turn, would premultiply
//! a second time and darken every translucent surface. A zero-alpha pixel keeps its components:
//! under a null alpha there is no straight colour to recover, and nothing is divided by zero.
//!
//! **Accepted subset**, declared here and nowhere else: a single part, flat (not deep), at its
//! largest resolution level, with the `R`, `G`, `B` channels and, if there is one, `A` — in
//! half or single precision, without subsampling. Channels are read by name, never by rank.
//! Anything outside that is a named refusal: deep parts, multi-part files, missing channels,
//! differently named channels (AOV, `Y`/`RY`/`BY`, depth), 32-bit integers, subsampled chroma.
//! A file outside the subset lets the engine fall back to white; it is never guessed or
//! approximated.
use super::{float_budget, DecodedImage, ImageDecoded, ImageDecoder, Plugin, Transfer};
use ::exr::math::Vec2;
use ::exr::meta::attribute::SampleType;
use ::exr::meta::MetaData;

mod samples;

pub(super) static EXR: Exr = Exr;
pub(super) struct Exr;

/// Four-byte magic number, integer 20 000 630 written little-endian.
const MAGIC: &[u8] = &[0x76, 0x2f, 0x31, 0x01];
/// Version field, four bytes just after the magic number: a version number in the low byte,
/// flags above it.
const VERSION_FIELD: std::ops::Range<usize> = 4..8;
/// Flag "the file contains at least one part that is not a flat image", i.e. deep data.
const FLAG_DEEP: u32 = 0x0800;
/// Flag "the file contains several parts".
const FLAG_MULTI_PART: u32 = 0x1000;

/// Header missing, truncated or inconsistent: for the host, that is a failed-decode symptom.
const HEADER_INVALID: &str = "exr-header-invalid";
/// Deep data: a pixel carries a list of samples, not a colour. Flattening them would require
/// a composition, hence a choice the compiler must not make.
const DEEP: &str = "exr-deep-unsupported";
/// Several parts: nothing says which is the texture. Refuse rather than choose.
const MULTI_PART: &str = "exr-multipart-unsupported";
/// The channel set is not one an image driver knows how to return.
const CHANNELS: &str = "exr-channels-unsupported";
/// The image exceeds the received allocation ceiling: a refusal, never an attempted allocation.
const TOO_LARGE: &str = "exr-image-too-large";
/// The header is in the subset, but the pixels cannot be reread: cut file, unexpected
/// compression, wrong chunk table.
const UNREADABLE: &str = "exr-data-unreadable";

impl Plugin for Exr {
    fn name(&self) -> &'static str {
        "exr"
    }
    /// The suffix names the returned alpha. It was added with the un-premultiply, because the
    /// version enters the cache identity: without it, an entry written when associated samples
    /// left as-is would be reread as if it were correct.
    fn version(&self) -> &'static str {
        "exr-openexr-2.0-exrs-1.74.2-alpha-droit"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["exr"]
    }
}

impl ImageDecoder for Exr {
    fn mime(&self) -> &'static str {
        "image/x-exr"
    }
    /// The magic number is enough: it belongs only to this format. What the header announces
    /// next is checked at decode, where it is reported instead of silencing the driver.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(MAGIC)
    }
    /// The header first, the pixels next: a file outside the subset never reaches the decoder,
    /// and the size is known — hence the ceiling applied — before any allocation.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        let (width, height) = subset(bytes, max_alloc)?;
        samples::read_all(bytes, width, height)
    }
}

/// The accepted subset, checked on the version field then on the header, and the size of the
/// layer that comes out. Both flags are read without the crate: four bytes of the specification,
/// and a deep or multi-part file is named before any other read.
fn subset(bytes: &[u8], max_alloc: u64) -> std::result::Result<(u32, u32), &'static str> {
    let field: [u8; 4] = bytes
        .get(VERSION_FIELD)
        .and_then(|field| field.try_into().ok())
        .ok_or(HEADER_INVALID)?;
    let flags = u32::from_le_bytes(field);
    if flags & FLAG_DEEP != 0 {
        return Err(DEEP);
    }
    if flags & FLAG_MULTI_PART != 0 {
        return Err(MULTI_PART);
    }
    let meta = MetaData::read_from_buffered(bytes, false).map_err(|_| HEADER_INVALID)?;
    let [header] = &meta.headers[..] else {
        return Err(MULTI_PART);
    };
    if header.deep {
        return Err(DEEP);
    }
    channels(header)?;
    let width = u32::try_from(header.layer_size.width()).map_err(|_| TOO_LARGE)?;
    let height = u32::try_from(header.layer_size.height()).map_err(|_| TOO_LARGE)?;
    float_budget(width, height, max_alloc, TOO_LARGE)?;
    Ok((width, height))
}

/// Channels, by name: exactly `R`, `G`, `B`, and at most one `A`. One more channel — a render
/// pass, a depth, a luminance — makes the file ambiguous: which is the colour, and what becomes
/// of the others? Refuse rather than drop them in silence.
fn channels(header: &::exr::meta::header::Header) -> std::result::Result<(), &'static str> {
    let mut seen = [false; 3];
    for channel in &header.channels.list {
        match channel.name.to_string().as_str() {
            "R" => seen[0] = true,
            "G" => seen[1] = true,
            "B" => seen[2] = true,
            "A" => {}
            _ => return Err(CHANNELS),
        }
        // A subsampled channel does not have one sample per pixel: bringing it back to full
        // resolution would be an interpolation, hence an image the source does not contain.
        if channel.sampling != Vec2(1, 1) {
            return Err(CHANNELS);
        }
        // 32-bit integers are not colours: the specification reserves them for identifiers
        // and masks, which no conversion to float represents.
        if channel.sample_type == SampleType::U32 {
            return Err(CHANNELS);
        }
    }
    if seen.iter().all(|found| *found) {
        Ok(())
    } else {
        Err(CHANNELS)
    }
}
