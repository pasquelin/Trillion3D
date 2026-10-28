//! The blocks of values a tree stores: raw, zlib, or Blosc over LZ4. A block starts with a signed
//! size of eight bytes — a positive one is the bytes of the compressed block that follow, zero or
//! negative the bytes of the block itself, uncompressed.
use super::cursor::Cursor;
use super::{invalid, unsupported};
use crate::Result;
use std::io::Read;

/// The compression flags a grid declares.
pub(super) const ZIP: u32 = 0x1;
pub(super) const ACTIVE_MASK: u32 = 0x2;
pub(super) const BLOSC: u32 = 0x4;

/// Reads the block of `size` bytes the cursor is at, decompressed. A grid that declares no
/// compression has no size in front of its blocks.
pub(super) fn block(cursor: &mut Cursor, size: usize, compression: u32) -> Result<Vec<u8>> {
    if compression & (ZIP | BLOSC) == 0 {
        return Ok(cursor.bytes(size)?.to_vec());
    }
    let stored = cursor.i64()?;
    if stored <= 0 {
        let length = stored.unsigned_abs() as usize;
        if length != size {
            return Err(invalid(
                "a block of values holds other bytes than its node needs",
            ));
        }
        return Ok(cursor.bytes(length)?.to_vec());
    }
    let packed = cursor.bytes(stored as usize)?;
    let bytes = if compression & BLOSC != 0 {
        blosc(packed)?
    } else {
        inflate(packed, size)?
    };
    if bytes.len() != size {
        return Err(invalid(
            "a block of values decompresses to other bytes than its node needs",
        ));
    }
    Ok(bytes)
}

fn inflate(packed: &[u8], size: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity(size);
    flate2::read::ZlibDecoder::new(packed)
        .read_to_end(&mut bytes)
        .map_err(|error| invalid(format!("a zlib block does not inflate: {error}")))?;
    Ok(bytes)
}

/// Decodes one block of LZ4 (no frame) into exactly `size` bytes appended to `out`.
fn lz4(packed: &[u8], size: usize, out: &mut Vec<u8>) -> Option<()> {
    let target = out.len() + size;
    let mut at = 0;
    let length = |at: &mut usize, mut base: usize| -> Option<usize> {
        if base == 15 {
            loop {
                let extra = *packed.get(*at)?;
                *at += 1;
                base += usize::from(extra);
                if extra != 255 {
                    break;
                }
            }
        }
        Some(base)
    };
    while at < packed.len() {
        let token = packed[at];
        at += 1;
        let literals = length(&mut at, usize::from(token >> 4))?;
        out.extend_from_slice(packed.get(at..at + literals)?);
        at += literals;
        if out.len() >= target {
            break;
        }
        let offset = usize::from(u16::from_le_bytes([*packed.get(at)?, *packed.get(at + 1)?]));
        at += 2;
        let copy = length(&mut at, usize::from(token & 15))? + 4;
        if offset == 0 || offset > out.len() {
            return None;
        }
        for _ in 0..copy {
            out.push(out[out.len() - offset]);
        }
    }
    (out.len() == target).then_some(())
}

/// The compression format of a Blosc block's inner codec.
const BLOSC_LZ4: u8 = 1;
/// Blosc header flags: the bytes were shuffled; the block is stored; the bytes were bit-shuffled;
/// the blocks are not split in streams.
const SHUFFLE: u8 = 0x1;
const STORED: u8 = 0x2;
const BIT_SHUFFLE: u8 = 0x4;
const DONT_SPLIT: u8 = 0x10;

fn word(bytes: &[u8], at: usize) -> Result<usize> {
    let slice = bytes
        .get(at..at + 4)
        .ok_or_else(|| invalid("a Blosc block is cut short"))?;
    Ok(u32::from_le_bytes(slice.try_into().expect("four bytes")) as usize)
}

/// Decodes a Blosc 1 buffer: a head of sixteen bytes (version, codec version, flags, the size of a
/// value, the bytes it decompresses to, the size of its blocks, its own bytes), the start of each
/// block, then the blocks, each in streams of `[size of the stream, the stream]`.
fn blosc(packed: &[u8]) -> Result<Vec<u8>> {
    let corrupt = || invalid("a Blosc block does not decompress");
    if packed.len() < 16 {
        return Err(corrupt());
    }
    let flags = packed[2];
    let type_size = usize::from(packed[3]).max(1);
    let total = word(packed, 4)?;
    let block_size = word(packed, 8)?;
    if flags & BIT_SHUFFLE != 0 {
        return Err(unsupported(
            "a Blosc block of bit-shuffled values is not read",
        ));
    }
    if flags & STORED != 0 {
        return Ok(packed.get(16..16 + total).ok_or_else(corrupt)?.to_vec());
    }
    if (flags >> 5) != BLOSC_LZ4 {
        return Err(unsupported(
            "a Blosc block of another codec than LZ4 is not read",
        ));
    }
    if block_size == 0 {
        return Err(corrupt());
    }
    let blocks = total.div_ceil(block_size);
    let leftover = total % block_size;
    let mut out = Vec::with_capacity(total);
    for block in 0..blocks {
        let start = word(packed, 16 + 4 * block)?;
        let last_partial = block + 1 == blocks && leftover > 0;
        let size = if last_partial { leftover } else { block_size };
        let streams = if flags & DONT_SPLIT == 0
            && type_size <= 16
            && block_size / type_size >= 128
            && !last_partial
        {
            type_size
        } else {
            1
        };
        let part = size / streams;
        let mut at = start;
        let mut decoded = Vec::with_capacity(size);
        for _ in 0..streams {
            let stream = word(packed, at)?;
            at += 4;
            let bytes = packed.get(at..at + stream).ok_or_else(corrupt)?;
            if stream == part {
                decoded.extend_from_slice(bytes);
            } else {
                lz4(bytes, part, &mut decoded).ok_or_else(corrupt)?;
            }
            at += stream;
        }
        if flags & SHUFFLE != 0 && type_size > 1 {
            unshuffle(&decoded, type_size, &mut out);
        } else {
            out.extend_from_slice(&decoded);
        }
    }
    Ok(out)
}

/// Undoes the byte shuffle: the bytes of a value lie apart, the first bytes of all the values
/// first; the bytes past the last whole value are not shuffled.
fn unshuffle(shuffled: &[u8], type_size: usize, out: &mut Vec<u8>) {
    let values = shuffled.len() / type_size;
    for value in 0..values {
        for byte in 0..type_size {
            out.push(shuffled[byte * values + value]);
        }
    }
    out.extend_from_slice(&shuffled[values * type_size..]);
}
