//! Tiny KTX 2.0 of the golden, written here byte by byte from Khronos's public specification. No
//! encoder is called: the identifier, the nine header fields, the index of the three sections
//! and the level index are set by hand, and each block carries values whose exact decoding is
//! known. That is the only way to assert “lossless” without taking the decoder's word for it.
//!
//! These containers carry neither a format descriptor, nor keys, nor global supercompression
//! data: the driver does not read them when `vkFormat` names the codec, and the files of
//! `fixtures/ktx2/` cover the case where it reads them.

/// Absolute offsets of the fields the golden later modifies, identifier included.
pub(super) const FORMAT: usize = 12;
pub(super) const TYPE_SIZE: usize = 16;
pub(super) const WIDTH: usize = 20;
pub(super) const HEIGHT: usize = 24;
pub(super) const DEPTH: usize = 28;
pub(super) const LAYERS: usize = 32;
pub(super) const FACES: usize = 36;
pub(super) const LEVELS: usize = 40;
pub(super) const SUPERCOMPRESSION: usize = 44;
/// End of the fixed header, index of the three sections included; then the start of the level
/// index.
pub(super) const HEADER_END: usize = 80;
/// An entry of the level index: offset, length, length once decompressed.
const LEVEL_ENTRY: usize = 24;

/// Twelve identifier bytes: “KTX 20” between French quotes, CR, LF, SUB, LF.
const MAGIC: [u8; 12] = [
    0xab, b'K', b'T', b'X', b' ', b'2', b'0', 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
];

fn put(into: &mut Vec<u8>, value: u32) {
    into.extend_from_slice(&value.to_le_bytes());
}

fn put64(into: &mut Vec<u8>, value: u64) {
    into.extend_from_slice(&value.to_le_bytes());
}

/// A one-level container, without supercompression: the case almost the whole golden wants, and
/// the one refusals then modify field by field.
pub(super) fn container(format: u32, width: u32, height: u32, level: &[u8]) -> Vec<u8> {
    chain(format, width, height, level, 1)
}

/// The same, whose header announces `levels` levels while only one is written: extra entries
/// point beyond the end of the file, so the announced chain lies.
pub(super) fn chain(format: u32, width: u32, height: u32, level: &[u8], levels: u32) -> Vec<u8> {
    described(format, width, height, level, levels, None, &[])
}

/// The same container, with the format descriptor and the keys the driver reads to know what
/// the file declares around its pixels. `dfd` gives the `transferFunction` and the `flags` of
/// the basic block; `keys` gives the key-value section entries, in order.
pub(super) fn described(
    format: u32,
    width: u32,
    height: u32,
    level: &[u8],
    levels: u32,
    dfd: Option<(u8, u8)>,
    keys: &[(&str, &str)],
) -> Vec<u8> {
    let count = levels.max(1) as usize;
    let descriptor = dfd.map(|(transfer, flags)| block(transfer, flags));
    let pairs = key_values(keys);
    let index = HEADER_END + count * LEVEL_ENTRY;
    let dfd_at = descriptor.as_ref().map_or(0, |_| index);
    let dfd_len = descriptor.as_ref().map_or(0, Vec::len);
    let kvd_at = if pairs.is_empty() { 0 } else { index + dfd_len };
    let data = index + dfd_len + pairs.len();
    let mut out = Vec::with_capacity(data + level.len());
    out.extend_from_slice(&MAGIC);
    for value in [format, 1, width, height, 0, 0, 1, levels, 0] {
        put(&mut out, value);
    }
    for value in [
        dfd_at as u32,
        dfd_len as u32,
        kvd_at as u32,
        pairs.len() as u32,
    ] {
        put(&mut out, value);
    }
    for _ in 0..2 {
        put64(&mut out, 0);
    }
    for value in [data as u64, level.len() as u64, level.len() as u64] {
        put64(&mut out, value);
    }
    for extra in 1..count {
        for value in [(data + level.len() + extra * 16) as u64, 16, 16] {
            put64(&mut out, value);
        }
    }
    out.extend_from_slice(&descriptor.unwrap_or_default());
    out.extend_from_slice(&pairs);
    out.extend_from_slice(level);
    out
}

