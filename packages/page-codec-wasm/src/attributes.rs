//! Deinterleaving of a decompressed page: the mirror of `decodePageAttributes`.

use crate::{PageError, Vertex, STRIDE};

/// Presence bit and float width of each optional attribute, in vertex order: normal, uv, tangent,
/// uv2, colour. Position occupies the first three floats.
pub const OPTIONAL: [(u32, usize); 5] = [(1, 3), (2, 2), (4, 4), (8, 2), (16, 4)];

/// Buffers of a page: 32-bit indices, position, then the optional attributes present at their
/// rank in `OPTIONAL`. `decoded_bytes` is filled by the caller.
pub struct DecodedPage {
    pub indices: Vec<u32>,
    pub position: Vec<f32>,
    pub optional: [Option<Vec<f32>>; 5],
    pub vertex_count: usize,
    pub flags: u32,
    pub decoded_bytes: usize,
}

/// A decoded page is summarised by its counts: printing its buffers would teach nothing.
impl core::fmt::Debug for DecodedPage {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "DecodedPage {{ vertices: {}, indices: {}, flags: {} }}",
            self.vertex_count,
            self.indices.len(),
            self.flags
        )
    }
}

/// Where to read each attribute in a vertex: its rank (`None` for position), its width and its
/// offset in floats. The offset does not depend on the flags — an absent attribute leaves its
/// hole — exactly like the JavaScript decoder's layout.
fn plan(flags: u32) -> Vec<(Option<usize>, usize, usize)> {
    let mut plan = Vec::with_capacity(6);
    plan.push((None, 3, 0));
    let mut place = 3;
    for (rang, &(bit, size)) in OPTIONAL.iter().enumerate() {
        if flags & bit != 0 {
            plan.push((Some(rang), size, place));
        }
        place += size;
    }
    plan
}

fn lis(vertex: &Vertex, at: usize) -> f32 {
    let octets = &vertex.0[at * 4..at * 4 + 4];
    f32::from_le_bytes([octets[0], octets[1], octets[2], octets[3]])
}

fn vides(vertex_count: usize, flags: u32) -> [Option<Vec<f32>>; 5] {
    let mut sortie: [Option<Vec<f32>>; 5] = [None, None, None, None, None];
    for (rang, &(bit, size)) in OPTIONAL.iter().enumerate() {
        if flags & bit != 0 {
            sortie[rang] = Some(vec![0f32; vertex_count * size]);
        }
    }
    sortie
}

/// Indices first, all checked before a single float is read, then the attributes.
pub fn split(
    local: &[u16],
    vertices: &[Vertex],
    vertex_count: usize,
    flags: u32,
) -> Result<DecodedPage, PageError> {
    let indices: Vec<u32> = local.iter().map(|&i| u32::from(i)).collect();
    for &index in &indices {
        if index as usize >= vertex_count {
            return Err(PageError::Index);
        }
    }
    let plan = plan(flags);
    let mut position = vec![0f32; vertex_count * 3];
    let mut optional = vides(vertex_count, flags);
    debug_assert_eq!(STRIDE / 4, 18);
    for (i, vertex) in vertices.iter().enumerate().take(vertex_count) {
        for &(rang, size, place) in &plan {
            let cible: &mut [f32] = match rang {
                None => &mut position,
                Some(rang) => optional[rang].as_mut().expect("attribute present"),
            };
            for c in 0..size {
                let value = lis(vertex, place + c);
                if !value.is_finite() {
                    return Err(PageError::Nonfinite);
                }
                cible[i * size + c] = value;
            }
        }
    }
    Ok(DecodedPage {
        indices,
        position,
        optional,
        vertex_count,
        flags,
        decoded_bytes: 0,
    })
}
