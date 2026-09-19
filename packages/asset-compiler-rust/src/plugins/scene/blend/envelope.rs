//! The wrapping of a Blender file, and what its header announces.
//!
//! A file may arrive bare, in a gzip frame (older versions) or in a Zstandard frame (the default
//! since Blender 3). The two libraries used only decompress, under a given ceiling, and nothing
//! is re-encoded.
//!
//! The header comes next: the seven `BLENDER` bytes, the pointer size, the endianness and the
//! version. The old layout fits in twelve bytes; the recent one first announces its header length
//! in decimal digits, then a block variant. This reader only reads eight-byte little-endian
//! pointers, and refuses the rest by name rather than reading it askew.
use super::*;
use std::io::Read;

pub(super) const MAGIC: &[u8] = b"BLENDER";
const GZIP: &[u8] = b"\x1f\x8b";
const ZSTD: &[u8] = b"\x28\xb5\x2f\xfd";
/// The only sixty-four-bit block variant this reader knows how to read.
const WIDE_VARIANT: u32 = 1;
/// The recent header length, the only one this reader describes.
const WIDE_LENGTH: usize = 17;

/// What the header announces, once the wrapping is undone.
pub(super) struct Shape {
    pub(super) header: usize,
    pub(super) pointer: usize,
    pub(super) wide: bool,
    pub(super) version: u32,
}

fn truncated() -> CompilerError {
    refused(
        "blend-truncated",
        "blend: the compressed frame carrying this file does not read back to its end",
    )
}

/// The ceiling, checked on the unpacked bytes: the same help for the three wrappings, for a bare
/// file, measured before being copied, and for what is read from disk.
pub(super) fn within(length: usize, ceiling: usize) -> Result<()> {
    if length > ceiling {
        return Err(refused(
            "blend-too-large",
            format!("blend: {length} bytes go past the {ceiling}-byte ceiling this reader admits"),
        ));
    }
    Ok(())
}

/// Undoes the wrapping: a bare file passes as-is, a gzip or Zstandard stream is decompressed.
/// The ceiling applies to the unpacked bytes, whatever the wrapping.
pub(super) fn unwrap(raw: &[u8], ceiling: usize) -> Result<Vec<u8>> {
    if raw.starts_with(MAGIC) {
        within(raw.len(), ceiling)?;
        return Ok(raw.to_vec());
    }
    let mut out = Vec::new();
    if raw.starts_with(GZIP) {
        flate2::read::MultiGzDecoder::new(raw)
            .take(ceiling as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|_| truncated())?;
    } else if raw.starts_with(ZSTD) {
        zstandard(raw, ceiling, &mut out)?;
    } else {
        return Err(refused(
            "blend-header-invalid",
            "blend: this file starts neither with BLENDER nor with a gzip or Zstandard frame",
        ));
    }
    within(out.len(), ceiling)?;
    Ok(out)
}

/// A Zstandard stream is a **sequence** of frames, and the specification admits skippable frames
/// there — Blender writes one, which carries its seek table. The decoder used only reads one
/// frame at a time: they are therefore chained here, skipping a skippable frame at the length it
/// announces. Nothing is trusted unbounded: the remaining ceiling limits each frame.
fn zstandard(raw: &[u8], ceiling: usize, out: &mut Vec<u8>) -> Result<()> {
    /// The magic number of a data frame, and that of a skippable frame, whose last four bits are free.
    const FRAME: u32 = 0xFD2F_B528;
    const SKIPPABLE: u32 = 0x184D_2A50;
    let word = |bytes: &[u8]| u32::from_le_bytes(bytes.try_into().unwrap_or_default());
    let mut rest = raw;
    while let Some(magic) = rest.get(..4).map(&word) {
        if magic & 0xFFFF_FFF0 == SKIPPABLE {
            let length = word(rest.get(4..8).ok_or_else(truncated)?) as usize;
            rest = rest.get(8 + length..).ok_or_else(truncated)?;
            continue;
        }
        if magic != FRAME {
            break;
        }
        let room = (ceiling + 1).saturating_sub(out.len()) as u64;
        if room == 0 {
            break;
        }
        let mut source = rest;
        let mut decoder = ruzstd::StreamingDecoder::new(&mut source).map_err(|_| truncated())?;
        decoder
            .by_ref()
            .take(room)
            .read_to_end(out)
            .map_err(|_| truncated())?;
        drop(decoder);
        if source.len() == rest.len() {
            return Err(truncated());
        }
        rest = source;
    }
    Ok(())
}

/// Reads the header and yields the shape of the file.
pub(super) fn head(bytes: &[u8]) -> Result<Shape> {
    let invalid = || refused("blend-header-invalid", "blend: unreadable BLENDER header");
    if !bytes.starts_with(MAGIC) || bytes.len() < 12 {
        return Err(invalid());
    }
    let digits = |from: usize, len: usize| -> Option<u32> {
        std::str::from_utf8(bytes.get(from..from + len)?)
            .ok()?
            .parse()
            .ok()
    };
    let legacy = bytes[7] == b'_' || bytes[7] == b'-';
    let (header, pointer, variant, endian, version) = if legacy {
        (12, bytes[7], WIDE_VARIANT, bytes[8], digits(9, 3))
    } else {
        let header = digits(7, 2).ok_or_else(invalid)? as usize;
        if bytes.len() < header || header != WIDE_LENGTH {
            return Err(invalid());
        }
        let variant = digits(10, 2).ok_or_else(invalid)?;
        (header, bytes[9], variant, bytes[12], digits(13, 4))
    };
    if variant != WIDE_VARIANT {
        return Err(refused(
            "blend-block-header-unsupported",
            format!("blend: block header variant {variant} is outside what this reader describes"),
        ));
    }
    if pointer != b'-' {
        return Err(refused(
            "blend-pointer-size-unsupported",
            "blend: this file was written with 32-bit pointers; re-save it from a 64-bit Blender",
        ));
    }
    if endian != b'v' {
        return Err(refused(
            "blend-endianness-unsupported",
            "blend: this file is big-endian; only little-endian files are read",
        ));
    }
    Ok(Shape {
        header,
        pointer: 8,
        wide: !legacy,
        version: version.ok_or_else(invalid)?,
    })
}
