//! The corners of a page, coded by delta to their block's smallest vertex (CMP-09, #959).
//!
//! Triangles go by blocks of `BLOCK`, in page order. A block's record holds its smallest corner
//! (`base`, at the index width), the `width` each of its corners takes as its distance to that
//! base, and `prefix`, the sum of the widths of the blocks before it: the block's first corner
//! lies at bit `3 * BLOCK * prefix` of the corner stream, so any corner is one record and one field
//! away, in O(1), as a shader reads it in place. A page numbers its vertices by first use, so a
//! block spans few of them. The code is lossless: every corner decodes to the index written, in
//! its order, and the invariant `base + delta == index` is what the tests prove on every input.

use crate::bits::{bits_for, field};
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

    /// Every corner into `out`, the block table at word `table` of `words` and the corner stream at
    /// word `stream`. A record whose corners would leave the stream, a width past 16 or a corner at
    /// or past the vertex count refuses the page.
    pub fn read(
        &self,
        words: &[u32],
        [table, stream]: [usize; 2],
        vertex_count: usize,
        out: &mut [u32],
    ) -> Result<(), PageError> {
        let (ib, rb) = (self.index_bits, self.record_bits() as usize);
        for (b, block) in out.chunks_mut(CORNERS).enumerate() {
            let at = table * 32 + b * rb;
            let base = field(words, at, ib);
            let width = field(words, at + ib as usize, WIDTH_BITS);
            let start =
                field(words, at + (ib + WIDTH_BITS) as usize, self.prefix_bits) as usize * CORNERS;
            if width as usize > MAX_WIDTH || start + block.len() * width as usize > self.bits {
                return Err(PageError::Index);
            }
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

/// Each block's smallest corner and the width its distances to it need.
fn spans(indices: &[u32]) -> impl Iterator<Item = (&[u32], u32, u32)> {
    indices.chunks(CORNERS).map(|block| {
        let base = block.iter().copied().min().unwrap_or(0);
        let top = block.iter().copied().max().unwrap_or(0);
        (block, base, bits_for(top - base))
    })
}

/// Bits of the corner stream that codes `indices`: what the header's word 21 says.
pub fn corner_bits(indices: &[u32]) -> usize {
    spans(indices)
        .map(|(block, _, width)| block.len() * width as usize)
        .sum()
}

/// The block table then the corner stream of `indices`, each closed on a word.
pub fn write(out: &mut BitWriter, indices: &[u32], code: &CornerCode) {
    let mut prefix = 0;
    for (_, base, width) in spans(indices) {
        out.push(base, code.index_bits);
        out.push(width, WIDTH_BITS);
        out.push(prefix, code.prefix_bits);
        prefix += width;
    }
    out.close();
    for (block, base, width) in spans(indices) {
        for &corner in block {
            out.push(corner - base, width);
        }
    }
    out.close();
}

#[cfg(test)]
#[path = "triangles_tests.rs"]
mod tests;
