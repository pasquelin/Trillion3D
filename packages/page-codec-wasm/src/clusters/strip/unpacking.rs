//! The triangles read back from a strip's code and its counts alone.

use super::*;

/// The three laid indices of triangle `t` of the strip `strip`, read off its code and the counts
/// alone — the vertices the triangles before it laid and named, found in the masks of its word
/// and the counts of the words before.
///
/// Wrapped arithmetic and bounded reads throughout: a code no laying wrote gives indices past the
/// vertices, which the caller refuses, never a panic.
pub fn unpack_triangle(strip: &Strip, t: usize) -> [u32; 3] {
    let word = t / PER_WORD;
    let bit = (t % PER_WORD) as u32;
    let [s, l, w] = strip.masks.get(word).copied().unwrap_or([0; 3]);
    let sl = s & l;
    // Set where the head of the triangle names a vertex: a start naming three, or a growth naming
    // one.
    let head_named = (sl | !s) & w;
    let before = |counts: u32| {
        let shift = (word as u32 * 10).wrapping_sub(10);
        counts.checked_shr(shift).map_or(0, |c| c & 1023)
    };
    let (named_before, laid_before) = (before(strip.named_before), before(strip.laid_before));
    // The vertices named and laid by the triangles before the one at `at` in this word.
    let up_to = |at: u32| {
        let below = (1u32 << (at & 31)).wrapping_sub(1);
        let named = 2 * (sl & below).count_ones() + (w & below).count_ones();
        (named, 2 * (s & below).count_ones() + (at & 31) - named)
    };
    let (named_here, laid_here) = up_to(bit);
    let (named_to, laid_to) = (
        named_before.wrapping_add(named_here),
        laid_before.wrapping_add(laid_here),
    );
    // The five-bit distance at rank `at` among those named, zero before the first and past the last.
    let field = |at: i64| -> u32 {
        usize::try_from(at)
            .ok()
            .and_then(|at| strip.refs.get(at))
            .map_or(0, |&d| d & REF_MASK)
    };
    let bit_of = |mask: u32, at: u32| (mask >> (at & 31)) & 1;
    // A bit as a mask of all bits or none, as the reference reads it.
    let all = |flag: u32| 0u32.wrapping_sub(flag);
    let (is_start, is_left, is_named) = (
        all(bit_of(s, bit)),
        all(bit_of(l, bit)),
        all(bit_of(w, bit)),
    );
    let base = laid_to.wrapping_sub(1);
    // A start reads its distances from the rank of the first vertex named so far; a growth, from
    // the one before it, which its head's distance is.
    let first = i64::from(named_to) + i64::from(!is_start as i32);
    if is_start != 0 {
        // The L and W bits count the vertices named, which come first; the others are laid now.
        let named = 2 * (is_left & 1) + (is_named & 1);
        let mut next_laid = laid_to;
        let mut out = [0u32; 3];
        for (k, slot) in out.iter_mut().enumerate() {
            if (k as u32) < named {
                *slot = base.wrapping_sub(field(first + k as i64));
            } else {
                *slot = next_laid;
                next_laid = next_laid.wrapping_add(1);
            }
        }
        return out;
    }
    // A growth: its first two vertices are the edge it grew across, the third is laid anew or named.
    let previous = bit.wrapping_sub(1);
    let previous_start = all(bit_of(s, previous));
    let previous_head = all(bit_of(head_named, previous));
    let laid_by_previous =
        previous_start & 3u32.wrapping_sub((bit_of(l, previous) << 1) | bit_of(w, previous));
    let v1 = base.wrapping_add(previous_head & laid_by_previous.wrapping_sub(field(first)));
    let v2 = laid_to.wrapping_add(is_named & u32::MAX.wrapping_sub(field(first + 1)));
    // The third vertex is found at the nearest triangle before this one that was laid right of
    // it, for a left growth, or left of it, for a right one — or a start.
    let masked = (s | (l ^ is_left)) & ((1u32 << (bit & 31)).wrapping_sub(1));
    let found = if masked == 0 {
        0
    } else {
        31 - masked.leading_zeros()
    };
    let found_start = all(bit_of(s, found));
    let (found_named_here, found_laid_here) = up_to(found);
    let found_laid = laid_before.wrapping_add(found_laid_here);
    let found_named = named_before.wrapping_add(found_named_here);
    let found_count = (bit_of(l, found) << 1) + bit_of(w, found);
    let found_head_before = if found == 0 {
        0
    } else {
        bit_of(head_named, found - 1)
    };
    let read_offset = if found_start != 0 { is_left as i32 } else { 1 };
    let found_index = found_laid
        .wrapping_sub(1)
        .wrapping_sub(field(i64::from(found_named) - i64::from(read_offset)));
    let (condition, found_new) = if found_start != 0 {
        (
            i64::from(found_count) >= 1 - i64::from(is_left as i32),
            found_laid.wrapping_add(is_left & u32::from(found_count == 0)),
        )
    } else {
        (found_head_before != 0, found_laid.wrapping_sub(1))
    };
    let v0 = if condition { found_index } else { found_new };
    if is_left != 0 {
        [v0, v2, v1]
    } else {
        [v0, v1, v2]
    }
}

/// The corners of the first `triangles` triangles of `strip`, laid indices three to a triangle.
pub fn unpack(strip: &Strip, triangles: usize) -> Vec<u32> {
    (0..triangles)
        .flat_map(|t| unpack_triangle(strip, t))
        .collect()
}
