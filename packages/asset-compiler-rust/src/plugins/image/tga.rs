//! TGA driver (Truevision TARGA), read from the public specification "Truevision TGA File
//! Format Specification, Version 2.0" and decoded by the `image` crate (`tga` feature, MIT or
//! Apache-2.0, notices kept with the dependency). No vendor SDK, no re-encoding: the file is
//! read as-is to RGBA8, and the 32-bit alpha channel is kept byte for byte.
//!
//! TGA has no magic number at the front: version 1.0 starts directly with its eighteen-byte
//! header, and only version 2.0 puts a "TRUEVISION-XFILE." footer at the end of the file. The
//! driver therefore recognizes a TGA in two ways: its extension, through the registry, then
//! the structure of its header — each field in its domain and the fields consistent with each
//! other. The 2.0 footer, when the given bytes go that far, is enough on its own.
use super::{crate_image, ImageDecoded, ImageDecoder, Plugin};

pub(super) static TGA: Tga = Tga;
pub(super) struct Tga;

/// The eighteen header bytes, present in every version of the format.
const HEADER_BYTES: usize = 18;
/// Footer signature, specific to version 2.0 and absent from 1.0.
const FOOTER_SIGNATURE: &[u8] = b"TRUEVISION-XFILE.";
/// The complete footer: four extension-offset bytes, four developer-offset bytes, then the
/// signature and its trailing null byte.
const FOOTER_BYTES: usize = 26;

impl Plugin for Tga {
    fn name(&self) -> &'static str {
        "tga"
    }
    fn version(&self) -> &'static str {
        "tga-image-0.25"
    }
    /// `.tga` is the common extension; `.tpic` is the one Truevision tools and some exporters
    /// put, for the same format and the same header.
    fn extensions(&self) -> &'static [&'static str] {
        &["tga", "tpic"]
    }
}

impl ImageDecoder for Tga {
    fn mime(&self) -> &'static str {
        "image/x-tga"
    }
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.len() >= HEADER_BYTES && (header_is_coherent(head) || has_footer(head))
    }
    /// Profiles read losslessly: 24- and 32-bit true colour, 8-bit palette, 8-bit greyscale,
    /// each raw or RLE-compressed, origin top or bottom. 15/16-bit enters as RGB: its
    /// attribute bit is not a reliable alpha, the specification forbids reading it as such.
    /// Everything else — truncated file, depth outside the profile, unreadable palette —
    /// comes back as a report reason, never as a panic.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Tga)
    }
}

/// Version 2.0 footer, looked up only when the given bytes contain the end of the file. Its
/// absence proves nothing: a valid TGA 1.0 has none.
fn has_footer(bytes: &[u8]) -> bool {
    bytes.len() >= FOOTER_BYTES
        && bytes[bytes.len() - FOOTER_BYTES + 8..].starts_with(FOOTER_SIGNATURE)
}

/// The header, field by field then field against field. Its consistency is the only mark of a
/// TGA 1.0: better to refuse here than to claim the bytes of a neighbouring format.
fn header_is_coherent(head: &[u8]) -> bool {
    let map_type = head[1];
    let image_type = head[2];
    let map_length = u16::from_le_bytes([head[5], head[6]]);
    let map_entry_size = head[7];
    let width = u16::from_le_bytes([head[12], head[13]]);
    let height = u16::from_le_bytes([head[14], head[15]]);
    let depth = head[16];
    let descriptor = head[17];
    if map_type > 1 || width == 0 || height == 0 || descriptor & 0b1100_0000 != 0 {
        return false;
    }
    let mapped = matches!(image_type, 1 | 9);
    if mapped != (map_type == 1) {
        return false;
    }
    if mapped {
        // Paletted image: the palette exists, its entries have a format size, and the pixels
        // are one- or two-byte indices that fit in an entry.
        return map_length > 0
            && matches!(map_entry_size, 15 | 16 | 24 | 32)
            && matches!(depth, 8 | 16)
            && depth <= map_entry_size;
    }
    // Without a palette, both palette fields are null and depth follows the image type.
    if map_length != 0 || map_entry_size != 0 {
        return false;
    }
    match image_type {
        2 | 10 => matches!(depth, 15 | 16 | 24 | 32),
        3 | 11 => depth == 8,
        _ => false,
    }
}
