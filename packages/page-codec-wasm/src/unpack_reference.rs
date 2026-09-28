//! Develop's decoder, kept as the reference of the equivalence harness (`unpack_tests.rs`, #238):
//! every field read at random, the first corner out of range refusing.

use super::*;
use crate::bits::tests::random_field;
use crate::triangles::{BLOCK, WIDTH_BITS};

const CORNERS: usize = 3 * BLOCK;

fn random_vector<const N: usize>(out: &mut [u32], w: &[u32], at: [usize; N], q: &Quant<N>) {
    for c in 0..N {
        for (i, vertex) in out.as_chunks_mut::<N>().0.iter_mut().enumerate() {
            let field = random_field(w, at[c] * 32 + i * q.bits[c] as usize, q.bits[c]);
            vertex[c] = dequant(q.min[c], field, q.step()).to_bits();
        }
    }
}

/// Develop's decoder, field by field.
pub fn reference(data: &[u8], max: usize) -> Result<Vec<u32>, PageError> {
    let h = Header::parse(data, max)?;
    let w: Vec<u32> = le_words(&data[HEADER_BYTES..]).collect();
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
    random_vector(take(3), &w, l.position, &h.position);
    if h.flags & FLAG_NORMAL != 0 {
        for (i, normal) in take(3).as_chunks_mut::<3>().0.iter_mut().enumerate() {
            *normal = oct_decode(random_field(&w, l.normal * 32 + i * 16, 16)).map(f32::to_bits);
        }
    }
    let flag = |bit| h.flags & bit != 0;
    if flag(FLAG_UV) {
        random_vector(take(2), &w, l.uv, &h.uv);
    }
    if flag(FLAG_UV1) {
        random_vector(take(2), &w, l.uv1, &h.uv1);
    }
    if flag(FLAG_COLOR) {
        random_vector(take(4), &w, l.color, &h.color);
    }
    Ok(out)
}
