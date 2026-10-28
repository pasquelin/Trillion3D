//! The values a tree stores: the type a grid holds, its numbers decoded, the masks of its nodes and the blocks of
//! values they cover, with the inactive values a mask-compressed block leaves out.
use super::compress::{self, ACTIVE_MASK};
use super::cursor::Cursor;
use crate::Result;
use half::f16;

/// The ways a mask-compressed block records the inactive values it leaves out.
const NO_MASK_AND_ONE_INACTIVE_VAL: u8 = 2;
const MASK_AND_NO_INACTIVE_VALS: u8 = 3;
const MASK_AND_ONE_INACTIVE_VAL: u8 = 4;
const MASK_AND_TWO_INACTIVE_VALS: u8 = 5;
const NO_MASK_AND_ALL_VALS: u8 = 6;

/// What a node needs to read its values.
pub(super) struct Layout {
    pub(super) components: usize,
    /// The bytes of one component as the type holds it.
    pub(super) component_bytes: usize,
    /// Whether the grid quantized its floating-point values to half floats on disk.
    pub(super) from_half: bool,
    pub(super) compression: u32,
}

impl Layout {
    /// The bytes of one value as stored in a block of values.
    pub(super) fn stored_value_bytes(&self) -> usize {
        let component = if self.from_half && self.component_bytes >= 4 {
            2
        } else {
            self.component_bytes
        };
        self.components * component
    }

    /// One value as the type holds it, always its whole size.
    pub(super) fn read_value(&self, cursor: &mut Cursor) -> Result<[f32; 4]> {
        Ok(first4(&decode(
            cursor.bytes(self.components * self.component_bytes)?,
            self.component_bytes,
        )))
    }
}

pub(super) fn first4(values: &[f32]) -> [f32; 4] {
    let mut out = [0.0; 4];
    for (slot, value) in out.iter_mut().zip(values) {
        *slot = *value;
    }
    out
}

/// The numbers of `bytes`, `component_bytes` to a number.
fn decode(bytes: &[u8], component_bytes: usize) -> Vec<f32> {
    bytes
        .chunks_exact(component_bytes)
        .map(|chunk| match component_bytes {
            2 => f16::from_le_bytes([chunk[0], chunk[1]]).to_f32(),
            4 => f32::from_le_bytes(chunk.try_into().expect("four bytes")),
            _ => f64::from_le_bytes(chunk.try_into().expect("eight bytes")) as f32,
        })
        .collect()
}

/// The type of a grid's values from its tree's name (`Tree_float_5_4_3`): how many numbers a value
/// holds, how many bytes a number takes, and whether the name says the grid is stored as halves.
pub(super) fn parse_type(name: &str) -> Option<(usize, usize, bool)> {
    let (name, half) = match name.strip_suffix("_HalfFloat") {
        Some(rest) => (rest, true),
        None => (name, false),
    };
    let value = name.strip_prefix("Tree_")?.strip_suffix("_5_4_3")?;
    let (components, bytes) = match value {
        "float" => (1, 4),
        "double" => (1, 8),
        "half" => (1, 2),
        _ => {
            let rest = value.strip_prefix("vec")?;
            let components = rest.chars().next()?.to_digit(10)? as usize;
            let bytes = match rest.get(1..)? {
                "s" => 4,
                "d" => 8,
                "h" => 2,
                _ => return None,
            };
            if !(2..=4).contains(&components) {
                return None;
            }
            (components, bytes)
        }
    };
    Some((components, bytes, half))
}

/// A mask of `bits` bits, as the words the file stores.
pub(super) fn read_mask(cursor: &mut Cursor, bits: usize) -> Result<Vec<u64>> {
    let words = (bits / 64).max(1);
    let bytes = cursor.bytes(words * 8)?;
    Ok(bytes
        .chunks_exact(8)
        .map(|word| u64::from_le_bytes(word.try_into().expect("eight bytes")))
        .collect())
}

pub(super) fn is_on(mask: &[u64], bit: usize) -> bool {
    mask[bit >> 6] >> (bit & 63) & 1 != 0
}

fn count_on(mask: &[u64]) -> usize {
    mask.iter().map(|word| word.count_ones() as usize).sum()
}

/// The values a node stores for `count` positions, the ones of the active positions of `mask` only:
/// a byte that says which inactive values the block leaves out, those values, the mask that
/// selects between them, then the block of values.
pub(super) fn read_values(
    cursor: &mut Cursor,
    layout: &Layout,
    count: usize,
    mask: &[u64],
) -> Result<Vec<f32>> {
    let metadata = cursor.u8()?;
    if matches!(
        metadata,
        NO_MASK_AND_ONE_INACTIVE_VAL | MASK_AND_ONE_INACTIVE_VAL | MASK_AND_TWO_INACTIVE_VALS
    ) {
        cursor.skip(layout.components * layout.component_bytes)?;
        if metadata == MASK_AND_TWO_INACTIVE_VALS {
            cursor.skip(layout.components * layout.component_bytes)?;
        }
    }
    if matches!(
        metadata,
        MASK_AND_NO_INACTIVE_VALS | MASK_AND_ONE_INACTIVE_VAL | MASK_AND_TWO_INACTIVE_VALS
    ) {
        cursor.skip(mask.len() * 8)?;
    }
    let active = count_on(mask);
    let stored = if layout.compression & ACTIVE_MASK != 0 && metadata != NO_MASK_AND_ALL_VALS {
        active
    } else {
        count
    };
    let component_bytes = if layout.from_half && layout.component_bytes >= 4 {
        2
    } else {
        layout.component_bytes
    };
    // A block of no value that is read from halves has no size in front of it either.
    let values = if stored == 0 && layout.from_half && layout.component_bytes >= 4 {
        Vec::new()
    } else {
        let bytes = compress::block(
            cursor,
            stored * layout.stored_value_bytes(),
            layout.compression,
        )?;
        decode(&bytes, component_bytes)
    };
    if stored == active {
        return Ok(values);
    }
    let width = layout.components;
    let mut active_values = Vec::with_capacity(active * width);
    for position in (0..count).filter(|&bit| is_on(mask, bit)) {
        active_values.extend_from_slice(&values[position * width..(position + 1) * width]);
    }
    Ok(active_values)
}
