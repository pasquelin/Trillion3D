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
use super::{surface_budget, DecodedImage, ImageDecoded, Transfer, RGBA8_PIXEL_BYTES};

/// An animation is not a texture: refused, never flattened, whichever format carries it.
pub(super) const ANIMATED: &str = "image-animation-unsupported";
/// The image, once expanded to RGBA8, asks for more than the received allocation ceiling.
const TOO_LARGE: &str = "image-too-large";

pub(super) fn decode(
    bytes: &[u8],
    max_alloc: u64,
    format: image::ImageFormat,
) -> std::result::Result<ImageDecoded, &'static str> {
    let reader = || {
        let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes));
        reader.set_format(format);
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(max_alloc);
        reader.limits(limits);
        reader
    };
    let (width, height) = reader()
        .into_dimensions()
        .map_err(|_| "image-decode-failed")?;
    if width == 0 || height == 0 {
        return Err("image-empty");
    }
    surface_budget(width, height, RGBA8_PIXEL_BYTES, max_alloc, TOO_LARGE)?;
    let decoded = reader().decode().map_err(|_| "image-decode-failed")?;
    Ok(ImageDecoded::new(
        DecodedImage::Rgba8(decoded.into_rgba8()),
        Transfer::Srgb,
    ))
}
