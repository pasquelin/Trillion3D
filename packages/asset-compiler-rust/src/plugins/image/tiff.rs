//! TIFF driver, read from the public specification "TIFF Revision 6.0" (Adobe Developers
//! Association, 3 June 1992) and decoded by the `image` crate (`tiff` feature, which embeds
//! the `tiff` crate, MIT, notices kept with the dependency). No vendor SDK, no re-encoding.
//!
//! TIFF is a field container rather than a format: it describes an uncompressed RGB8 as well
//! as a CCITT scan, a wrapped JPEG, a thirty-page document or a scientific 16-bit. The driver
//! therefore does not claim "TIFF": it **declares its profiles one by one**, reads the file's
//! IFD before any decode (`profile`), and refuses by naming anything that is not there.
//!
//! Profiles read, all to exact RGBA8:
//! - 8-bit greyscale, black at zero — the value is copied onto the three channels, alpha 255;
//! - 8-bit RGB — alpha 255;
//! - 8-bit RGBA with unassociated (straight) alpha — the four bytes pass as-is;
//! - compressions: none, LZW, Deflate (tags 8 and 32946), PackBits; all return the original
//!   bytes, none adds loss. Strips as well as tiles: it is the same image written another
//!   way, and the interleaved configuration is the only one accepted.
//!
//! Refused, named, never guessed: BigTIFF, multi-page, palette, CMYK, YCbCr, CIELab,
//! associated (premultiplied) alpha, planar configuration, JPEG-in-TIFF, CCITT, and any
//! depth other than 8 bits. 16-bit has its own reason: see `DEPTH`.
use super::{crate_image, ImageDecoded, ImageDecoder, Plugin};

mod profile;

pub(super) static TIFF: Tiff = Tiff;
pub(super) struct Tiff;

/// Unreadable header or IFD: for the host that is the same symptom as a failed decode, and
/// the texture falls back to white.
const UNREADABLE: &str = "image-decode-failed";
/// A valid TIFF, but outside the profiles this driver declares it reads.
const PROFILE: &str = "image-profile-unsupported";
/// A 16-bit-per-component TIFF. This is not an exotic profile: it is precision that
/// `DecodedImage` cannot yet carry, its only variant being RGBA8. Clipping it in silence
/// would add a loss the source did not have, which the import policy forbids. Accepting it
/// would need an `Rgba16` variant on the image contract and its explicit handling at every
/// consumer — `texture_preview` today, the preview pyramid next.
const DEPTH: &str = "image-depth-unsupported";

impl Plugin for Tiff {
    fn name(&self) -> &'static str {
        "tiff"
    }
    fn version(&self) -> &'static str {
        "tiff-image-0.25"
    }
    /// The two extensions of the same format: `.tif` comes from the three-letter limit,
    /// `.tiff` is the one today's tools put.
    fn extensions(&self) -> &'static [&'static str] {
        &["tif", "tiff"]
    }
}

impl ImageDecoder for Tiff {
    fn mime(&self) -> &'static str {
        "image/tiff"
    }
    /// Byte order then the magic number. BigTIFF (43) is recognized here even though it is
    /// refused at decode: better to name it than to let it come out as unknown format.
    fn accepts_head(&self, head: &[u8]) -> bool {
        matches!(
            head.get(..4),
            Some(b"II\x2a\x00" | b"MM\x00\x2a" | b"II\x2b\x00" | b"MM\x00\x2b")
        )
    }
    /// The profile first, the pixels next: what is not declared never reaches the decoder,
    /// and what does comes out byte for byte.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        profile::check(bytes)?;
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Tiff)
    }
}
