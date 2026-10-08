//! The world-roots table and DAG as fixed-size little-endian records (docs/FORMAT.md,
//! World super-roots): `world-roots.table`, what a load reads — the bundles, pages, cells and
//! placed objects —, and `world-roots.dag`, what the world stream reads on its first use — every
//! world cluster and the group list. A reader views each record at its rank on the bytes,
//! as it views a page in its bundle: never one string of the whole world, which a JavaScript
//! engine refuses past 512 MiB (the open world's table was 866 MiB as JSON). The cook writes them
//! straight from its world, never through a document of it.
//!
//! Every variable list (a bundle's or an object's dependencies, an object's roots, a group's
//! children and outputs) lies in a `u32` pool after the records, a record naming its first word
//! and its length.
use super::*;
use sha2::{Digest, Sha256};

pub(crate) const TABLE_MAGIC: &[u8; 4] = b"WRTB";
pub(crate) const DAG_MAGIC: &[u8; 4] = b"WRTD";

pub(super) fn invalid(what: &str) -> CompilerError {
    CompilerError::new("INVALID_WORLD_ROOTS", format!("world roots: {what}"))
}

/// `n` as one `u32` word: `u32::MAX` is none's, so `n` stays under it.
pub(super) fn index(n: usize) -> Result<u32> {
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
    /// `value`, NaN when it is not finite.
    pub(super) fn float(&mut self, value: f64) {
        self.out.extend(finite(value).to_le_bytes());
    }
    /// `values`, or as many NaN for none.
    pub(super) fn floats<const N: usize>(&mut self, values: Option<&[f64; N]>) {
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
    /// `values` in the pool, none written `u32::MAX`: its first word and its length.
    pub(super) fn pooled_nullable(&mut self, values: &[Option<usize>]) -> Result<()> {
        let first = self.pool.len() as u32;
        for &value in values {
            self.pool.push(nullable(value)?);
        }
        self.word(first);
        self.word(values.len() as u32);
        Ok(())
    }
    /// The pool's length written at byte `at`, then the pool after the records.
    pub(super) fn end(mut self, at: usize) -> Vec<u8> {
        let words = (self.pool.len() as u32).to_le_bytes();
        self.out[at..at + 4].copy_from_slice(&words);
        for value in std::mem::take(&mut self.pool) {
            self.word(value);
        }
        self.out
    }
}

/// A written bundle: its place in the binary, its count of pages and the bundles it needs.
pub(super) struct Bundle {
    pub offset: usize,
    pub bytes: usize,
    pub count: usize,
    pub dependencies: Vec<usize>,
    pub sha256: [u8; 32],
}

/// A super-root's page: its bundle, its offset there, its level, its length and its error.
pub(super) struct Page {
    pub bundle: usize,
    pub offset: usize,
    pub level: usize,
    pub bytes: usize,
    pub lod_error: f64,
}

/// A placed object of a cell: its node, its primitive, the bundles of its own roots and every
/// world bundle they need.
pub(super) struct Object {
    pub node: usize,
    pub primitive: usize,
    pub roots: Vec<usize>,
    pub dependencies: BTreeSet<usize>,
}

/// A cell's objects, and each of its nodes' first object among them (none for a node without).
pub(super) struct Cell {
    pub objects: Vec<Object>,
    pub nodes: Vec<Option<usize>>,
}

/// What the table's header names beside its records: the budget, the pinned bundles and bytes.
pub(super) struct Top {
    pub budget: usize,
    pub pinned: usize,
    pub pinned_bytes: usize,
}

/// The SHA-256 of `bytes`, its 32 bytes.
pub(super) fn digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// `world-roots.table` of the world's `bundles`, `pages` and `cells` over `payload`: an 80-byte
/// header (magic, version, budget, pinned bundles, pinned bytes, the five counts, the binary's
/// length as two words, then the binary's 32-byte digest), then 56-byte bundles, 24-byte pages
/// (bundle, offset, level and length, then the error as `f64`), 16-byte cells (first object, count,
/// then each node's first object in the pool, `u32::MAX` for none), 24-byte objects and the pool.
pub(super) fn encode_table(
    top: &Top,
    (bundles, pages, cells): (&[Bundle], &[Page], &[Cell]),
    payload: &[u8],
) -> Result<Vec<u8>> {
    let objects: usize = cells.iter().map(|cell| cell.objects.len()).sum();
    let mut r = Records::default();
    r.out.extend(TABLE_MAGIC);
    r.word(WORLD_ROOTS_VERSION);
    for value in [top.budget, top.pinned, top.pinned_bytes] {
        r.word(index(value)?);
    }
    for count in [bundles.len(), pages.len(), cells.len(), objects] {
        r.word(count as u32);
    }
    let pool_words = r.out.len();
    r.word(0); // the pool's length, known once every list is in it
    let length = payload.len() as u64;
    r.word(length as u32);
    r.word((length >> 32) as u32);
    r.out.extend(digest(payload));
    for bundle in bundles {
        r.word(bundle.offset as u32);
        r.word((bundle.offset as u64 >> 32) as u32);
        r.word(index(bundle.bytes)?);
        r.word(index(bundle.count)?);
        r.pooled(bundle.dependencies.iter())?;
        r.out.extend(bundle.sha256);
    }
    for page in pages {
        for value in [page.bundle, page.offset, page.level, page.bytes] {
            r.word(index(value)?);
        }
        r.float(page.lod_error);
    }
    let mut first = 0u32;
    for cell in cells {
        r.word(first);
        r.word(cell.objects.len() as u32);
        r.pooled_nullable(&cell.nodes)?;
        first += cell.objects.len() as u32;
    }
    for object in cells.iter().flat_map(|cell| &cell.objects) {
        r.word(index(object.node)?);
        r.word(index(object.primitive)?);
        r.pooled(object.roots.iter())?;
        r.pooled(object.dependencies.iter())?;
    }
    Ok(r.end(pool_words))
}
