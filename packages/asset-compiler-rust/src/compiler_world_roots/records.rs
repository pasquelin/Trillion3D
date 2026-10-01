//! The world-roots table and DAG as fixed-size little-endian records (#1232; docs/FORMAT.md,
//! World super-roots): `world-roots.table`, what a load reads — the bundles, pages, cells and
//! placed objects —, and `world-roots.dag`, what the world stream reads on its first use — every
//! world cluster and the group list (#1238). A reader views each record at its rank on the bytes,
//! as it views a page in its bundle: never one string of the whole world, which a JavaScript
//! engine refuses past 512 MiB (the open world's table was 866 MiB as JSON).
//!
//! Every variable list (a bundle's or an object's dependencies, an object's roots, a group's
//! children and outputs) lies in a `u32` pool after the records, a record naming its first word
//! and its length.
use super::*;

pub(crate) const TABLE_MAGIC: &[u8; 4] = b"WRTB";
pub(crate) const DAG_MAGIC: &[u8; 4] = b"WRTD";

fn invalid(what: &str) -> CompilerError {
    CompilerError::new("INVALID_WORLD_ROOTS", format!("world roots: {what}"))
}
/// `value` as one `u32` word, or `-1` for `null` when `nullable`.
fn word(value: &Value, nullable: bool) -> Result<u32> {
    match value.as_u64() {
        Some(n) if n < u32::MAX as u64 => Ok(n as u32),
        None if nullable && value.is_null() => Ok(u32::MAX),
        _ => Err(invalid(&format!("{value} is not a 32-bit index"))),
    }
}
fn list<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    value[key]
        .as_array()
        .ok_or_else(|| invalid(&format!("{key} is not a list")))
}

/// A record file being written: its words, then its pool.
#[derive(Default)]
struct Records {
    out: Vec<u8>,
    pool: Vec<u32>,
}
impl Records {
    fn word(&mut self, value: u32) {
        self.out.extend(value.to_le_bytes());
    }
    fn float(&mut self, value: f64) {
        self.out.extend(value.to_le_bytes());
    }
    /// `values`, `null` written as NaN, `count` of them.
    fn floats(&mut self, value: &Value, count: usize) {
        for at in 0..count {
            self.float(value.get(at).unwrap_or(value).as_f64().unwrap_or(f64::NAN));
        }
    }
    /// `values` in the pool: its first word and its length.
    fn pooled(&mut self, values: &Value) -> Result<()> {
        let values = values
            .as_array()
            .ok_or_else(|| invalid("a list is not a list"))?;
        let first = self.pool.len() as u32;
        for value in values {
            self.pool.push(word(value, false)?);
        }
        self.word(first);
        self.word(values.len() as u32);
        Ok(())
    }
    fn end(mut self) -> Vec<u8> {
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
        .filter(|t| t.len() == 64)
        .ok_or_else(|| invalid("sha256"))?;
    (0..32)
        .map(|at| u8::from_str_radix(&text[at * 2..at * 2 + 2], 16).map_err(|_| invalid("sha256")))
        .collect()
}

/// `world-roots.table` of `table`, the cook's table with its `payload` named: a 48-byte header
/// (magic, version, budget, pinned bundles, pinned bytes, the five counts, the binary's length as
/// two words), the binary's digest, then 56-byte bundles, 24-byte pages, 8-byte cells, 24-byte
/// objects and the pool.
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
        for key in ["bundle", "offset", "level"] {
            r.word(word(&page[key], false)?);
        }
        r.word(0);
        r.floats(&page["lodError"], 1);
    }
    let mut first = 0u32;
    for cell in cells {
        let count = list(cell, "objects")?.len() as u32;
        r.word(first);
        r.word(count);
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

/// `world-roots.dag` of `table`'s `clusters` and `groups`: a 24-byte header (magic, version, the
/// two counts, the pool's length, zero), then 152-byte clusters — level, triangles, then material,
/// bundle, offset and origin (`u32::MAX` for none), then as `f64` the error, the parent's (NaN for
/// a root), the sphere, the parent's (NaN for a root), the minimum and the maximum —, 64-byte
/// groups — level, its children and outputs in the pool, zero, then as `f64` its error and sphere
/// — and the pool.
pub(crate) fn encode_dag(table: &Value) -> Result<Vec<u8>> {
    let (clusters, groups) = (list(table, "clusters")?, list(table, "groups")?);
    let mut r = Records::default();
    r.out.extend(DAG_MAGIC);
    for value in [
        WORLD_ROOTS_VERSION,
        clusters.len() as u32,
        groups.len() as u32,
        0,
        0,
    ] {
        r.word(value);
    }
    for cluster in clusters {
        r.word(word(&cluster["level"], false)?);
        r.word(word(&cluster["triangles"], false)?);
        for key in ["material", "bundle", "offset", "origin"] {
            r.word(word(&cluster[key], true)?);
        }
        r.floats(&cluster["lodError"], 1);
        r.floats(&cluster["parentError"], 1);
        r.floats(&cluster["sphere"], 4);
        r.floats(&cluster["parentSphere"], 4);
        r.floats(&cluster["min"], 3);
        r.floats(&cluster["max"], 3);
    }
    for group in groups {
        r.word(word(&group["level"], false)?);
        r.pooled(&group["children"])?;
        r.pooled(&group["outputs"])?;
        r.word(0);
        r.floats(&group["error"], 1);
        r.floats(&group["sphere"], 4);
    }
    let words = (r.pool.len() as u32).to_le_bytes();
    r.out[16..20].copy_from_slice(&words);
    Ok(r.end())
}
