//! The page's vertices as the encoder numbers and stores them: renumbered by first use, the
//! distinct positions kept once.

use super::cells::Cell;
use super::{EncodeError, Result};
use crate::bits::{bits_for, stream_words};
use crate::hash::word_map;

/// The positions the page stores and, when it stores each once, every vertex's link to its own
/// position: a flat-shaded page repeats a corner's position under every face normal meeting
/// there. The distinct positions, in first-use order, are kept when they and the links take fewer
/// words than one position per vertex; otherwise every vertex keeps its own, with no link. The
/// decoded vertices are the same either way.
pub fn stored_positions(unique: &[Cell], bits: [u32; 3]) -> (Vec<[u32; 3]>, Option<Vec<u32>>) {
    let (table, links) = first_use(unique.iter().map(|cell| cell.position));
    let words = |count: usize| bits.iter().map(|&b| stream_words(count, b)).sum::<usize>();
    let link_bits = bits_for(table.len() as u32 - 1);
    if words(table.len()) + stream_words(unique.len(), link_bits) < words(unique.len()) {
        (table, Some(links))
    } else if table.len() == unique.len() {
        // Every position distinct: the table is already one per vertex, in order.
        (table, None)
    } else {
        (unique.iter().map(|cell| cell.position).collect(), None)
    }
}

/// Each distinct item once, in first-use order, and every item's rank among them.
pub fn first_use<T: Copy + Eq + std::hash::Hash>(
    items: impl ExactSizeIterator<Item = T>,
) -> (Vec<T>, Vec<u32>) {
    let mut distinct = Vec::<T>::with_capacity(items.len());
    let mut rank = word_map::<T, u32>(items.len());
    let ranks = items
        .map(|item| {
            *rank.entry(item).or_insert_with(|| {
                distinct.push(item);
                (distinct.len() - 1) as u32
            })
        })
        .collect();
    (distinct, ranks)
}

/// Local vertex renumbering of a page: the table and both lists start at their known final
/// size, a page carrying at most 65,535 vertices and no more corners than indices.
pub fn localise(indices: &[u32], vertices: usize) -> Result<(Vec<u32>, Vec<u32>)> {
    let bound = indices.len().min(65_535);
    let mut original = Vec::<u32>::with_capacity(bound);
    let mut remap = word_map::<u32, u32>(bound);
    let mut local = Vec::<u32>::with_capacity(indices.len());
    for &source in indices {
        if source as usize >= vertices {
            return Err(EncodeError::new(
                "INVALID_PAGE",
                "Page index exceeds positions",
            ));
        }
        let id = if let Some(&id) = remap.get(&source) {
            id
        } else {
            let id = original.len();
            if id >= 65535 {
                return Err(EncodeError::new(
                    "PAGE_VERTEX_LIMIT",
                    "Page has more than 65535 vertices",
                ));
            }
            original.push(source);
            remap.insert(source, id as u32);
            id as u32
        };
        local.push(id);
    }
    Ok((original, local))
}
