//! Reading the sections of the `DNA1` block, byte by byte.
//!
//! Each section announces a count; none is trusted without being bounded by what the block still
//! carries, and no product of dimensions or sizes is stored without being checked. A file that
//! lies about any of them is refused under `blend-dna-invalid`, never by a panic.
use super::{Field, Layout, POINTER};
use crate::le::Cursor;
use crate::plugins::scene::blend::{refused, CompilerError, Result};
use std::collections::HashMap;

fn invalid() -> CompilerError {
    refused(
        "blend-dna-invalid",
        "blend: the DNA1 block does not read back",
    )
}

/// A section tag, read where it must be.
pub(super) fn tag(cursor: &mut Cursor<'_>, expected: &[u8; 4]) -> Result<()> {
    if cursor.take(4).ok_or_else(invalid)? != expected {
        return Err(invalid());
    }
    Ok(())
}

/// The next sixteen-bit field, as a count or an index.
pub(super) fn half(cursor: &mut Cursor<'_>) -> Result<usize> {
    cursor.u16().map(usize::from).ok_or_else(invalid)
}

/// The count of a section, bounded by what the block can still carry: each entry weighs at least
/// `unit` bytes, so a count that does not fit in the rest of the block is a lie.
pub(super) fn count(cursor: &mut Cursor<'_>, unit: usize) -> Result<usize> {
    let total = cursor.u32().ok_or_else(invalid)? as usize;
    let room = cursor.rest().len();
    match total.checked_mul(unit) {
        Some(needed) if needed <= room => Ok(total),
        _ => Err(invalid()),
    }
}

/// A string section: its tag, its count, then the strings, all aligned on four.
pub(super) fn strings(cursor: &mut Cursor<'_>, label: &[u8; 4]) -> Result<Vec<String>> {
    tag(cursor, label)?;
    // A string weighs at least its terminating zero: the count therefore fits in the rest of the block.
    let total = count(cursor, 1)?;
    let mut out = Vec::with_capacity(total);
    for _ in 0..total {
        let end = cursor
            .rest()
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(invalid)?;
        let text = cursor.take(end + 1).ok_or_else(invalid)?;
        out.push(String::from_utf8_lossy(&text[..end]).into_owned());
    }
    cursor.align(4);
    Ok(out)
}

/// A structure and its fields: offsets accumulate in declared order, a pointer always weighing
/// the file's pointer size, an array the product of its dimensions.
pub(super) fn layout(
    cursor: &mut Cursor<'_>,
    names: &[String],
    types: &[String],
    lengths: &[usize],
) -> Result<Layout> {
    let kind = half(cursor)?;
    let total = half(cursor)?;
    let mut fields = HashMap::with_capacity(total);
    let mut offset = 0;
    for _ in 0..total {
        let kind = half(cursor)?;
        let name = half(cursor)?;
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
