//! Image driver contract: recognize a format, decode its pixels.
//!
//! One driver per format, selected by its extension or its magic number. What the registry does not
//! recognize comes back as a named report reason — never as a compilation failure: an unreadable
//! texture lets the engine fall back to white, it interrupts nothing.
use super::Plugin;
use std::path::Path;

pub(crate) mod blocks;
mod bmp;
mod crate_image;
mod dds;
mod decoded;
mod exr;
mod gif;
mod hdr;
mod icc;
mod jpeg;
mod ktx2;
mod png;
mod psd;
mod tga;
mod tiff;
mod webp;

pub use decoded::{ImageDecoded, Transfer};

/// Version of the image driver contract. Changing it requires rereading every driver, and
/// invalidates caches: since `image-plugin-3`, a driver returns an `ImageDecoded` — the pixels, the
/// transfer function the file declares, and named reasons for what it declared that the output
/// cannot carry.
pub const VERSION: &str = "image-plugin-3";

/// The registry: one driver per format. Adding a format means a module and a line here.
pub static DECODERS: &[&dyn ImageDecoder] = &[
    &png::PNG,
    &jpeg::JPEG,
    &tga::TGA,
    &tiff::TIFF,
    &dds::DDS,
    &webp::WEBP,
    &exr::EXR,
    &hdr::HDR,
    &ktx2::KTX2,
    &psd::PSD,
    &bmp::BMP,
    &gif::GIF,
];

/// What a driver returns as pixels. Two outputs, and no bridge from one to the other: reducing a
/// float to eight bits would require a tone-mapping curve, hence a loss the source did not have,
/// which the import policy forbids. A consumer that can only handle one variant refuses the other
/// with a named report reason. Both carry **straight alpha**: a format with associated alpha is
/// un-premultiplied by its driver, never returned as-is.
pub enum DecodedImage {
    /// RGBA 8 bits per channel, straight alpha, at least one pixel. `ImageDecoded::transfer` says
    /// which transfer function these bytes are written in: the contract no longer assumes sRGB.
    Rgba8(image::RgbaImage),
    /// RGBA 32-bit floats per channel, **linear** and straight alpha, at least one pixel: what
    /// high-dynamic-range formats return. `data` holds `width * height * 4` values, one pixel after
    /// another, top row first.
    RgbaF32 {
        width: u32,
        height: u32,
        data: Vec<f32>,
    },
}

/// A texture 2³² texels on a side has only thirty-three levels: beyond that, the field is lying.
/// `dds` and `ktx2` read this count from their respective headers and apply the same bound.
const MAX_LEVELS: u32 = 33;

/// Bytes occupied by one pixel of the float variant: four channels of four bytes.
const FLOAT_PIXEL_BYTES: u64 = 16;

/// Bytes occupied by one RGBA8 pixel.
const RGBA8_PIXEL_BYTES: u64 = 4;

/// The allocation ceiling of a surface, checked before decoding anything, at `pixel_bytes` bytes
/// per pixel. `saturating_mul` keeps the comparison honest when a dimension is lying, where an
/// overflowing multiply would let it through. Emptiness is not judged here: `dds` and `ktx2` refuse
/// it when reading their header, the float drivers in `float_budget`.
fn surface_budget(
    width: u32,
    height: u32,
    pixel_bytes: u64,
    max_alloc: u64,
    too_large: &'static str,
) -> std::result::Result<(), &'static str> {
    if u64::from(width)
        .saturating_mul(u64::from(height))
        .saturating_mul(pixel_bytes)
        > max_alloc
    {
        return Err(too_large);
    }
    Ok(())
}

/// What a float driver checks before allocating anything: an image of at least one pixel whose
/// surface fits under the received ceiling, counted at sixteen bytes per pixel. An overrun is a
/// report reason — the calling driver's — never an attempted allocation then a panic.
fn float_budget(
    width: u32,
    height: u32,
    max_alloc: u64,
    too_large: &'static str,
) -> std::result::Result<(), &'static str> {
    if width == 0 || height == 0 {
        return Err("image-empty");
    }
    surface_budget(width, height, FLOAT_PIXEL_BYTES, max_alloc, too_large)
}

/// An image driver. It never returns an empty image and never panics: an unexpected byte is a
/// report reason, a stable string that the manifest counts.
pub trait ImageDecoder: Plugin + Sync {
    /// MIME type published in the intermediate glTF for an image of this format.
    fn mime(&self) -> &'static str;
    /// Recognizes the format from its first bytes.
    fn accepts_head(&self, head: &[u8]) -> bool;
    /// Decodes under this allocation ceiling. A larger image is a refusal, not a panic.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str>;
}

/// The driver that claims this path's extension.
pub fn by_extension(path: &Path) -> Option<&'static dyn ImageDecoder> {
    let name = path.file_name()?.to_str()?;
    super::claiming(DECODERS, &super::extension_of(name)?)
}

/// The driver that recognizes these bytes.
pub fn by_head(bytes: &[u8]) -> Option<&'static dyn ImageDecoder> {
    DECODERS
        .iter()
        .copied()
        .find(|decoder| decoder.accepts_head(bytes))
}

/// Every extension in the registry, in driver order: that is the order in which a neighbouring
/// decodable file is looked up next to a texture we cannot read.
pub fn extensions() -> impl Iterator<Item = &'static str> {
    DECODERS
        .iter()
        .flat_map(|decoder| decoder.extensions().iter().copied())
}

/// Decodes bytes through the driver that recognizes them. A format outside the registry yields the
/// report reason `image-format-unknown`.
pub fn decode(bytes: &[u8], max_alloc: u64) -> std::result::Result<ImageDecoded, &'static str> {
    by_head(bytes)
        .ok_or("image-format-unknown")?
        .decode(bytes, max_alloc)
}
