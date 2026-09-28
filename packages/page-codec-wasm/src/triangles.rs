//! The corners of a page, coded by delta to their block's smallest vertex (CMP-09, #959).
//!
//! Triangles go by blocks of `BLOCK`, in page order. A block's record holds its smallest corner
//! (`base`, at the index width), the `width` each of its corners takes as its distance to that
//! base, and `prefix`, the sum of the widths of the blocks before it: the block's first corner
//! lies at bit `3 * BLOCK * prefix` of the corner stream: any corner is one record and one field
//! away, in O(1), as a shader reads it in place. The code is lossless — `base + delta == index`,
//! in order, which the tests prove on every input —, and pages number vertices by first use.

use crate::bits::{bits_for, field, le_words};
use crate::writer::BitWriter;
use crate::PageError;

/// Triangles per block.
pub const BLOCK: usize = 8;
/// Corners per full block: a block's bits are `CORNERS * width`, so a prefix of widths locates it.
const CORNERS: usize = 3 * BLOCK;
/// Bits of a block's width, 0 to 16: a local index never needs more than 16.
pub const WIDTH_BITS: u32 = 5;
pub const MAX_WIDTH: usize = 16;

/// The widths of a page's corner code, derived from the header alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CornerCode {
    /// Width of a block's base: that of a local index.
    pub index_bits: u32,
    /// Width of a block's prefix: enough for the sum of every width but the last block's.
    pub prefix_bits: u32,
    pub blocks: usize,
    /// Bits of the corner stream, the header's word 21.
    pub bits: usize,
}

impl CornerCode {
    pub fn of(vertex_count: usize, index_count: usize, bits: usize) -> Self {
        Self {
            index_bits: bits_for(vertex_count.saturating_sub(1) as u32),
            prefix_bits: bits_for((bits / CORNERS) as u32),
            blocks: (index_count / 3).div_ceil(BLOCK),
            bits,
        }
    }

    /// Bits of one block record: base, width, prefix.
    pub fn record_bits(&self) -> u32 {
        self.index_bits + WIDTH_BITS + self.prefix_bits
    }

    /// Block `b`'s record, the table at word `table` of `words`: its base, its width, and the bit
    /// of the corner stream its first corner lies at.
    pub fn record(&self, words: &[u32], table: usize, b: usize) -> (u32, u32, usize) {
        let ib = self.index_bits;
        let at = table * 32 + b * self.record_bits() as usize;
        let width = field(words, at + ib as usize, WIDTH_BITS);
        let prefix = field(words, at + (ib + WIDTH_BITS) as usize, self.prefix_bits);
        (field(words, at, ib), width, prefix as usize * CORNERS)
    }

    /// True when every record of `table` — the block table's bytes — keeps its base below the
    /// vertex count, a width no wider than an index and its corners inside the corner stream: the
    /// header gate, which the GPU, decoding in place, relies on to never read past the page.
    pub fn fits(&self, table: &[u8], vertex_count: usize, index_count: usize) -> bool {
        let words: Vec<u32> = le_words(table).collect();
        (0..self.blocks).all(|b| {
            let (base, width, start) = self.record(&words, 0, b);
            let corners = (index_count - b * CORNERS).min(CORNERS);
            (base as usize) < vertex_count
                && width <= self.index_bits
                && start + corners * width as usize <= self.bits
        })
    }

    /// Every corner into `out`, the block table at word `table` of `words` and the corner stream at
    /// word `stream`, the records already fit (`fits`). A corner at or past the vertex count
    /// refuses the page.
    pub fn read(
        &self,
        words: &[u32],
        [table, stream]: [usize; 2],
        vertex_count: usize,
        out: &mut [u32],
    ) -> Result<(), PageError> {
        for (b, block) in out.chunks_mut(CORNERS).enumerate() {
            let (base, width, start) = self.record(words, table, b);
            for (k, corner) in block.iter_mut().enumerate() {
                *corner = base + field(words, stream * 32 + start + k * width as usize, width);
                if *corner as usize >= vertex_count {
                    return Err(PageError::Index);
                }
            }
        }
        Ok(())
    }
}

/// The corner code of a page's indices: each block's smallest corner and width, computed once
/// for the header's word 21 and for the streams.
pub struct Spans {
    spans: Vec<(u32, u32)>,
    /// Bits of the corner stream: what the header's word 21 says.
    pub bits: usize,
}

impl Spans {
    pub fn of(indices: &[u32]) -> Self {
        let (mut spans, mut bits) = (Vec::new(), 0);
        for block in indices.chunks(CORNERS) {
            let base = block.iter().copied().min().unwrap_or(0);
            let width = bits_for(block.iter().copied().max().unwrap_or(0) - base);
            bits += block.len() * width as usize;
            spans.push((base, width));
        }
        Self { spans, bits }
    }

    /// The block table then the corner stream of `indices`, each closed on a word.
    pub fn write(&self, out: &mut BitWriter, indices: &[u32], code: &CornerCode) {
        let mut prefix = 0;
        for &(base, width) in &self.spans {
            out.push(base, code.index_bits);
            out.push(width, WIDTH_BITS);
            out.push(prefix, code.prefix_bits);
            prefix += width;
        }
        out.close();
        for (block, &(base, width)) in indices.chunks(CORNERS).zip(&self.spans) {
            for &corner in block {
                out.push(corner - base, width);
            }
        }
        out.close();
    }
}

#[cfg(test)]
#[path = "triangles_tests.rs"]
mod tests;
