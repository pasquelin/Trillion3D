//! The world-roots table and DAG as fixed-size little-endian records (docs/FORMAT.md, World
//! HLOD): `world-roots.table`, what a load reads — the bundles, the pages and the HLOD cells —, and
//! `world-roots.dag`, what the world stream reads on its first use — every world cluster and the
//! group list. A reader views each record at its rank on the bytes,
//! as it views a page in its bundle: never one string of the whole world, which a JavaScript
//! engine refuses past 512 MiB (the open world's table was 866 MiB as JSON). The cook writes them
//! straight from its world, never through a document of it.
//!
//! Every variable list (a bundle's dependencies, an HLOD cell's bundles, a group's children and
//! outputs) lies in a `u32` pool after the records, a record naming its first word and its length.
use super::*;
use crate::compiler::pages::bundles::Bundle;
use crate::compiler::tables::partition::HlodNode;
use crate::manifest_binary::format::Column;

pub(crate) const TABLE_MAGIC: &[u8; 4] = b"WRTB";
pub(crate) const DAG_MAGIC: &[u8; 4] = b"WRTD";

pub(crate) fn invalid(what: &str) -> CompilerError {
    CompilerError::new("INVALID_WORLD_ROOTS", format!("world roots: {what}"))
}

/// `n` as one `u32` word: `u32::MAX` is none's, so `n` stays under it.
pub(crate) fn index(n: usize) -> Result<u32> {
    u32::try_from(n)
        .ok()
        .filter(|&w| w != u32::MAX)
        .ok_or_else(|| invalid(&format!("{n} is not a 32-bit index")))
}

/// `n` as one `u32` word, `u32::MAX` for none.
pub(super) fn nullable(n: Option<usize>) -> Result<u32> {
    n.map_or(Ok(u32::MAX), index)
}

/// A float as the records hold it: a value that is not finite is NaN, as an absent one.
fn finite(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        f64::NAN
    }
}

/// A record file being written: its words, in the one little-endian column writer, then its pool.
#[derive(Default)]
pub(super) struct Records {
    pub(crate) out: Column,
    pub(super) pool: Vec<u32>,
}
impl Records {
    pub(super) fn word(&mut self, value: u32) {
        self.out.u32(value);
    }
    /// `value`, NaN when it is not finite.
    pub(super) fn float(&mut self, value: f64) {
        self.out.f64(finite(value));
    }
    /// `values`, or as many NaN for none.
    pub(crate) fn floats<const N: usize>(&mut self, values: Option<&[f64; N]>) {
        for at in 0..N {
            self.float(values.map_or(f64::NAN, |v| v[at]));
        }
    }
    /// `values` in the pool: its first word and its length.
    pub(super) fn pooled<'a>(
        &mut self,
        values: impl ExactSizeIterator<Item = &'a usize>,
    ) -> Result<()> {
        let (first, count) = (self.pool.len() as u32, values.len() as u32);
        for &value in values {
            self.pool.push(index(value)?);
        }
        self.word(first);
        self.word(count);
        Ok(())
    }
    /// The pool's length written at byte `at`, then the pool after the records.
    pub(crate) fn end(mut self, at: usize) -> Vec<u8> {
        let words = (self.pool.len() as u32).to_le_bytes();
        self.out.bytes[at..at + 4].copy_from_slice(&words);
        for value in std::mem::take(&mut self.pool) {
            self.word(value);
        }
        self.out.bytes
    }
}

/// A world page: its bundle, its offset there, its level, its length and its error.
pub(super) struct Page {
    pub bundle: usize,
    pub offset: usize,
    pub level: usize,
    pub bytes: usize,
    pub lod_error: f64,
}

/// `world-roots.table` of the world's `bundles`, `pages` and HLOD cells over `payload`: a 64-byte
/// header (magic, version, the three counts, the pool's length, the binary's length as two words,
/// then the binary's 32-byte digest), then 56-byte bundles, 24-byte pages (bundle, offset, level
/// and length, then the error as `f64`), 124-byte HLOD cells of the chain, leaves first (the
/// bundles holding its roots — its actor's root page, none for an actor not built —, in the pool;
/// the cell its actor lies in, `u32::MAX` for an actor always loaded or a cell nothing is built
/// of; its level in the low 8 bits — 0 for an HLOD 0 cell, whose placements it draws, 1 at least
/// for a cell of actors (`HlodNode::level`) —, `1` in the next bit when its actor asks a warm-up
/// (`HlodNode::warmup`), the level of its cell on its grid in the next 7 (`HlodNode::rung`), its
/// grid — the partition root's — in the high 16; its actor's HLOD level
/// (`HlodNode::actor_level`); its actor's `rows`, the bundle holding them, `u32::MAX` for none —
/// one of its bundles, of no page, `ROW_BYTES` a row (`builds::lay_rows`) —, and their count; then
/// as `f64` the bounds it streams by and the union of what it holds) and the pool.
pub(super) fn encode_table(
    (bundles, pages, (hlod, tree, rows)): (
        &[Bundle],
        &[Page],
        (&[BTreeSet<usize>], &[HlodNode], &[(Option<usize>, usize)]),
    ),
    payload: &[u8],
) -> Result<Vec<u8>> {
    let mut r = Records::default();
    r.out.raw(TABLE_MAGIC);
    r.word(WORLD_ROOTS_VERSION);
    for count in [bundles.len(), pages.len(), hlod.len()] {
        r.word(index(count)?);
    }
    let pool_words = r.out.bytes.len();
    r.word(0); // the pool's length, known once every list is in it
    let length = payload.len() as u64;
    r.word(length as u32);
    r.word((length >> 32) as u32);
    r.out.raw(&digest_bytes(payload));
    for bundle in bundles {
        r.word(bundle.start as u32);
        r.word((bundle.start as u64 >> 32) as u32);
        r.word(index(bundle.bytes)?);
        r.word(index(bundle.count)?);
        r.pooled(bundle.dependencies.iter())?;
        r.out.raw(&bundle.sha256);
    }
    for page in pages {
        for value in [page.bundle, page.offset, page.level, page.bytes] {
            r.word(index(value)?);
        }
        r.float(page.lod_error);
    }
    for ((held, node), &(rows, count)) in hlod.iter().zip(tree).zip(rows) {
        r.pooled(held.iter())?;
        r.word(nullable(node.parent)?);
        let (level, grid, rung) = (index(node.level)?, index(node.grid)?, node.rung);
        if level > 0xff || rung > 0x7f || grid > 0xffff {
            return Err(invalid(&format!(
                "HLOD level {level} past 8 bits, cell level {rung} past 7 or grid {grid} past 16"
            )));
        }
        r.word(level | u32::from(node.warmup) << 8 | rung << 9 | grid << 16);
        r.word(index(node.actor_level)?);
        r.word(nullable(rows)?);
        r.word(index(count)?);
        r.floats(Some(&node.shown));
        r.floats(Some(&node.content));
    }
    Ok(r.end(pool_words))
}
