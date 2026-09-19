//! PSD and PSB (Photoshop) driver, reader written here from the specification Adobe publishes
//! for third-party readers — "Adobe Photoshop File Formats Specification" —, which defines the
//! twenty-six-byte header, the three length-prefixed sections that follow it and the composite
//! data section at the end of the file. No vendor code or SDK, no third-party library: these
//! four pieces are read from end to end, which does not justify a dependency.
//!
//! **The flattened composite, and it alone.** A PSD carries its layers; recomposing them would
//! require remaking the editor's blend modes, masks and effects, hence producing an image the
//! file does not contain. This driver reads the only image the file already contains: the
//! composite data the editor writes at the end of the file. A file saved without them comes
//! back as a report reason, it is not recomposed.
//!
//! **No extra loss is added.** The output contract is RGBA8, so only eight-bit-per-channel
//! sources enter. Sixteen or thirty-two bits are refused by name rather than clipped; CMYK,
//! Lab, indexed, duotone, multichannel and bitmap too, because converting them would require
//! a profile, a matrix or a palette the driver would choose in the source's place. The
//! composite's alpha is read as-is, straight: nothing is un-multiplied. A document that
//! carries a colour profile — its image resource 1039 — sees it counted, never applied:
//! converting would require colour management, which is not this driver's.
//!
//! **One more plane is not necessarily transparency.** A Photoshop document can carry, beside
//! its colour channels, a stored alpha channel — a selection —, which the composite writes in
//! the same place as a transparency. Only the file lifts the ambiguity: the layer count of
//! the layers section is signed, and its negative sign announces that the composite's first
//! alpha channel carries the document's transparency. Without that declaration, the plane is
//! a selection: it is read, written nowhere, and counted. See `sections.rs`.
//!
//! **Accepted subset**: RGB and greyscale modes, eight bits per channel, with or without an
//! alpha plane, composite data raw or run-length compressed (PackBits), PSD as well as PSB.
use super::{surface_budget, ImageDecoded, ImageDecoder, Plugin, Transfer, RGBA8_PIXEL_BYTES};

mod lines;
mod pixels;
mod sections;

pub(super) static PSD: Psd = Psd;
pub(super) struct Psd;

/// The four signature bytes the format carries at the front.
const SIGNATURE: &[u8] = b"8BPS";
/// The complete header: signature, version, six reserved bytes, channels, height, width,
/// depth and colour mode.
const HEADER_BYTES: usize = 26;
/// Version 1, PSD; version 2, PSB, which differs only by its size ceilings and by the width
/// of two length fields.
const VERSION_PSD: u16 = 1;
const VERSION_PSB: u16 = 2;
/// The two colour modes of the subset: greyscale and RGB.
const MODE_GRAYSCALE: u16 = 1;
const MODE_RGB: u16 = 3;
/// The only depth an RGBA8 contract carries without losing anything.
const DEPTH_8: u16 = 8;
/// Side ceilings of the specification: thirty thousand pixels in PSD, ten times more in PSB.
const MAX_SIDE_PSD: u32 = 30_000;
const MAX_SIDE_PSB: u32 = 300_000;
/// Channel ceiling of the specification.
const MAX_CHANNELS: u16 = 56;

/// Signature missing, unknown version, non-null reserved bytes, null or out-of-ceiling
/// dimension, channel count out of ceiling or below the mode's colour channels.
const HEADER_INVALID: &str = "psd-header-invalid";
/// A depth the RGBA8 contract does not carry: one, sixteen or thirty-two bits per channel.
const DEPTH_UNSUPPORTED: &str = "psd-depth-unsupported";
/// A colour mode outside the subset: bitmap, indexed, CMYK, multichannel, duotone, Lab.
const COLOR_MODE_UNSUPPORTED: &str = "psd-color-mode-unsupported";
/// More than one channel beyond the mode's colour channels: nothing in the header says
/// whether this plane is a transparency, a stored selection or a spot colour.
const CHANNELS_UNSUPPORTED: &str = "psd-channels-unsupported";
/// One more plane than the colour channels, that nothing declares as transparency: a stored
/// alpha channel, i.e. a selection. It is read — the cursor must advance by one plane — and
/// written nowhere: taking it for transparency punched holes in the texture. Counted, never
/// silenced.
const ALPHA_IGNORED: &str = "psd-alpha-channel-ignored";
/// The file carries layers, and only the flattened composite comes out of this driver.
/// Counted, never silenced.
const LAYERS_FLATTENED: &str = "psd-layers-flattened";
/// A composite compression outside the subset: the specification's two ZIP variants.
const COMPRESSION_UNSUPPORTED: &str = "psd-compression-unsupported";
/// The file stops before its composite-data section: there is no flattened image to read.
const COMPOSITE_MISSING: &str = "psd-composite-missing";
/// The announced bytes are not all there, or a compressed line does not yield its width.
const DATA_TRUNCATED: &str = "psd-data-truncated";
/// The image exceeds the received allocation ceiling: a refusal, never an attempted allocation.
const TOO_LARGE: &str = "psd-image-too-large";

