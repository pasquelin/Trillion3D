//! KTX 2.0 driver, Khronos's texture container, read from the public specification
//! "KTX File Format Specification, version 2.0": twelve-byte identifier, fourteen-field
//! header, section index and level index, all written by hand from that document. No vendor
//! SDK or code.
//!
//! Three permissive libraries do the rest, each on one matter:
//!
//! - `basisu` 0.1.0 (Apache-2.0, `marcogomez/basisu`, pure Rust, no `cc` or C++) transcodes
//!   Basis Universal payloads — ETC1S under BasisLZ supercompression, UASTC LDR 4 × 4 — to
//!   RGBA8. It is a port of Binomial's reference transcoder, verified byte for byte against it.
//! - `texture2ddecoder` 0.1.2 (MIT or Apache-2.0) expands blocks already compressed for the
//!   GPU, through the `image::blocks` base this driver shares with `dds`: the codec is named
//!   by `vkFormat` here and by `dwFourCC` there, but walking the pixels is the same work. The
//!   two unsigned EAC formats are an exception: `eac.rs`, written here from the OpenGL ES 3.0
//!   specification, expands them to eleven bits then rounds — the external decoder truncated
//!   them and read their index field backwards.
//! - `ruzstd` 0.7.3 (MIT, pure Rust) undoes a level's Zstandard supercompression.
//!
//! **No extra loss is added.** An ETC1S, UASTC or BCn payload has already lost what it had to
//! lose at its encoder; the driver only does the reconstruction the codec specification
//! defines, with no filter, no extra rounding, no re-encoding. The source is never modified.
//!
//! **Decoding is a fallback, not the destination.** The repository rule is that a texture
//! received already compressed for the GPU keeps its compressed blocks on the GPU when the
//! machine accepts them. This batch does not build that chain — transport, atlas and GPU are
//! another job — and the `DecodedImage` contract has only an `Rgba8` variant. The driver is
//! split to welcome it: `header` returns the surface and the bounds of its level 0, `format`
//! names the codec and its block geometry, `level` and `basis` are only the reconstruction.
//!
//! **What the file declares around its texels** is read, not skipped: `dfd` returns the
//! transfer function and the premultiplied-alpha flag of the format descriptor, `keys`
//! returns the `KTXorientation` and `KTXswizzle` keys, and `declared` applies what applies —
//! un-premultiply, vertical flip — counting the rest as a named reason.
//!
//! Only level 0 is consumed, as in `dds`; the announced chain is checked whole, a level that
//! falls outside the file is a refusal. Everything else — cubes, arrays, volumes, `vkFormat`
//! off the list, unknown supercompression, truncated file, exceeded allocation ceiling — is a
//! named refusal, never a panic: an unreadable texture lets the engine fall back to white.
use super::{ImageDecoded, ImageDecoder, Plugin};

mod basis;
mod declared;
mod dfd;
mod eac;
mod format;
mod header;
mod keys;
mod level;

pub(super) static KTX2: Ktx2 = Ktx2;
pub(super) struct Ktx2;

/// Twelve identifier bytes that every KTX 2.0 carries at the front: "KTX 20" between French
/// quotes, then carriage return, newline, substitute and newline.
const MAGIC: &[u8] = b"\xabKTX 20\xbb\r\n\x1a\n";

/// Fewer bytes than the header and its level index require.
const HEADER_TRUNCATED: &str = "ktx2-header-truncated";
/// A header present but out of domain: null width, unexpected `typeSize`, absurd levels.
const HEADER_INVALID: &str = "ktx2-header-invalid";
/// A `vkFormat` outside the declared list. The driver never guesses: it refuses by naming it.
const FORMAT_UNSUPPORTED: &str = "ktx2-format-unsupported";
/// A layout outside the simple plane: cube, array, volume, one-dimensional texture.
const LAYOUT_UNSUPPORTED: &str = "ktx2-layout-unsupported";
/// A `supercompressionScheme` outside the three declared — ZLIB and future numbers.
const SUPERCOMPRESSION_UNSUPPORTED: &str = "ktx2-supercompression-unsupported";
/// The header is consistent but the announced bytes are not all there.
const DATA_TRUNCATED: &str = "ktx2-data-truncated";
/// The image exceeds the received allocation ceiling: a refusal, never an attempted allocation.
const TOO_LARGE: &str = "ktx2-image-too-large";
/// A Basis Universal payload the transcoder refuses: codec off the list, video, corrupt stream.
const TRANSCODE_FAILED: &str = "ktx2-transcode-failed";
/// The `KTXorientation` key asks for a direction the driver cannot bring back to the
/// contract's — a start to the left, a third dimension. Counted, never applied wrongly.
const ORIENTATION_UNSUPPORTED: &str = "ktx2-orientation-unsupported";
/// The `KTXswizzle` key asks for a channel permutation other than identity. Counted likewise.
const SWIZZLE_UNSUPPORTED: &str = "ktx2-swizzle-unsupported";

impl Plugin for Ktx2 {
    fn name(&self) -> &'static str {
        "ktx2"
    }
    /// The three readers enter the version: changing one of them changes what the driver
    /// returns, hence the cache identity. The suffix names the EAC decoder written here, for
    /// the same reason: an entry written in the external-decoder era carries mixed and
    /// truncated texels, and would without it be reread as if it were correct.
    fn version(&self) -> &'static str {
        "ktx2-basisu-0.1.0-texture2ddecoder-0.1.2-ruzstd-0.7.3-eac11-dfd-cles"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["ktx2"]
    }
}

impl ImageDecoder for Ktx2 {
    fn mime(&self) -> &'static str {
        "image/ktx2"
    }
    /// The identifier is enough: these twelve bytes belong only to this container. Header
    /// consistency is checked at decode, where it is reported instead of silencing the driver.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(MAGIC)
    }
    /// Two paths, which the header alone separates: a named `vkFormat` designates a codec of
    /// the `format` registry, and `VK_FORMAT_UNDEFINED` announces a Basis Universal payload
    /// described by the format descriptor that `basisu` rereads.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        let surface = header::parse(bytes)?;
        let mut image = if surface.format == format::UNDEFINED {
            basis::decode(&surface, bytes, max_alloc)?
        } else {
            level::decode(&surface, bytes, max_alloc)?
        };
        let notes = declared::apply(&mut image, surface.premultiplied, bytes);
        Ok(ImageDecoded::new(image, surface.transfer).with_notes(notes))
    }
}
