//! The paged index (#750): records lie in pages, each the node of the halving (`split.rs`) whose
//! records fit one page, under index pages of at most `FAN_OUT` pages cut from the same tree — no
//! second spatial partition. A root keeps only `FAN_OUT` slots of one width: its size does not
//! grow with the world. Each kind of record is paged so, under its own files and version (`Kind`).
use super::*;
use split::Region;
use std::{fmt::Write as _, ops::Range};

/// The most bytes a region page of more than one record holds: one stream unit.
pub(crate) const PAGE_BYTES: usize = crate::STREAM_BUNDLE_BYTES;
/// How many pages the root and an index page list at most.
pub(crate) const FAN_OUT: usize = 8;
/// A slot: the page's SHA-256 in 64 hexadecimal digits, its size in 8, then its box — the union
/// of its records' at the declared poses — as the bits of six `f64` in 16 each. Zeros: no page.
const SLOT_WIDTH: usize = 64 + 8 + 6 * 16;

/// A kind of page: the prefix of its files, the version every page carries, and the member a
/// region page lists its records under.
pub(crate) struct Kind {
    pub prefix: &'static str,
    pub version: u32,
    pub records: &'static str,
}
/// The pages of the cell records.
pub(crate) const CELL_PAGES: Kind = Kind {
    prefix: "scene-page-",
    version: PARTITION_VERSION,
    records: "cells",
};

/// Writes `body` as a page of `kind` in `directory`, boxed by the union of `boxes`; its slot.
pub(crate) fn write_page(
    kind: &Kind,
    directory: &Path,
    body: &Value,
    boxes: &[Box6],
) -> Result<String> {
    let bytes = serde_json::to_vec(body)?;
    let sha256 = hash(&bytes);
    atomic(
        &directory.join(format!("{}{sha256}.json", kind.prefix)),
        &bytes,
    )?;
    let mut bounds = EMPTY;
    for record in boxes {
        grow(&mut bounds, record);
    }
    let mut slot = format!("{sha256}{:08x}", bytes.len());
    for value in bounds {
        write!(slot, "{:016x}", value.to_bits()).expect("a string takes any write");
    }
    Ok(slot)
}

/// The records of one kind of page, their boxes, and where each record starts once written.
pub(crate) struct Pager<'a> {
    kind: &'a Kind,
    /// The bytes of a region page of no record, as `leaf` lays it out.
    empty: usize,
    /// Where each record starts in a region page's list, and where the last ends.
    starts: Vec<usize>,
    /// The box of each record.
    bounds: &'a [Box6],
    directory: &'a Path,
    /// The region page over a range of records, its version aside.
    leaf: &'a dyn Fn(Range<usize>) -> Result<Value>,
}

impl<'a> Pager<'a> {
    /// The pager of `kind` over records starting at `starts`, boxed by `bounds`, whose region pages
    /// `leaf` lays out: the bytes of an empty region page are measured on `leaf` itself.
    pub(crate) fn new(
        kind: &'a Kind,
        starts: Vec<usize>,
        bounds: &'a [Box6],
        directory: &'a Path,
        leaf: &'a dyn Fn(Range<usize>) -> Result<Value>,
    ) -> Result<Self> {
        let mut pager = Pager {
            kind,
            empty: 0,
            starts,
            bounds,
            directory,
            leaf,
        };
        pager.empty = serde_json::to_vec(&pager.region(0..0)?)?.len();
        Ok(pager)
    }

    /// The region page over `records`, its version stamped.
    fn region(&self, records: Range<usize>) -> Result<Value> {
        let mut body = (self.leaf)(records)?;
        body["version"] = json!(self.kind.version);
        Ok(body)
    }

    /// Whether `region` is a region page: one record, or records that fit `PAGE_BYTES`.
    fn fits(&self, region: &Region) -> bool {
        let (starts, cells) = (&self.starts, &region.cells);
        region.halves.is_none()
            || self.empty + starts[cells.end] - starts[cells.start] <= PAGE_BYTES
    }

    /// The slots of the pages listing `region`'s records in order, each written: its halving
    /// opened, the node of most records first, until `FAN_OUT` pages or every one is a region page.
    fn slots(&self, region: &Region) -> Result<Vec<String>> {
        let mut pages = vec![region];
        while pages.len() < FAN_OUT {
            let open = (0..pages.len()).filter(|at| !self.fits(pages[*at]));
            let Some(at) = open.max_by_key(|at| pages[*at].cells.len()) else {
                break;
            };
            let halves = pages[at]
                .halves
                .as_deref()
                .expect("a region that does not fit");
            pages.splice(at..=at, halves);
        }
        pages.into_iter().map(|page| self.write(page)).collect()
    }

