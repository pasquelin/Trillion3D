//! Key-value section of a KTX 2.0, and the two keys this driver reads.
//!
//! Khronos's specification describes it entry by entry: each entry carries its length over
//! four bytes, then its null-terminated key, then its value, the whole padded to a multiple
//! of four. Keys there are UTF-8 strings; those this module looks up carry ASCII values of a
//! few characters.
//!
//! `KTXorientation` says in which direction the file wrote its texels — `rd`, to the right
//! and downward, is the image-contract orientation. `KTXswizzle` says which channel
//! permutation to apply before reading the colour. Ignoring them without a word flipped a
//! texture or swapped its channels with nothing signalling it.
use std::collections::BTreeMap;

/// The two header words that name the section: its offset then its length.
const OFFSET: usize = 56;
const LENGTH: usize = 60;
/// Length of an entry, over four bytes, and the multiple they align on.
const ENTRY_LENGTH: usize = 4;
const ALIGN: usize = 4;

/// Keys this driver reads, with their value as the file writes it.
pub(super) const ORIENTATION: &str = "KTXorientation";
pub(super) const SWIZZLE: &str = "KTXswizzle";

/// The section's entries, by their key. A missing, truncated or misaligned section returns
/// an empty table: this module refuses nothing, it reads what is readable.
pub(super) fn read(bytes: &[u8]) -> BTreeMap<&str, &str> {
    let mut out = BTreeMap::new();
    let Some(mut rest) = section(bytes) else {
        return out;
    };
    while let Some(entry) = next(&mut rest) {
        let mut parts = entry.splitn(2, |byte| *byte == 0);
        let (Some(key), Some(value)) = (parts.next(), parts.next()) else {
            continue;
        };
        if let (Ok(key), Ok(value)) = (str::from_utf8(key), str::from_utf8(trimmed(value))) {
            out.entry(key).or_insert(value);
        }
    }
    out
}

/// The key-value section as the header names it, bounded by the file length.
fn section(bytes: &[u8]) -> Option<&[u8]> {
    let word = |at: usize| {
        let field: [u8; 4] = bytes.get(at..at + 4)?.try_into().ok()?;
        usize::try_from(u32::from_le_bytes(field)).ok()
    };
    let (at, length) = (word(OFFSET)?, word(LENGTH)?);
    bytes.get(at..at.checked_add(length)?)
}

/// The next entry, the cursor moved past it and past its alignment. A length that falls
/// outside the section stops the walk: it never reads beside it.
fn next<'a>(rest: &mut &'a [u8]) -> Option<&'a [u8]> {
    let field: [u8; 4] = rest.get(..ENTRY_LENGTH)?.try_into().ok()?;
    let length = usize::try_from(u32::from_le_bytes(field)).ok()?;
    let end = ENTRY_LENGTH.checked_add(length)?;
    let entry = rest.get(ENTRY_LENGTH..end)?;
    *rest = rest.get(end.next_multiple_of(ALIGN)..).unwrap_or_default();
    Some(entry)
}

/// The value without the trailing null the specification gives it, or the alignment padding.
fn trimmed(value: &[u8]) -> &[u8] {
    let end = value
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(value.len());
    &value[..end]
}
