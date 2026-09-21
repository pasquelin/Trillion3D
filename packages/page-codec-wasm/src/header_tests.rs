//! Refusals of the page header, in the order the JavaScript decoder raises them.

use super::*;

fn octets(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|w| w.to_le_bytes()).collect()
}

/// A one-triangle page with no optional attribute and constant positions: only the header.
fn page() -> Header {
    Header {
        vertex_count: 3,
        index_count: 3,
        flags: 0,
        position: Quant::flat(-8),
        uv: Quant::flat(-16),
        uv1: Quant::flat(-16),
        color: Quant::flat(-8),
        quantization_error: 0.0,
    }
}

#[test]
fn short_header_then_magic_then_bounds_are_refused_in_that_order() {
    assert_eq!(decode(&[0u8; 8], 1 << 24).unwrap_err(), PageError::Header);
    let mut wrong = octets(&page().words());
    wrong[0] ^= 1;
    assert_eq!(decode(&wrong, 1 << 24).unwrap_err(), PageError::Version);
    let index_stream = octets(&[0]);
    let mut expected = octets(&page().words());
    expected.extend(&index_stream);
    assert!(decode(&expected, 1 << 24).is_ok());
    for alter in [
        |h: &mut Header| h.vertex_count = 0,
        |h: &mut Header| h.vertex_count = MAX_VERTICES + 1,
        |h: &mut Header| h.index_count = 4,
        |h: &mut Header| h.flags = 16,
        |h: &mut Header| h.position.bits[1] = 25,
        |h: &mut Header| h.uv.exponent = 65,
        |h: &mut Header| h.quantization_error = -1.0,
        |h: &mut Header| h.uv1.min[0] = f32::INFINITY,
        |h: &mut Header| h.color.bits[3] = 25,
    ] {
        let mut header = page();
        alter(&mut header);
        let mut bytes = octets(&header.words());
        bytes.extend(&index_stream);
        assert_eq!(decode(&bytes, 1 << 24).unwrap_err(), PageError::Bounds);
    }
    assert_eq!(
        decode(&octets(&page().words()), 1 << 24).unwrap_err(),
        PageError::Bounds
    );
    let mut reserved = expected.clone();
    reserved[HEADER_BYTES - 1] = 1;
    assert_eq!(decode(&reserved, 1 << 24).unwrap_err(), PageError::Bounds);
}

#[test]
fn the_decoded_budget_is_refused_before_any_stream_is_read() {
    let mut bytes = octets(&page().words());
    bytes.extend(octets(&[0]));
    assert_eq!(decode(&bytes, 8).unwrap_err(), PageError::Bounds);
}

#[test]
fn a_forged_index_count_is_refused_by_the_budget_before_any_allocation() {
    // One vertex, so indices cost zero bits and the layout matches an empty stream; three
    // times 2^30 indices, whose byte count wraps a 32-bit `usize` to zero without saturation.
    let mut header = page();
    header.vertex_count = 1;
    header.index_count = 3 << 30;
    assert_eq!(
        decode(&octets(&header.words()), 1 << 24).unwrap_err(),
        PageError::Bounds
    );
    assert_eq!(
        header.decoded_bytes(),
        (3usize << 30).saturating_mul(4).saturating_add(12)
    );
}