/// What the header announces, once all its fields have been judged in their domain and
/// against each other: enough to read the composite's planes and nothing more.
struct Header {
    /// A PSB: its two length fields — layers section and compressed-line byte count — are
    /// twice as wide as those of a PSD.
    psb: bool,
    width: u32,
    height: u32,
    /// Planes the composite carries, colour channels then alpha if there is one.
    channels: usize,
    /// Colour channels of the mode: three in RGB, one in greyscale.
    color_channels: usize,
}

impl Plugin for Psd {
    fn name(&self) -> &'static str {
        "psd"
    }
    /// The number rises with what the driver returns. It went to 2 when an extra plane
    /// stopped being taken for transparency without a declaration: a cache entry written in
    /// the era of that hypothesis carried an alpha that was not the document's.
    fn version(&self) -> &'static str {
        "psd-composite-aplati-3"
    }
    /// `.psd` and `.psb` are the two extensions of the format. The extension only names the
    /// driver: the bytes decide.
    fn extensions(&self) -> &'static [&'static str] {
        &["psd", "psb"]
    }
}

impl ImageDecoder for Psd {
    fn mime(&self) -> &'static str {
        "image/vnd.adobe.photoshop"
    }
    /// The signature and the version number, six bytes that only this format carries. The
    /// rest of the header is judged at decode, so that a defect comes out there by its name
    /// rather than as an unknown format.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.len() >= SIGNATURE.len() + 2
            && head.starts_with(SIGNATURE)
            && matches!(
                u16::from_be_bytes([head[4], head[5]]),
                VERSION_PSD | VERSION_PSB
            )
    }
    /// The header first — it gives the size, so the ceiling applies before any allocation —,
    /// then the three sections to skip, then the composite's planes.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        let (header, rest) = header(bytes)?;
        surface_budget(
            header.width,
            header.height,
            RGBA8_PIXEL_BYTES,
            max_alloc,
            TOO_LARGE,
        )?;
        let (declared, compression, body) = pixels::composite(&header, rest)?;
        let image = pixels::decode(&header, &declared, compression, body)?;
        let alpha_plane = header.channels > header.color_channels;
        Ok(ImageDecoded::new(image, Transfer::Srgb)
            .with_notes(declared.profile)
            .with_notes((alpha_plane && !declared.transparency).then_some(ALPHA_IGNORED))
            .with_notes((declared.layers > 0).then_some(LAYERS_FLATTENED)))
    }
}

/// The header, field by field then field against field, and the bytes that follow it. The
/// channel count is judged against the colour mode: one more plane than the colour channels
/// is the composite's alpha, two more planes are an ambiguity the header does not lift.
fn header(bytes: &[u8]) -> std::result::Result<(Header, &[u8]), &'static str> {
    let head = bytes.get(..HEADER_BYTES).ok_or(HEADER_INVALID)?;
    if !head.starts_with(SIGNATURE) || head[6..12].iter().any(|byte| *byte != 0) {
        return Err(HEADER_INVALID);
    }
    let word = |at: usize| u16::from_be_bytes([head[at], head[at + 1]]);
    let long = |at: usize| u32::from_be_bytes([head[at], head[at + 1], head[at + 2], head[at + 3]]);
    let psb = match word(4) {
        VERSION_PSD => false,
        VERSION_PSB => true,
        _ => return Err(HEADER_INVALID),
    };
    let (channels, height, width) = (word(12), long(14), long(18));
    let max_side = if psb { MAX_SIDE_PSB } else { MAX_SIDE_PSD };
    let sides_valid = (1..=max_side).contains(&width) && (1..=max_side).contains(&height);
    if !sides_valid || !(1..=MAX_CHANNELS).contains(&channels) {
        return Err(HEADER_INVALID);
    }
    if word(22) != DEPTH_8 {
        return Err(DEPTH_UNSUPPORTED);
    }
    let color_channels = match word(24) {
        MODE_RGB => 3,
        MODE_GRAYSCALE => 1,
        _ => return Err(COLOR_MODE_UNSUPPORTED),
    };
    let channels = usize::from(channels);
    match channels.checked_sub(color_channels).ok_or(HEADER_INVALID)? {
        0 | 1 => {}
        _ => return Err(CHANNELS_UNSUPPORTED),
    }
    let header = Header {
        psb,
        width,
        height,
        channels,
        color_channels,
    };
    Ok((header, &bytes[HEADER_BYTES..]))
}
