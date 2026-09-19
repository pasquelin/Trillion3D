//! Reading the sections of the `DNA1` block, byte by byte.
//!
//! Each section announces a count; none is trusted without being bounded by what the block still
//! carries, and no product of dimensions or sizes is stored without being checked. A file that
//! lies about any of them is refused under `blend-dna-invalid`, never by a panic.
use super::{Field, Layout, POINTER};
use crate::plugins::scene::blend::{refused, CompilerError, Result};
use std::collections::HashMap;

fn invalid() -> CompilerError {
    refused(
        "blend-dna-invalid",
        "blend: the DNA1 block does not read back",
    )
}

/// A section tag, read where it must be.
pub(super) fn tag(bytes: &[u8], at: &mut usize, expected: &[u8; 4]) -> Result<()> {
    let found = bytes.get(*at..*at + 4).ok_or_else(invalid)?;
    if found != expected {
        return Err(invalid());
    }
    *at += 4;
    Ok(())
}

/// The count of a section, bounded by what the block can still carry: each entry weighs at least
/// `unit` bytes, so a count that does not fit in the rest of the block is a lie.
pub(super) fn count(bytes: &[u8], at: &mut usize, unit: usize) -> Result<usize> {
    let total = u32::from_le_bytes(word(bytes, at)?) as usize;
    let room = bytes.len().saturating_sub(*at);
    match total.checked_mul(unit) {
        Some(needed) if needed <= room => Ok(total),
        _ => Err(invalid()),
    }
}

pub(super) fn word<const N: usize>(bytes: &[u8], at: &mut usize) -> Result<[u8; N]> {
    let found: [u8; N] = bytes
        .get(*at..*at + N)
        .ok_or_else(invalid)?
        .try_into()
        .map_err(|_| invalid())?;
    *at += N;
    Ok(found)
}

/// A string section: its tag, its count, then the strings, all aligned on four.
pub(super) fn strings(bytes: &[u8], at: &mut usize, label: &[u8; 4]) -> Result<Vec<String>> {
    tag(bytes, at, label)?;
    // A string weighs at least its terminating zero: the count therefore fits in the rest of the block.
    let total = count(bytes, at, 1)?;
    let mut out = Vec::with_capacity(total);
    for _ in 0..total {
        let rest = bytes.get(*at..).ok_or_else(invalid)?;
        let end = rest
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(invalid)?;
        out.push(String::from_utf8_lossy(&rest[..end]).into_owned());
        *at += end + 1;
    }
    *at = (*at + 3) & !3;
    Ok(out)
}

/// A structure and its fields: offsets accumulate in declared order, a pointer always weighing
/// the file's pointer size, an array the product of its dimensions.
pub(super) fn layout(
    bytes: &[u8],
    at: &mut usize,
    names: &[String],
    types: &[String],
    lengths: &[usize],
) -> Result<Layout> {
    let kind = u16::from_le_bytes(word(bytes, at)?) as usize;
    let total = u16::from_le_bytes(word(bytes, at)?) as usize;
    let mut fields = HashMap::with_capacity(total);
    let mut offset = 0;
    for _ in 0..total {
        let kind = u16::from_le_bytes(word(bytes, at)?) as usize;
        let name = u16::from_le_bytes(word(bytes, at)?) as usize;
        let name = names.get(name).ok_or_else(invalid)?;
        let pointer = name.contains('*');
        let unit = if pointer {
            POINTER
        } else {
            *lengths.get(kind).ok_or_else(invalid)?
        };
        let count = elements(name).ok_or_else(invalid)?;
        fields.insert(
            key(name).to_string(),
            Field {
                offset,
                kind: types.get(kind).ok_or_else(invalid)?.clone(),
                unit,
                count,
                pointer,
            },
        );
        offset = unit
            .checked_mul(count)
            .and_then(|span| offset.checked_add(span))
            .ok_or_else(invalid)?;
    }
    // The size `TLEN` declares is authoritative — it is the stride of a structure array; the sum
    // of the fields is only used if the file declares none.
    let declared = lengths.get(kind).copied().unwrap_or(0);
    Ok(Layout {
        name: types.get(kind).ok_or_else(invalid)?.clone(),
        size: if declared > 0 { declared } else { offset },
        fields,
    })
}

/// The bare name of a field, without the stars, brackets or parentheses of a function pointer:
/// it is by this name that the reader asks for a field.
fn key(name: &str) -> &str {
    let start = name
        .find(|c: char| c.is_alphanumeric() || c == '_')
        .unwrap_or(name.len());
    let rest = &name[start..];
    let end = rest
        .find(|c: char| !(c.is_alphanumeric() || c == '_'))
        .unwrap_or(rest.len());
    &rest[..end]
}

/// The number of elements a field name declares: the product of its dimensions, one for a simple
/// field. Nothing when that product overflows — the name then lies about what the file carries.
fn elements(name: &str) -> Option<usize> {
    let mut total: usize = 1;
    let mut rest = name;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find(']') else {
            break;
        };
        let dimension = rest[open + 1..open + close].parse::<usize>().unwrap_or(1);
        total = total.checked_mul(dimension)?;
        rest = &rest[open + close + 1..];
    }
    Some(total)
}