/// Format descriptor, reduced to its basic block without a sample: its total size, then the
/// block itself — vendor identifier and type, version and block size, colour model, primaries,
/// transfer function, flags, texel-block geometry and plane weights. Only the two middle bytes
/// interest the driver.
fn block(transfer: u8, flags: u8) -> Vec<u8> {
    let mut out = Vec::new();
    put(&mut out, 28);
    put(&mut out, 0);
    put(&mut out, 24 << 16 | 2);
    // RGB model with alpha, BT.709 primaries, then the transfer function and flags.
    out.extend_from_slice(&[1, 1, transfer, flags]);
    out.extend_from_slice(&[0; 12]);
    out
}

/// Key-value section: each entry carries its length on four bytes, then its key terminated by a
/// zero, then its value terminated by a zero, the whole padded to a multiple of four.
fn key_values(keys: &[(&str, &str)]) -> Vec<u8> {
    let mut out = Vec::new();
    for (key, value) in keys {
        let mut entry = Vec::from(key.as_bytes());
        entry.push(0);
        entry.extend_from_slice(value.as_bytes());
        entry.push(0);
        put(&mut out, entry.len() as u32);
        out.extend_from_slice(&entry);
        while out.len() % 4 != 0 {
            out.push(0);
        }
    }
    out
}

/// The same file, a thirty-two-bit word replaced. Refusals are written that way: a valid
/// container, then exactly the field the case puts in fault.
pub(super) fn patched(mut file: Vec<u8>, at: usize, value: u32) -> Vec<u8> {
    file[at..at + 4].copy_from_slice(&value.to_le_bytes());
    file
}

/// The same file, a sixty-four-bit word of the level index replaced.
pub(super) fn patched64(mut file: Vec<u8>, at: usize, value: u64) -> Vec<u8> {
    file[at..at + 8].copy_from_slice(&value.to_le_bytes());
    file
}

/// A 4 × 4 BC1 block: two 565 bounds then sixteen two-bit indices. When `first` is less than
/// `second`, the specification puts the block in three colours, and index 3 names a transparent
/// black texel there — that is what separates `BC1_RGB` from `BC1_RGBA`.
pub(super) fn bc1(first: u16, second: u16, indices: [u8; 16]) -> Vec<u8> {
    let mut block = Vec::from(first.to_le_bytes());
    block.extend_from_slice(&second.to_le_bytes());
    for row in indices.chunks(4) {
        block.push(row[0] | row[1] << 2 | row[2] << 4 | row[3] << 6);
    }
    block
}

/// An ASTC 4 × 4 “void extent” block: the specification reserves it for a unique colour, and
/// its four channels are written there in the open on sixteen bits each. No interpolation
/// therefore enters the reference — the block is exactly the colour put in it.
pub(super) fn astc_void_extent(color: [u8; 4]) -> Vec<u8> {
    let mut block = vec![0xfc, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    for channel in color {
        block.extend_from_slice(&[channel, channel]);
    }
    block
}

/// A one-channel EAC block, written from the OpenGL ES 3.0 specification: the eight-bit base
/// word, then the multiplier and the modifier table on four bits each, then sixteen three-bit
/// indices — texel 0 in the high bits of the remaining forty-eight. Texels follow there column
/// by column: texel `n` is at column `n / 4`, row `n % 4`.
pub(super) fn eac(base: u8, multiplier: u8, table: u8, indices: [u8; 16]) -> Vec<u8> {
    let mut field = 0u64;
    for (texel, index) in indices.into_iter().enumerate() {
        field |= u64::from(index & 7) << (45 - 3 * texel);
    }
    let mut block = vec![base, multiplier << 4 | (table & 0xf)];
    block.extend_from_slice(&field.to_be_bytes()[2..]);
    block
}
