//! The world-roots table and DAG as fixed-size little-endian records (docs/FORMAT.md,
//! World super-roots): `world-roots.table`, what a load reads — the bundles, pages, cells and
//! placed objects —, and `world-roots.dag`, what the world stream reads on its first use — every
//! world cluster and the group list. A reader views each record at its rank on the bytes,
//! as it views a page in its bundle: never one string of the whole world, which a JavaScript
//! engine refuses past 512 MiB (the open world's table was 866 MiB as JSON).
//!
//! Every variable list (a bundle's or an object's dependencies, an object's roots, a group's
//! children and outputs) lies in a `u32` pool after the records, a record naming its first word
//! and its length.
use super::*;

pub(crate) const TABLE_MAGIC: &[u8; 4] = b"WRTB";
pub(crate) const DAG_MAGIC: &[u8; 4] = b"WRTD";

pub(super) fn invalid(what: &str) -> CompilerError {
    CompilerError::new("INVALID_WORLD_ROOTS", format!("world roots: {what}"))
}
/// `value` as one `u32` word, or `-1` for `null` when `nullable`.
pub(super) fn word(value: &Value, nullable: bool) -> Result<u32> {
    match value.as_u64() {
        Some(n) if n < u32::MAX as u64 => Ok(n as u32),
        None if nullable && value.is_null() => Ok(u32::MAX),
        _ => Err(invalid(&format!("{value} is not a 32-bit index"))),
    }
}
pub(super) fn list<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    value[key]
        .as_array()
        .ok_or_else(|| invalid(&format!("{key} is not a list")))
}

/// A record file being written: its words, then its pool.
#[derive(Default)]
pub(super) struct Records {
    pub(super) out: Vec<u8>,
    pub(super) pool: Vec<u32>,
}
impl Records {
    pub(super) fn word(&mut self, value: u32) {
        self.out.extend(value.to_le_bytes());
    }
    fn float(&mut self, value: f64) {
        self.out.extend(value.to_le_bytes());
    }
    /// `values`, `null` written as NaN, `count` of them.
    pub(super) fn floats(&mut self, value: &Value, count: usize) {
        for at in 0..count {
            self.float(value.get(at).unwrap_or(value).as_f64().unwrap_or(f64::NAN));
        }
    }
    /// `values` in the pool: its first word and its length; a `null` written `u32::MAX` when
    /// `nullable`.
    pub(super) fn pooled(&mut self, values: &Value) -> Result<()> {
        self.pooled_words(values, false)
    }
    pub(super) fn pooled_words(&mut self, values: &Value, nullable: bool) -> Result<()> {
        let values = values
            .as_array()
            .ok_or_else(|| invalid("a list is not a list"))?;
        let first = self.pool.len() as u32;
        for value in values {
            self.pool.push(word(value, nullable)?);
        }
        self.word(first);
        self.word(values.len() as u32);
        Ok(())
    }
    pub(super) fn end(mut self) -> Vec<u8> {
        for value in std::mem::take(&mut self.pool) {
            self.word(value);
        }
        self.out
    }
}

/// A SHA-256 written in hexadecimal, as its 32 bytes.
fn digest(hex: &Value) -> Result<Vec<u8>> {
    let text = hex
        .as_str()
        .filter(|t| crate::manifest_binary::is_digest(t))
        .ok_or_else(|| invalid("sha256"))?;
    (0..32)
        .map(|at| u8::from_str_radix(&text[at * 2..at * 2 + 2], 16).map_err(|_| invalid("sha256")))
        .collect()
}

/// `world-roots.table` of `table`, the cook's table with its `payload` named: an 80-byte header
/// (magic, version, budget, pinned bundles, pinned bytes, the five counts, the binary's length as
/// two words, then the binary's 32-byte digest), then 56-byte bundles, 24-byte pages (bundle,
/// offset, level and length, then the error as `f64`), 16-byte cells (first object, count, then each
/// node's first object in the pool, `u32::MAX` for none), 24-byte objects and the pool.
pub(crate) fn encode_table(table: &Value) -> Result<Vec<u8>> {
    let (bundles, pages, cells) = (
        list(table, "bundles")?,
        list(table, "pages")?,
        list(table, "cells")?,
    );
    let objects: Vec<&Value> = cells
        .iter()
        .map(|cell| list(cell, "objects"))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect();
    let mut r = Records::default();
    r.out.extend(TABLE_MAGIC);
    for key in ["version", "budgetBytes", "pinned", "pinnedTopBytes"] {
        r.word(word(&table[key], false)?);
    }
    for count in [bundles.len(), pages.len(), cells.len(), objects.len()] {
        r.word(count as u32);
    }
    let pool_words = r.out.len();
    r.word(0); // the pool's length, known once every list is in it
    let payload = table["payload"]["bytes"]
        .as_u64()
        .ok_or_else(|| invalid("payload"))?;
    r.word(payload as u32);
    r.word((payload >> 32) as u32);
    r.out.extend(digest(&table["payload"]["sha256"])?);
    for bundle in bundles {
        let offset = bundle["offset"]
            .as_u64()
            .ok_or_else(|| invalid("bundle offset"))?;
        r.word(offset as u32);
        r.word((offset >> 32) as u32);
        r.word(word(&bundle["bytes"], false)?);
        r.word(word(&bundle["count"], false)?);
        r.pooled(&bundle["dependencies"])?;
        r.out.extend(digest(&bundle["sha256"])?);
    }
    for page in pages {
        for key in ["bundle", "offset", "level", "bytes"] {
            r.word(word(&page[key], false)?);
        }
        r.floats(&page["lodError"], 1);
    }
    let mut first = 0u32;
    for cell in cells {
        let count = list(cell, "objects")?.len() as u32;
        r.word(first);
        r.word(count);
        r.pooled_words(&cell["nodes"], true)?;
        first += count;
    }
    for object in objects {
        r.word(word(&object["node"], false)?);
        r.word(word(&object["primitive"], false)?);
        r.pooled(&object["roots"])?;
        r.pooled(&object["dependencies"])?;
    }
    let words = (r.pool.len() as u32).to_le_bytes();
    r.out[pool_words..pool_words + 4].copy_from_slice(&words);
    Ok(r.end())
}
