//! GIF driver, read from the public specification "Graphics Interchange Format, Version 89a"
//! (CompuServe, 1990) and decoded by the `gif` feature of the `image` 0.25.10 crate, which
//! delegates to the `gif` 0.14 and `color_quant` crates — pure Rust, MIT or Apache-2.0, notices
//! kept with the dependencies. No vendor code or SDK, no re-encoding.
//!
//! Unisys's patent on LZW compression, which made this format's legal history, expired
//! everywhere in 2004. Documentary note, not legal advice: the repository's legal policy is in
//! `FORMATS.md`.
//!
//! **Profiles read, all lossless to RGBA8.** The format is indexed by construction: each pixel
//! is a rank in a colour table, global or local to the image, and each entry of that table is
//! already 8-8-8. Carrying those colours to RGBA8 copies them, there is nothing to round.
//! Quantization happened at the encoder: it is in the source, this driver adds none. The index
//! declared transparent by a graphic-control extension becomes a null alpha, and its colour is
//! kept as-is — neither filled with white, nor premultiplied.
//!
//! **An animation is refused, not flattened.** A file that carries more than one image
//! descriptor comes back as a named refusal, by the animation reason common to the drivers:
//! picking which of its images is *the* texture would be arbitrary, and an animation is not a
//! texture. The count of ignored images is not published: the image contract names a reason
//! only on the refusal side, and the preview report only counts those.
//!
//! Block walking is done here, before any decode, because the decoder would otherwise return
//! the first image of an animation without anyone having asked.
use super::crate_image::{self, ANIMATED};
use super::{ImageDecoded, ImageDecoder, Plugin};

pub(super) static GIF: Gif = Gif;
pub(super) struct Gif;

/// Header and logical screen descriptor: six signature bytes, the size over four, the packed
/// field, the background index and the aspect ratio.
const SCREEN_DESCRIPTOR_END: usize = 13;
/// Packed field of the screen descriptor, whose high bit announces a global colour table and
/// whose three low bits its size.
const SCREEN_PACKED_AT: usize = 10;
/// Bit of a present colour table, in one packed field as in the other.
const COLOR_TABLE_FLAG: u8 = 0b1000_0000;
/// The three bits that give a colour table's size.
const COLOR_TABLE_SIZE_MASK: u8 = 0b0000_0111;
/// Introducer of an image descriptor, and length of the descriptor that follows: position,
/// dimensions and packed field.
const IMAGE_SEPARATOR: u8 = 0x2C;
const IMAGE_DESCRIPTOR_BYTES: usize = 9;
/// Introducer of an extension, followed by its label then its sub-blocks.
const EXTENSION_INTRODUCER: u8 = 0x21;
/// End of the stream: what follows no longer belongs to the format.
const TRAILER: u8 = 0x3B;

impl Plugin for Gif {
    fn name(&self) -> &'static str {
        "gif"
    }
    /// The suffix names the cut this driver holds: a single image, animation refused. It enters
    /// the cache identity because it is part of what the driver produces.
    fn version(&self) -> &'static str {
        "gif-image-0.25-une-image"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["gif"]
    }
}

impl ImageDecoder for Gif {
    fn mime(&self) -> &'static str {
        "image/gif"
    }
    /// The six-byte signature, in both its versions. 87a and 89a share the structure judged
    /// here: only the second knows extensions, which the walk crosses anyway.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a")
    }
    /// One image, and only one. Everything else — animation, truncated file, missing colour
    /// table — comes back as a named report reason, never as a panic or a compilation failure.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        if carries_several_images(bytes) {
            return Err(ANIMATED);
        }
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Gif)
    }
}

/// Walks the stream's blocks and says whether a *second* image descriptor appears.
///
/// Nothing is decoded: compressed-data sub-blocks are crossed by their lengths, and extensions
/// — graphic control, comment, text, application — by theirs. The walk stops at the first
/// missing byte, and then returns `false`: a truncated file is not an animation, and it is the
/// decoder's job to name it truncated. It only returns `true` on positive proof: a *second
/// image separator* actually read. That is enough, even when the descriptor it introduces is
/// cut — the file then does carry a second image, and it is as animation that it must be
/// refused, not as truncation.
fn carries_several_images(bytes: &[u8]) -> bool {
    let Some(mut at) = after_global_color_table(bytes) else {
        return false;
    };
    let mut seen_image = false;
    while let Some(&block) = bytes.get(at) {
        at += 1;
        match block {
            IMAGE_SEPARATOR => {
                if seen_image {
                    return true;
                }
                seen_image = true;
                let Some(next) = after_image_descriptor(bytes, at) else {
                    return false;
                };
                at = next;
            }
            // The extension's label, then its sub-blocks: none of them carry pixels.
            EXTENSION_INTRODUCER => {
                let Some(next) = after_sub_blocks(bytes, at + 1) else {
                    return false;
                };
                at = next;
            }
            TRAILER => return false,
            // A byte that introduces nothing known: the stream is no longer readable from here,
            // and the decoder will say so better than this walk.
            _ => return false,
        }
    }
    false
}

/// First byte after the logical screen descriptor and, if there is one, the global colour table
/// it announces.
fn after_global_color_table(bytes: &[u8]) -> Option<usize> {
    let packed = *bytes.get(SCREEN_PACKED_AT)?;
    Some(SCREEN_DESCRIPTOR_END + color_table_bytes(packed))
}

/// First byte after an image descriptor: the local colour table its packed field sometimes
/// announces, the initial code size, then its data sub-blocks.
fn after_image_descriptor(bytes: &[u8], at: usize) -> Option<usize> {
    // The packed field is the last of the descriptor's nine bytes, not the one that follows them.
    let packed = *bytes.get(at + IMAGE_DESCRIPTOR_BYTES - 1)?;
    let code_size_at = at + IMAGE_DESCRIPTOR_BYTES + color_table_bytes(packed);
    after_sub_blocks(bytes, code_size_at + 1)
}

/// Bytes occupied by a colour table from the packed field that announces it: three per entry,
/// and two to the power of the declared size plus one entries. Zero when there is none.
fn color_table_bytes(packed: u8) -> usize {
    if packed & COLOR_TABLE_FLAG == 0 {
        return 0;
    }
    3 * (1usize << ((packed & COLOR_TABLE_SIZE_MASK) + 1))
}

/// First byte after a run of sub-blocks: each announced by its length on one byte, the run
/// closed by a null length. Returns `None` if the file stops before that close.
fn after_sub_blocks(bytes: &[u8], mut at: usize) -> Option<usize> {
    loop {
        let length = *bytes.get(at)? as usize;
        at += 1;
        if length == 0 {
            return Some(at);
        }
        // The sub-block must be entirely there: otherwise the next length would be read from
        // bytes that do not exist, or worse, from the data of a truncated block.
        at = at.checked_add(length)?;
        if at > bytes.len() {
            return None;
        }
    }
}
