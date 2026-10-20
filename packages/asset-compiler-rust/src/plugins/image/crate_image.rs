//! Shared base of the drivers served by the `image` crate, whose features are declared one by one
//! in `Cargo.toml`: a format missing from the features does not decode, even if its bytes can be
//! guessed.
//!
//! The format is imposed by the calling driver, never guessed here: the registry designated the
//! driver, and it alone decides what it accepts.
//! The allocation ceiling applies to the **returned** image: these drivers all return RGBA8, so
//! width times height times four bytes. Dimensions are read from the header, under the same
//! ceiling, before any pixel is decoded: a three-byte file that expands to four would otherwise
//! pass under a ceiling of three.
use super::{budget, DecodedImage, ImageDecoded, Transfer, RGBA8_PIXEL_BYTES};

/// An animation is not a texture: refused, never flattened, whichever format carries it.
pub(super) const ANIMATED: &str = "image-animation-unsupported";
/// The image, once expanded to RGBA8, asks for more than the received allocation ceiling.
const TOO_LARGE: &str = "image-too-large";

/// The crate's reader of `bytes` in `format`, under `max_alloc` when given, else under the
/// crate's own default limits.
fn reader(
    bytes: &[u8],
    format: image::ImageFormat,
    max_alloc: Option<u64>,
) -> image::ImageReader<std::io::Cursor<&[u8]>> {
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    if let Some(max_alloc) = max_alloc {
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(max_alloc);
        reader.limits(limits);
    }
    reader
}

/// Dimensions from the header alone, as `reader` reads it.
pub(super) fn dimensions(
    bytes: &[u8],
    format: image::ImageFormat,
    max_alloc: Option<u64>,
) -> std::result::Result<(u32, u32), &'static str> {
    reader(bytes, format, max_alloc)
        .into_dimensions()
        .map_err(|_| "image-decode-failed")
}

pub(super) fn decode(
    bytes: &[u8],
    max_alloc: u64,
    format: image::ImageFormat,
) -> std::result::Result<ImageDecoded, &'static str> {
    let (width, height) = dimensions(bytes, format, Some(max_alloc))?;
    budget(width, height, RGBA8_PIXEL_BYTES, max_alloc, TOO_LARGE)?;
    let decoded = reader(bytes, format, Some(max_alloc))
        .decode()
        .map_err(|_| "image-decode-failed")?;
    Ok(ImageDecoded::new(
        DecodedImage::Rgba8(decoded.into_rgba8()),
        Transfer::Srgb,
    ))
}