    /// Writes `region` as a region page, or as an index page over its slots; its slot.
    fn write(&self, region: &Region) -> Result<String> {
        let body = if self.fits(region) {
            self.region(region.cells.clone())?
        } else {
            json!({"version": self.kind.version, "pages": self.slots(region)?})
        };
        let boxes = &self.bounds[region.cells.clone()];
        write_page(self.kind, self.directory, &body, boxes)
    }

    /// The root's slots over `tree`, the empty ones last.
    pub(crate) fn root(&self, tree: &Region) -> Result<Vec<String>> {
        let mut slots = self.slots(tree)?;
        slots.resize(FAN_OUT, "0".repeat(SLOT_WIDTH));
        Ok(slots)
    }
}

/// Writes the pages of the cells `tree` halved, whose records and world boxes are `records` and
/// `bounds`; returns the root.
pub(crate) fn write_pages(
    tree: &Region,
    records: &[Value],
    bounds: &[Box6],
    directory: &Path,
) -> Result<Value> {
    let mut starts = vec![0];
    for record in records {
        starts.push(starts[starts.len() - 1] + serde_json::to_vec(record)?.len() + 1);
    }
    let kind = &CELL_PAGES;
    let leaf = |cells: Range<usize>| Ok(json!({kind.records: &records[cells]}));
    let pager = Pager::new(kind, starts, bounds, directory, &leaf)?;
    Ok(json!({"version": kind.version, "pages": pager.root(tree)?}))
}

/// Every cell record under `root`, of `CELL_PAGES`' version, in cell order.
pub(crate) fn read_records(
    directory: &Path,
    root: &Value,
) -> std::result::Result<Vec<Value>, String> {
    if root["version"] != json!(CELL_PAGES.version) {
        return Err("the partition root is of another version".into());
    }
    let mut pages = Vec::new();
    read_leaves(
        &CELL_PAGES,
        directory,
        &root["pages"],
        "the root",
        &mut pages,
    )?;
    let mut records = Vec::new();
    for mut page in pages {
        if let Value::Array(cells) = page[CELL_PAGES.records].take() {
            records.extend(cells);
        }
    }
    Ok(records)
}

/// The page of `kind` that `slot` names — read from `directory`, proven by its size and
/// fingerprint, of `kind`'s version — and its file; `None` for an empty slot. `what` names the
/// page that lists it.
pub(crate) fn read_slot(
    kind: &Kind,
    directory: &Path,
    slot: &Value,
    what: &str,
) -> std::result::Result<Option<(String, Value)>, String> {
    let text = slot.as_str().unwrap_or_default();
    if text.len() != SLOT_WIDTH || !crate::manifest_binary::is_lower_hex(text) {
        return Err(format!("{what} lists a slot that is not fixed-width hex"));
    }
    let bytes = usize::from_str_radix(&text[64..72], 16).expect("eight hex digits");
    if bytes == 0 {
        return Ok(None);
    }
    let name = format!("{}{}.json", kind.prefix, &text[..64]);
    let data = fs::read(directory.join(&name)).map_err(|e| format!("{name}: {e}"))?;
    if data.len() != bytes || hash(&data) != text[..64] {
        return Err(format!("{name} is not the page its slot names"));
    }
    let page: Value = serde_json::from_slice(&data).map_err(|e| format!("{name}: {e}"))?;
    if page["version"] != json!(kind.version) {
        return Err(format!("{name} is of another version"));
    }
    Ok(Some((name, page)))
}

/// Appends to `into` every region page under `slots` (listed by `what`), in record order, each
/// read by `read_slot`.
pub(crate) fn read_leaves(
    kind: &Kind,
    directory: &Path,
    slots: &Value,
    what: &str,
    into: &mut Vec<Value>,
) -> std::result::Result<(), String> {
    let slots = slots.as_array().ok_or(format!("{what} lists no page"))?;
    for slot in slots {
        let Some((name, page)) = read_slot(kind, directory, slot, what)? else {
            continue;
        };
        if page["pages"].is_array() {
            read_leaves(kind, directory, &page["pages"], &name, into)?;
        } else if page[kind.records].is_array() {
            into.push(page);
        } else {
            return Err(format!("{name} lists neither pages nor records"));
        }
    }
    Ok(())
}
