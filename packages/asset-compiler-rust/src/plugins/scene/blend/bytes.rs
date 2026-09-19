//! Reading numbers from the raw bytes of a block.
//!
//! A Blender data block is sometimes only a bare array — positions, corner indices, face offsets.
//! These three functions reread it assuming nothing more than the width of an element, and stop
//! at what the block actually carries.
use super::*;

/// An integer read at the width and signedness the SDNA declares.
pub(super) fn scalar(field: &Field, bytes: &[u8]) -> Option<i64> {
    if bytes.is_empty() {
        return None;
    }
    let unsigned = matches!(
        field.kind.as_str(),
        "uchar" | "ushort" | "uint" | "uint8_t" | "uint16_t" | "uint32_t" | "uint64_t"
    );
    Some(match (field.unit, unsigned) {
        (1, false) => i64::from(bytes[0] as i8),
        (1, true) => i64::from(bytes[0]),
        (2, false) => i64::from(i16::from_le_bytes(bytes[..2].try_into().ok()?)),
        (2, true) => i64::from(u16::from_le_bytes(bytes[..2].try_into().ok()?)),
        (4, false) => i64::from(i32::from_le_bytes(bytes[..4].try_into().ok()?)),
        (4, true) => i64::from(u32::from_le_bytes(bytes[..4].try_into().ok()?)),
        (8, _) => i64::from_le_bytes(bytes[..8].try_into().ok()?),
        _ => return None,
    })
}

/// The floats of a raw block, bounded by what the block carries.
pub(super) fn floats(bytes: &[u8], count: usize) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .take(count)
        .map(|word| f32::from_le_bytes(*word))
        .collect()
}

/// The thirty-two-bit integers of a raw block, bounded the same way.
pub(super) fn ints(bytes: &[u8], count: usize) -> Vec<i32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .take(count)
        .map(|word| i32::from_le_bytes(*word))
        .collect()
}
