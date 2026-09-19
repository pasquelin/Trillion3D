//! BMP driver (Windows Bitmap, *device-independent bitmap*), read from the public structures
//! `BITMAPFILEHEADER`, `BITMAPINFOHEADER` and their V2 to V5 extensions documented by Microsoft
//! ("Bitmap Header Types"), and decoded by the `image` crate (`bmp` feature, MIT or Apache-2.0,
//! notices kept with the dependency). No vendor code or SDK, no re-encoding.
//!
//! **Profiles read, all lossless to RGBA8**: 24- and 32-bit true colour, 1-, 2-, 4- and 8-bit
//! palettes, 16-bit by masks (5-5-5 as 5-6-5), and both run-length compressions `BI_RLE8` and
//! `BI_RLE4`, which are lossless by construction. Line order is the format's: a positive height
//! describes a bottom-up file, which the decoder puts back into image order, and a negative
//! height a top-down file. A 32-bit `BI_RGB` keeps opaque alpha: the specification declares its
//! fourth byte *unused*, and reading it as alpha would be a guess, not a read.
//!
//! **Why fewer than eight bits per channel enter losslessly.** The decoder takes each `n`-bit
//! channel to eight through a `round(v × 255 / (2^n − 1))` table — a proportional scale rounded
//! to nearest, not a bit copy. Both work here for the same reason: the table is *strictly
//! increasing*, hence injective, hence invertible — the 32 values of a 5-bit channel land on 32
//! distinct 8-bit values, and the return path yields the original value. No source information
//! is lost.
//!
//! **What is refused, and why.** A mask of more than eight bits per channel — which V4 and V5
//! headers allow, for example 10-10-10 — would be truncated of its low bits by the decoder: that
//! is a loss, so it is rejected before any decode, by name. Compressions that wrap another format
//! (`BI_JPEG`, `BI_PNG`) and those outside the read format (`BI_ALPHABITFIELDS`, the CMYK
//! variants) are named the same way.
use super::{crate_image, ImageDecoded, ImageDecoder, Plugin};

pub(super) static BMP: Bmp = Bmp;
pub(super) struct Bmp;

/// A depth outside the profiles carried losslessly to RGBA8: the 64 bits per pixel of recent
/// headers, in particular, which the `Rgba8` contract could not carry without clipping.
const DEPTH: &str = "bmp-depth-unsupported";
/// A channel mask wider than eight bits. The decoder would bring it back to eight by throwing
/// away its low bits, which would add to the source a loss it did not have.
const LOSSY_MASKS: &str = "bmp-bitfields-lossy";
/// `BI_JPEG` or `BI_PNG`: the file does not wrap pixels but another whole format. The image
/// router names one driver per format; unpacking a second one here would bypass it.
const EMBEDDED: &str = "bmp-embedded-codec-unsupported";
/// A compression outside the read format, `BI_ALPHABITFIELDS` and the CMYK variants included.
const COMPRESSION: &str = "bmp-compression-unsupported";

/// The file header: "BM", the size, two reserved fields, the pixel offset.
const FILE_HEADER_BYTES: usize = 14;
/// Size of the DIB header, first field after the file header. It is what says which of the six
/// headers the file carries.
const DIB_SIZE_AT: usize = FILE_HEADER_BYTES;
/// `BITMAPCOREHEADER`: twelve bytes, and its depth just after its two-byte dimensions.
const CORE_SIZE: u32 = 12;
const CORE_DEPTH_AT: usize = 24;
/// `BITMAPINFOHEADER` and its extensions: depth then compression, at the same ranks in the six
/// headers — the extensions add fields *after* those two, never before.
const INFO_DEPTH_AT: usize = 28;
const INFO_COMPRESSION_AT: usize = 30;
/// Channel masks, read at the same place for every header that carries them: just after the
/// forty bytes of `BITMAPINFOHEADER`, whether in the extended header or behind it.
const MASKS_AT: usize = FILE_HEADER_BYTES + 40;
/// Headers that carry an alpha mask: V3, V4 and V5. The two shorter ones do not have one.
const ALPHA_MASK_HEADERS: [u32; 3] = [56, 108, 124];
/// Depths carried losslessly to RGBA8.
const DEPTHS: [u16; 7] = [1, 2, 4, 8, 16, 24, 32];

