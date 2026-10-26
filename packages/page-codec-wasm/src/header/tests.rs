//! Refusals of the resident page's header, in the order the decoder raises them.

use crate::*;

fn octets(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|w| w.to_le_bytes()).collect()
}

/// A one-triangle page with no optional attribute and constant positions: only the header.
fn page() -> Header {
    Header {
        vertex_count: 3,
        index_count: 3,
        flags: 0,
        position: PositionGrid::flat(4),
        uv: [UvRange::default(); MAX_UV_SETS],
        color: ColorRange::default(),
        normal_precision: 8,
        tangent_precision: 7,
        corner_bits: 0,
        position_count: 3,
        skin: Skin::default(),
        morphs: Vec::new(),
    }
}

#[test]
fn short_header_then_magic_then_bounds_are_refused_in_that_order() {
    assert_eq!(
        decode_resident(&[0u8; 8], 1 << 24).unwrap_err(),
        PageError::Header
    );
    let mut wrong = octets(&page().words(RESIDENT_VERSION));
    wrong[0] ^= 1;
    assert_eq!(
        decode_resident(&wrong, 1 << 24).unwrap_err(),
        PageError::Version
    );
    let index_stream = octets(&[0]);
    let mut expected = octets(&page().words(RESIDENT_VERSION));
    expected.extend(&index_stream);
    assert!(decode_resident(&expected, 1 << 24).is_ok());
    for alter in [
        |h: &mut Header| h.vertex_count = 0,
        |h: &mut Header| h.vertex_count = MAX_VERTICES + 1,
        |h: &mut Header| h.index_count = 4,
        |h: &mut Header| h.flags = 64,
        |h: &mut Header| h.position.bits[1] = 25,
        |h: &mut Header| h.position.precision = 44,
        |h: &mut Header| h.normal_precision = 0,
        |h: &mut Header| h.uv[1].min[0] = 1 << 20,
        |h: &mut Header| h.color.bits[3] = 9,
        |h: &mut Header| h.position_count = 0,
        |h: &mut Header| h.position_count = 4,
    ] {
        let mut header = page();
        alter(&mut header);
        let mut bytes = octets(&header.words(RESIDENT_VERSION));
        bytes.extend(&index_stream);
        assert_eq!(
            decode_resident(&bytes, 1 << 24).unwrap_err(),
            PageError::Bounds
        );
    }
    assert_eq!(
        decode_resident(&octets(&page().words(RESIDENT_VERSION)), 1 << 24).unwrap_err(),
        PageError::Bounds
    );
    let mut reserved = expected.clone();
    reserved[HEADER_BYTES - 1] = 1;
    assert_eq!(
        decode_resident(&reserved, 1 << 24).unwrap_err(),
        PageError::Bounds
    );
}

#[test]
fn the_decoded_budget_is_refused_before_any_stream_is_read() {
    let mut bytes = octets(&page().words(RESIDENT_VERSION));
    bytes.extend(octets(&[0]));
    assert_eq!(decode_resident(&bytes, 8).unwrap_err(), PageError::Bounds);
}

#[test]
fn a_forged_index_count_is_refused_by_the_budget_before_any_allocation() {
    // One vertex, so indices cost zero bits and the layout matches an empty stream; three
    // times 2^30 indices, whose byte count wraps a 32-bit `usize` to zero without saturation.
    let mut header = page();
    header.vertex_count = 1;
    header.position_count = 1;
    header.index_count = 3 << 30;
    assert_eq!(
        decode_resident(&octets(&header.words(RESIDENT_VERSION)), 1 << 24).unwrap_err(),
        PageError::Bounds
    );
    assert_eq!(
        header.decoded_bytes(),
        (3usize << 30).saturating_mul(4).saturating_add(12)
    );
}

#[test]
fn the_texture_sets_past_the_fourth_cost_words_only_where_a_page_carries_them() {
    let mut header = page();
    header.flags = FLAG_UV | FLAG_UV1 | FLAG_UV3;
    assert_eq!(header.bytes(), HEADER_BYTES);
    assert_eq!(
        header.words(RESIDENT_VERSION).len(),
        HEADER_WORDS + RESIDENT_TABLE_WORDS
    );
    header.flags |= FLAG_UV5 | FLAG_UV7;
    header.uv[5] = UvRange {
        min: [3, 4],
        bits: [5, 6],
    };
    header.uv[7] = UvRange {
        min: [7, 8],
        bits: [9, 10],
    };
    let words = header.words(RESIDENT_VERSION);
    assert_eq!(
        words.len(),
        HEADER_WORDS + 2 * UV_EXTENSION_WORDS + RESIDENT_TABLE_WORDS
    );
    assert_eq!(header.body_at(), words.len() * 4);
    let bytes = octets(&words);
    assert_eq!(
        Header::read_words(&bytes, RESIDENT_VERSION).unwrap(),
        header
    );
    let short = &bytes[..bytes.len() - 4 * RESIDENT_TABLE_WORDS - 4];
    assert_eq!(
        Header::read_words(short, RESIDENT_VERSION).unwrap_err(),
        PageError::Bounds
    );
}
