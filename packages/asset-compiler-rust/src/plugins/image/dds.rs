//! DDS driver (DirectDraw Surface), read from Microsoft's public specification
//! "DDS — Programming Guide" (`DDS_HEADER`, `DDS_PIXELFORMAT`, `DDS_HEADER_DXT10`,
//! `DXGI_FORMAT` enumeration), written by hand from that documentation: no vendor SDK or code.
//! Compressed blocks are expanded by the `texture2ddecoder` 0.1.2 crate (MIT or Apache-2.0,
//! `UniversalGameExtraction/texture2ddecoder`, pure Rust, notices kept with the dependency).
//!
//! **No extra loss is added.** A BCn DDS has already lost what it had to lose at its encoder;
//! the driver only does the integer interpolation the specification defines, block by block,
//! with no filter, no extra rounding, no re-encoding. The source file is never modified.
//!
//! **Decoding is a fallback, not the destination.** The repository rule is that a texture
//! received already compressed for the GPU keeps its compressed blocks on the GPU when the
//! machine accepts them. This batch does not build that chain — transport, atlas and GPU are
//! another job. `DecodedImage` currently has two variants, `Rgba8` and `RgbaF32`
//! (`image-plugin-2`), and this driver only returns the first. What will need adding, exactly:
//! a third variant `DecodedImage::Blocks { codec, width, height, data }`, a `match` at the
//! consumer (`src/texture_preview.rs:134`, today `Rgba8` read and `RgbaF32` refused by
//! `image-float-unsupported`) that asks for it explicitly, and a driver that returns it. The
//! driver is already split for that: `codec` names the codec and its block geometry, `header`
//! returns the surface and the offset of its raw bytes, `blocks` is only the reconstruction —
//! the only part that will become the fallback. BC6H (float HDR) therefore no longer waits on
//! the contract, which already has its float output: it waits on this `Blocks` variant, like
//! the other raw codecs.
//!
//! Codecs declared one by one: BC1, BC2, BC3, BC4, BC5, BC7, and the uncompressed surfaces
//! RGBA8, BGRA8 and BGRX8. Everything else — float BC6H, signed variants, premultiplied-alpha
//! `DXT2`/`DXT4`, 16-bit formats, YUV, cubes, volumes, arrays — is a named refusal, never a
//! panic: an unreadable texture lets the engine fall back to white.
use super::{ImageDecoded, ImageDecoder, Plugin};

mod blocks;
mod codec;
mod header;

pub(super) static DDS: Dds = Dds;
pub(super) struct Dds;

/// Four-byte magic number that every DDS carries before its header.
const MAGIC: &[u8] = b"DDS ";

/// Fewer bytes than the header requires: the file is cut before it has said everything.
const HEADER_TRUNCATED: &str = "dds-header-truncated";
/// A header present but out of domain: announced size wrong, null dimension, absurd mips.
const HEADER_INVALID: &str = "dds-header-invalid";
/// A codec outside the declared list. The driver never guesses: it refuses by naming it.
const CODEC_UNSUPPORTED: &str = "dds-codec-unsupported";
/// A layout outside the simple plane: cube, volume, array, unexpected stride.
const LAYOUT_UNSUPPORTED: &str = "dds-layout-unsupported";
/// The header is consistent but the announced pixels are not all there.
const DATA_TRUNCATED: &str = "dds-data-truncated";
/// The image exceeds the received allocation ceiling: a refusal, never an attempted allocation.
const TOO_LARGE: &str = "dds-image-too-large";

impl Plugin for Dds {
    fn name(&self) -> &'static str {
        "dds"
    }
    /// The suffix names the transfer function carried through to the output. It was added with
    /// it, because the version enters the cache identity: an entry written when every surface
    /// was returned as sRGB carries a preview decoded twice.
    fn version(&self) -> &'static str {
        "dds-texture2ddecoder-0.1.2-transfert"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["dds"]
    }
}

impl ImageDecoder for Dds {
    fn mime(&self) -> &'static str {
        "image/vnd.ms-dds"
    }
    /// The magic number is enough: it belongs only to this container. Header consistency is
    /// checked at decode, where it is reported instead of silencing the driver.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(MAGIC)
    }
    /// Only level 0 is consumed; the announced mip chain is counted and must fit in the file —
    /// a DDS that promises nine levels and carries only two is truncated, not half-good.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        let surface = header::parse(bytes)?;
        let image = blocks::decode(&surface, bytes, max_alloc)?;
        Ok(ImageDecoded::new(image, surface.transfer))
    }
}
