//! A page that stores its positions once: each vertex decodes to the position its link names,
//! and a link past the stored positions refuses the page before any stream is decoded.

use crate::bits::Quant;
use crate::triangles::{CornerCode, Spans};
use crate::writer::BitWriter;
use crate::{decode, Header, PageError};

/// Four vertices on one triangle, `positions` stored with `x` equal to their rank, and `links`.
fn page(positions: usize, links: &[u32]) -> Vec<u8> {
    let indices = [0, 1, 2, 0, 2, 3];
    let spans = Spans::of(&indices);
    let h = Header {
        vertex_count: 4,
        index_count: indices.len(),
        flags: 0,
        position: Quant {
            min: [0.0; 3],
            exponent: 0,
            bits: [2, 0, 0],
        },
        uv: Quant::flat(-14),
        uv1: Quant::flat(-14),
        color: Quant::flat(-8),
        quantization_error: 0.0,
        corner_bits: spans.bits,
        position_count: positions,
        skin: crate::Skin::default(),
        morphs: Vec::new(),
    };
    let mut out = BitWriter::default();
    spans.write(
        &mut out,
        &indices,
        &CornerCode::of(4, indices.len(), spans.bits),
    );
    out.stream(0..positions as u32, 2);
    if h.links_positions() {
        out.stream(links.iter().copied(), h.link_bits());
    }
    let words = h.words().into_iter().chain(out.words().iter().copied());
    words.flat_map(u32::to_le_bytes).collect()
}

fn xs(data: &[u8]) -> Result<Vec<f32>, PageError> {
    let page = decode(data, 1 << 20)?;
    let positions = page.attribute(0).expect("positions");
    Ok(positions.iter().step_by(3).copied().collect())
}

#[test]
fn each_vertex_decodes_to_the_position_its_link_names() {
    assert_eq!(xs(&page(3, &[2, 0, 2, 1])), Ok(vec![2.0, 0.0, 2.0, 1.0]));
    // One stored position serves every vertex: links of no bit.
    assert_eq!(xs(&page(1, &[])), Ok(vec![0.0; 4]));
    // As many positions as vertices: no link, one position each.
    assert_eq!(xs(&page(4, &[])), Ok(vec![0.0, 1.0, 2.0, 3.0]));
}

#[test]
fn a_link_past_the_stored_positions_is_refused() {
    assert_eq!(xs(&page(3, &[0, 1, 3, 2])), Err(PageError::Bounds));
}
