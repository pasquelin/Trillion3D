//! Radiance HDR (RGBE) driver, reader written here from the format's public specification:
//! Greg Ward's "Real Pixels" (Graphics Gems II, 1991), which defines the RGBE encoding and its
//! run-length compression, and the Radiance manual (Lawrence Berkeley National Laboratory),
//! which defines the header, its variables and its resolution line. No vendor SDK or code, no
//! third-party decoder: the `image` crate only recognizes the `#?RADIANCE` signature and does
//! not let what it refuses be named, two things this driver must do.
//!
//! **No extra loss is added.** An RGBE carries three eight-bit mantissas and a shared exponent;
//! the mantissa multiplied by `2^(e - 136)` is exactly the float the file describes, and `f32`
//! carries it without rounding. Nothing is reduced to eight bits, nothing is tone-mapped —
//! hence the `DecodedImage::RgbaF32` variant. Alpha is opaque: the format has none.
//!
//! **Accepted subset**: signature `#?RADIANCE` or `#?RGBE`, `FORMAT=32-bit_rle_rgbe`
//! (absent, that is Radiance's default), resolution `-Y height +X width`, raw lines, old
//! run-length compression (marker `1,1,1,n`) as well as new (header `2,2,width`).
//! Refused and named: `32-bit_rle_xyze`, which is another colour space, and any orientation
//! other than top-to-bottom left-to-right, which would require flipping the image.
use super::{float_budget, DecodedImage, ImageDecoded, ImageDecoder, Plugin, Transfer};

mod scanlines;

pub(super) static HDR: Hdr = Hdr;
pub(super) struct Hdr;

/// The two signatures the format carries at the front. `#?RADIANCE` is the one today's tools
/// write; `#?RGBE` is that of old files and of several exporters.
const SIGNATURES: [&[u8]; 2] = [b"#?RADIANCE", b"#?RGBE"];
/// The only pixel encoding of this driver. `32-bit_rle_xyze` describes the same bytes in CIE
/// XYZ space: converting it to RGB would require a matrix and a choice of primaries.
const FORMAT_RGBE: &str = "32-bit_rle_rgbe";
/// Header variable that names the encoding.
const FORMAT_KEY: &str = "FORMAT=";
/// Header ceiling, in lines: a file that still has not announced its resolution after that is
/// not an HDR, it is a text file that is refused instead of being walked entirely.
const MAX_HEADER_LINES: usize = 128;

/// Header missing, truncated, unreadable or without a valid resolution line.
const HEADER_INVALID: &str = "hdr-header-invalid";
/// A pixel encoding outside the subset: `32-bit_rle_xyze` today.
const FORMAT_UNSUPPORTED: &str = "hdr-format-unsupported";
/// A scan orientation other than `-Y … +X …`.
const ORIENTATION: &str = "hdr-orientation-unsupported";
/// The image exceeds the received allocation ceiling: a refusal, never an attempted allocation.
const TOO_LARGE: &str = "hdr-image-too-large";

impl Plugin for Hdr {
    fn name(&self) -> &'static str {
        "hdr"
    }
    fn version(&self) -> &'static str {
        "hdr-radiance-rgbe-1"
    }
    /// `.hdr` is the common extension, `.rgbe` the one some exporters put, `.pic` that of
    /// original Radiance files. The extension only names the driver: the bytes decide, and a
    /// `.pic` of another format comes back as unknown format.
    fn extensions(&self) -> &'static [&'static str] {
        &["hdr", "rgbe", "pic"]
    }
}

impl ImageDecoder for Hdr {
    fn mime(&self) -> &'static str {
        "image/vnd.radiance"
    }
    fn accepts_head(&self, head: &[u8]) -> bool {
        SIGNATURES
            .iter()
            .any(|signature| head.starts_with(signature))
    }
    /// The header first — it gives the size, so the ceiling applies before any allocation —,
    /// then the pixel lines, each in one of the format's three writings.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        let (width, height, body) = header(bytes)?;
        float_budget(width, height, max_alloc, TOO_LARGE)?;
        let data = scanlines::decode(body, width, height)?;
        Ok(ImageDecoded::new(
            DecodedImage::RgbaF32 {
                width,
                height,
                data,
            },
            Transfer::Linear,
        ))
    }
}

/// The header: the signature, variable and comment lines, an empty line, then the resolution
/// line. Returns the size and the bytes that follow — the pixels and nothing else.
fn header(bytes: &[u8]) -> std::result::Result<(u32, u32, &[u8]), &'static str> {
    if !SIGNATURES
        .iter()
        .any(|signature| bytes.starts_with(signature))
    {
        return Err(HEADER_INVALID);
    }
    let mut rest = bytes;
    for _ in 0..MAX_HEADER_LINES {
        let (line, tail) = next_line(rest)?;
        rest = tail;
        if line.is_empty() {
            let (resolution, body) = next_line(rest)?;
            return size(resolution).map(|(width, height)| (width, height, body));
        }
        if let Some(value) = line.strip_prefix(FORMAT_KEY) {
            if value.trim() != FORMAT_RGBE {
                return Err(FORMAT_UNSUPPORTED);
            }
        }
    }
    Err(HEADER_INVALID)
}

/// One header line, without its newline, and what follows it. The header is text: bytes that
/// are not are not a Radiance header.
fn next_line(bytes: &[u8]) -> std::result::Result<(&str, &[u8]), &'static str> {
    let end = bytes
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or(HEADER_INVALID)?;
    let line = std::str::from_utf8(&bytes[..end]).map_err(|_| HEADER_INVALID)?;
    Ok((line.trim_end_matches('\r'), &bytes[end + 1..]))
}

/// The resolution line. Only `-Y height +X width` is accepted: that is the top-to-bottom
/// left-to-right scan, the one in which the contract stores its pixels. The other seven
/// combinations of signs and axes describe the same image written in another direction;
/// accepting them would mean flipping it, and a driver that flips in silence is a driver one
/// doubts.
fn size(line: &str) -> std::result::Result<(u32, u32), &'static str> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    let [y_axis, height, x_axis, width] = fields[..] else {
        return Err(HEADER_INVALID);
    };
    if !matches!(y_axis, "-Y" | "+Y") || !matches!(x_axis, "+X" | "-X") {
        return Err(HEADER_INVALID);
    }
    if (y_axis, x_axis) != ("-Y", "+X") {
        return Err(ORIENTATION);
    }
    let height = height.parse::<u32>().map_err(|_| HEADER_INVALID)?;
    let width = width.parse::<u32>().map_err(|_| HEADER_INVALID)?;
    Ok((width, height))
}
