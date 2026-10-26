//! The reference decoder of the equivalence harness (`tests.rs`): every field read at
//! random, the first corner out of range refusing. It reads a vertex's position through its
//! link, the one line the plain decoder lacks: the link rule itself is proved by
//! `positions/tests.rs` and `positions.test.ts`.

use super::*;
use crate::bits::normal_decode;
use crate::bits::tests::random_field;
use crate::triangles::{TRIANGLE_BLOCK, WIDTH_BITS};

const CORNERS: usize = 3 * TRIANGLE_BLOCK;

/// Vertex `i`'s field of stream `c`, `bits[c]` wide from word `at[c]`, read at random.
fn field_of<const N: usize>(
    w: &[u32],
    (at, bits): ([usize; N], [u32; N]),
    c: usize,
    i: usize,
) -> u32 {
    random_field(w, at[c] * 32 + i * bits[c] as usize, bits[c])
}

fn random_vector<const N: usize>(
    out: &mut [u32],
    w: &[u32],
    streams: ([usize; N], [u32; N]),
    value: impl Fn(usize, u32) -> f32,
) {
    for c in 0..N {
        for (i, vertex) in out.as_chunks_mut::<N>().0.iter_mut().enumerate() {
            vertex[c] = value(c, field_of(w, streams, c, i)).to_bits();
        }
    }
}

/// The reference decoder, field by field.
pub fn reference(data: &[u8], max: usize) -> Result<Vec<u32>, PageError> {
    let h = Header::parse_resident(data, max)?;
    let w: Vec<u32> = le_words(&data[h.body_at()..]).collect();
    let (l, n) = (Layout::of(&h), h.vertex_count);
    let mut out = vec![0u32; h.decoded_bytes() / 4];
    let (indices, mut rest) = out.split_at_mut(h.index_count);
    let (code, [table, stream]) = (l.corners, l.triangles);
    for (b, block) in indices.chunks_mut(CORNERS).enumerate() {
        let at = table * 32 + b * code.record_bits() as usize;
        let ib = code.index_bits as usize;
        let base = random_field(&w, at, code.index_bits);
        let width = random_field(&w, at + ib, WIDTH_BITS);
        let start =
            random_field(&w, at + ib + WIDTH_BITS as usize, code.prefix_bits) as usize * CORNERS;
        for (k, corner) in block.iter_mut().enumerate() {
            *corner = base + random_field(&w, stream * 32 + start + k * width as usize, width);
            if *corner as usize >= n {
                return Err(PageError::Index);
            }
        }
    }
    let mut take = |width: usize| {
        let (head, tail) = core::mem::take(&mut rest).split_at_mut(n * width);
        rest = tail;
        head
    };
    let (grid, link_bits) = (&h.position, h.link_bits());
    let unit = grid.unit();
    for (i, vertex) in take(3).as_chunks_mut::<3>().0.iter_mut().enumerate() {
        let at = if h.links_positions() {
            random_field(&w, l.links * 32 + i * link_bits as usize, link_bits) as usize
        } else {
            i
        };
        *vertex = core::array::from_fn(|c| {
            let offset = field_of(&w, (l.position, grid.bits), c, at);
            grid.metres(c, offset, unit).to_bits()
        });
    }
    if h.flags & FLAG_NORMAL != 0 {
        for (i, normal) in take(3).as_chunks_mut::<3>().0.iter_mut().enumerate() {
            let cells = [0, 1].map(|c| field_of(&w, (l.normal, [h.normal_precision; 2]), c, i));
            *normal = normal_decode(cells, h.normal_precision).map(f32::to_bits);
        }
    }
    for (set, flag) in UV_FLAGS.into_iter().enumerate() {
        if h.flags & flag != 0 {
            let range = &h.uv[set];
            let streams = (l.uv[set], range.bits);
            random_vector(take(2), &w, streams, |c, code| {
                uv_value(range.min[c] + code)
            });
        }
    }
    if h.flags & FLAG_COLOR != 0 {
        let range = &h.color;
        let streams = (l.color, range.bits);
        random_vector(take(4), &w, streams, |c, byte| {
            color_value(range.min[c] + byte)
        });
    }
    Ok(out)
}
