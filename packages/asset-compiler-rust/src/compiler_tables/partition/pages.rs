//! The paged cell index (#750): the cell records lie in region pages, each the node of the halving
//! (`split.rs`) whose records fit one page, under index pages of at most `FAN_OUT` pages cut from
//! the same tree — no second spatial partition. The tables keep only the root, `FAN_OUT` slots of
//! one width: its size does not grow with the world.
use super::*;
use split::Region;
use std::fmt::Write as _;

/// The most bytes a region page of more than one cell holds: one stream unit.
pub(crate) const PAGE_BYTES: usize = crate::STREAM_BUNDLE_BYTES;
/// How many pages the root and an index page list at most.
pub(crate) const FAN_OUT: usize = 8;
/// A slot: the page's SHA-256 in 64 hexadecimal digits, its size in 8, then its box — the union
/// of its cells' at the declared poses — as the bits of six `f64` in 16 each. Zeros: no page.
const SLOT_WIDTH: usize = 64 + 8 + 6 * 16;

/// The file of the page whose fingerprint is `sha256`, beside the tables.
fn page_file(sha256: &str) -> String {
    format!("scene-page-{sha256}.json")
}

/// The records of the cells, their boxes, and where each record starts once written.
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

    /// The slots of the pages listing `region`'s cells in order, each written: its halving opened,
    /// widest node first, until `FAN_OUT` pages or every one is a region page.
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
        let mut slot = format!("{sha256}{:08x}", bytes.len());
        for value in bounds {
            write!(slot, "{:016x}", value.to_bits()).expect("a string takes any write");
        }
        Ok(slot)
    }
}

/// Writes the pages of the cells `tree` halved, whose records and world boxes are `records` and
/// `bounds`, region pages under `limit` bytes; returns the root, the empty slots last.
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
    let head = serde_json::to_vec(&json!({"version": PARTITION_VERSION, "cells": []}))?.len();
    let pager = Pager {
        head,
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

/// Appends to `into` every cell record under `page` (named `what`), in cell order, each page its
/// slots name read from `directory` and proven by its size and fingerprint first.
pub(crate) fn read_records(
    directory: &Path,
    page: &Value,
    what: &str,
    into: &mut Vec<Value>,
) -> std::result::Result<(), String> {
    if page["version"] != json!(PARTITION_VERSION) {
        return Err(format!("{what} is of another partition version"));
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
            return Err(format!("{what} lists a slot of another width"));
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
