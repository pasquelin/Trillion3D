//! The paged cell index (#750): the cell records are written in region pages, each a subtree of
//! the halving (`split.rs`) whose records fit one page, under index pages that list at most
//! `FAN_OUT` pages each, opened from the same tree. The tables keep only the root: `FAN_OUT` slots
//! of one width, so its size does not grow with the world. No second spatial partition: every
//! page is a node of the halving tree, a contiguous range of cells.
use super::*;
use split::Region;
use std::fmt::Write as _;

/// The most bytes a region page holds, a single cell's record excepted: one stream unit, what the
/// runtime reads a cell by.
pub(crate) const PAGE_BYTES: usize = crate::STREAM_BUNDLE_BYTES;
/// How many pages the root and an index page list at most.
pub(crate) const FAN_OUT: usize = 8;
/// A slot: the page's SHA-256 in 64 hexadecimal digits, its size in 8, then its box — the union
/// of its cells' at the declared poses — as the bits of six `f64` in 16 each. All zeros: no page.
pub(crate) const SLOT_WIDTH: usize = 64 + 8 + 6 * 16;

/// The file of the page whose fingerprint is `sha256`.
fn page_file(sha256: &str) -> String {
    format!("scene-page-{sha256}.json")
}

/// The slot of a page written as `bytes`, boxed by `bounds`.
fn slot(sha256: &str, bytes: usize, bounds: &Box6) -> String {
    let mut text = format!("{sha256}{bytes:08x}");
    for value in bounds {
        write!(text, "{:016x}", value.to_bits()).expect("a string takes any write");
    }
    text
}

/// The records of the cells, where each starts once written after a region page's `head`.
struct Pager<'a> {
    head: usize,
    records: &'a [Value],
    starts: Vec<usize>,
    bounds: &'a [Box6],
    limit: usize,
    directory: &'a Path,
}

impl Pager<'_> {
    /// Whether `region` is a region page: one cell, or records that fit the limit.
    fn fits(&self, region: &Region) -> bool {
        let records = self.starts[region.cells.end] - self.starts[region.cells.start];
        region.halves.is_none() || self.head + records <= self.limit
    }

    /// The pages listed for `region`: its halving opened, widest first, until `FAN_OUT` pages
    /// or every one is a region page. The order is the cells' order.
    fn frontier<'r>(&self, region: &'r Region) -> Vec<&'r Region> {
        let mut frontier = vec![region];
        while frontier.len() < FAN_OUT {
            let Some(at) = (0..frontier.len())
                .filter(|at| !self.fits(frontier[*at]))
                .max_by_key(|at| frontier[*at].cells.len())
            else {
                break;
            };
            let halves = frontier[at]
                .halves
                .as_deref()
                .expect("a region too big to fit");
            frontier.splice(at..=at, halves);
        }
        frontier
    }

    /// The slots of the pages that list `region`'s cells, each page written.
    fn slots(&self, region: &Region) -> Result<Vec<String>> {
        self.frontier(region)
            .into_iter()
            .map(|page| self.write(page))
            .collect()
    }

    /// Writes `region` as a region page, or as an index page over its frontier; its slot.
    fn write(&self, region: &Region) -> Result<String> {
        let body = if self.fits(region) {
            json!({"version": PARTITION_VERSION, "cells": &self.records[region.cells.clone()]})
        } else {
            json!({"version": PARTITION_VERSION, "pages": self.slots(region)?})
        };
        let bytes = serde_json::to_vec(&body)?;
        let sha256 = hash(&bytes);
        atomic(&self.directory.join(page_file(&sha256)), &bytes)?;
        let mut bounds = EMPTY;
        for cell in &self.bounds[region.cells.clone()] {
            grow(&mut bounds, cell);
        }
        Ok(slot(&sha256, bytes.len(), &bounds))
    }
}

/// Writes the pages of the cells `tree` halved, whose records and world boxes are `records` and
/// `bounds`, with region pages under `limit` bytes; returns the root: `FAN_OUT` slots, the empty
/// ones last.
pub(crate) fn write_pages(
    tree: &Region,
    records: &[Value],
    bounds: &[Box6],
    directory: &Path,
    limit: usize,
) -> Result<Value> {
    let mut starts = vec![0];
    for record in records {
        starts.push(starts[starts.len() - 1] + serde_json::to_vec(record)?.len() + 1);
    }
    let pager = Pager {
        head: serde_json::to_vec(&json!({"version": PARTITION_VERSION, "cells": []}))?.len(),
        records,
        starts,
        bounds,
        limit,
        directory,
    };
    let mut slots = pager.slots(tree)?;
    slots.resize(FAN_OUT, "0".repeat(SLOT_WIDTH));
    Ok(json!({"version": PARTITION_VERSION, "pages": slots}))
}

/// Appends to `into` every cell record under `page`, in cell order: a region page's own, or those
/// of the pages its slots name, each read from `directory` and proven by its size and fingerprint
/// before it is read. `what` names `page` in the refusal.
pub(crate) fn read_records(
    directory: &Path,
    page: &Value,
    what: &str,
    into: &mut Vec<Value>,
) -> std::result::Result<(), String> {
    if page["version"] != json!(PARTITION_VERSION) {
        return Err(format!(
            "{what} is not partition version {PARTITION_VERSION}"
        ));
    }
    if let Some(cells) = page["cells"].as_array() {
        into.extend(cells.iter().cloned());
        return Ok(());
    }
    let slots = page["pages"]
        .as_array()
        .ok_or(format!("{what} lists no page"))?;
    for text in slots.iter().map(|slot| slot.as_str().unwrap_or_default()) {
        if text.len() != SLOT_WIDTH || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!(
                "{what} lists a slot that is not {SLOT_WIDTH} hex digits"
            ));
        }
        let bytes = usize::from_str_radix(&text[64..72], 16).expect("eight hex digits");
        if bytes == 0 {
            continue;
        }
        let name = page_file(&text[..64]);
        let data = fs::read(directory.join(&name)).map_err(|e| format!("{name}: {e}"))?;
        if data.len() != bytes || hash(&data) != text[..64] {
            return Err(format!("{name} is not the page its slot names"));
        }
        let child: Value = serde_json::from_slice(&data).map_err(|e| format!("{name}: {e}"))?;
        read_records(directory, &child, &name, into)?;
    }
    Ok(())
}
