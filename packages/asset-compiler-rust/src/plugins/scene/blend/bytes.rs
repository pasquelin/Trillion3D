//! Reading numbers from the raw bytes of a block.
//!
//! A Blender data block is sometimes only a bare array — positions, corner indices, face offsets.
//! These three functions reread it assuming nothing more than the width of an element, and stop
//! at what the block actually carries.
use super::*;
use crate::le::{u16_at, u32_at, u64_at, words};

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
        (2, false) => i64::from(u16_at(bytes, 0)? as i16),
        (2, true) => i64::from(u16_at(bytes, 0)?),
        (4, false) => i64::from(u32_at(bytes, 0)? as i32),
        (4, true) => i64::from(u32_at(bytes, 0)?),
        (8, _) => u64_at(bytes, 0)? as i64,
        _ => return None,
    })
}

/// The floats of a raw block, at most `count`, bounded by what the block carries.
pub(super) fn floats(bytes: &[u8], count: usize) -> Vec<f32> {
    words(bytes, f32::from_le_bytes).take(count).collect()
}

/// The thirty-two-bit integers of a raw block, bounded the same way.
pub(super) fn ints(bytes: &[u8], count: usize) -> Vec<i32> {
    words(bytes, i32::from_le_bytes).take(count).collect()
}