impl Plugin for Bmp {
    fn name(&self) -> &'static str {
        "bmp"
    }
    /// The suffix names the cut this driver holds: everything it returns is lossless, refused
    /// masks of more than eight bits included. It enters the cache identity because it is part
    /// of what the driver produces — without it, an entry written by a more lax driver would be
    /// reread as correct.
    fn version(&self) -> &'static str {
        "bmp-image-0.25-sans-perte"
    }
    /// `.bmp` is the common extension; `.dib` names the same header without the file header in
    /// some exporters, and `.rle` the format's two run-length compressions.
    fn extensions(&self) -> &'static [&'static str] {
        &["bmp", "dib", "rle"]
    }
}

impl ImageDecoder for Bmp {
    fn mime(&self) -> &'static str {
        "image/bmp"
    }
    /// The two "BM" bytes of the file header, and enough to carry a DIB header behind them.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.len() >= FILE_HEADER_BYTES + CORE_SIZE as usize && head.starts_with(b"BM")
    }
    /// The cut first, the pixels next: what the decoder would clip is rejected *before* handing
    /// it over, because afterwards it is too late — it would return already impoverished pixels
    /// without anyone having asked. Everything else — truncated file, non-contiguous mask,
    /// unreadable palette — comes back as a report reason, never as a panic.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        admitted(bytes)?;
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Bmp)
    }
}

/// Reads the DIB header and says whether this file enters losslessly. A header too short to carry
/// the judged fields is not refused here: it goes to the decoder, which names it truncated like
/// any other.
fn admitted(bytes: &[u8]) -> std::result::Result<(), &'static str> {
    let Some(header) = u32_at(bytes, DIB_SIZE_AT) else {
        return Ok(());
    };
    // `BITMAPCOREHEADER` knows no compression: its only question is depth.
    let depth_at = if header == CORE_SIZE {
        CORE_DEPTH_AT
    } else {
        INFO_DEPTH_AT
    };
    let Some(depth) = u16_at(bytes, depth_at) else {
        return Ok(());
    };
    if !DEPTHS.contains(&depth) {
        return Err(DEPTH);
    }
    if header == CORE_SIZE {
        return Ok(());
    }
    let Some(compression) = u32_at(bytes, INFO_COMPRESSION_AT) else {
        return Ok(());
    };
    match compression {
        // `BI_RGB`, `BI_RLE8` and `BI_RLE4`: pixels, raw or run-length, all lossless.
        0..=2 => Ok(()),
        // `BI_BITFIELDS`: the masks say how many bits each channel actually carries.
        3 => masks_are_lossless(bytes, header),
        // `BI_JPEG` and `BI_PNG`: another whole format, which has its own driver.
        4..=5 => Err(EMBEDDED),
        _ => Err(COMPRESSION),
    }
}

/// The three — or four — channel masks, each against the width that eight bits can carry without
/// throwing anything away. A missing or null mask says nothing false: the decoder will decide
/// itself that it is missing, and name it.
fn masks_are_lossless(bytes: &[u8], header: u32) -> std::result::Result<(), &'static str> {
    let channels = if ALPHA_MASK_HEADERS.contains(&header) {
        4
    } else {
        3
    };
    for channel in 0..channels {
        let Some(mask) = u32_at(bytes, MASKS_AT + channel * 4) else {
            return Ok(());
        };
        if mask_width(mask) > 8 {
            return Err(LOSSY_MASKS);
        }
    }
    Ok(())
}

/// Number of bits a contiguous mask carries. A gapped mask is not judged here — the decoder
/// already refuses it, and giving it a width here would invent one: zero is then returned, which
/// accuses nothing.
fn mask_width(mask: u32) -> u32 {
    if mask == 0 {
        return 0;
    }
    let width = (!(mask >> mask.trailing_zeros())).trailing_zeros();
    if width == mask.count_ones() {
        width
    } else {
        0
    }
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    let field = bytes.get(at..at + 2)?;
    Some(u16::from_le_bytes([field[0], field[1]]))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    let field = bytes.get(at..at + 4)?;
    Some(u32::from_le_bytes([field[0], field[1], field[2], field[3]]))
}
