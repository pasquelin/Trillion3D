//! Shared decoder refusals, on pages the encoder would never write, and encoder refusals on
//! attributes no page may carry.

use crate::geometry_page::{encode, Attribute, FLAG_NORMAL, FLAG_UV};
use web_geometry_page_codec as codec;
use web_geometry_page_codec::HEADER_BYTES;

const TRIANGLE: [f32; 9] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];

#[test]
fn the_decoder_refuses_what_the_encoder_never_writes() {
    let good = encode(&[0, 1, 2], &TRIANGLE, &[], -8)
        .expect("encode")
        .bytes;
    assert!(codec::decode(&good, 1 << 20).is_ok());
    // An index past the vertex count, forged in the index stream: two bits per index.
    let mut forged = good.clone();
    forged[HEADER_BYTES] = 0b11_01_00;
    assert_eq!(
        codec::decode(&forged, 1 << 20).unwrap_err(),
        codec::PageError::Index
    );
    // The widest field on the coarsest grid, from the largest minimum: still a finite float, so
    // no page needs a nonfinite refusal and the decoder has none. Three corners on one cell make
    // a single vertex, so the page is its header and one word of `x`.
    let mut extreme = encode(&[0, 1, 2], &[0.0; 9], &[], -8).expect("flat").bytes;
    assert_eq!(extreme.len(), HEADER_BYTES);
    extreme[24..28].copy_from_slice(&f32::MAX.to_le_bytes());
    extreme[20] = 24;
    extreme[23] = 64;
    extreme.extend([0xFFu8; 4]);
    let page = codec::decode(&extreme, 1 << 20).expect("finite");
    assert!(page.position.iter().all(|v| v.is_finite()));
    assert_eq!(
        codec::decode(&good[..good.len() - 1], 1 << 20).unwrap_err(),
        codec::PageError::Bounds
    );
    assert_eq!(
        codec::decode(&good, 8).unwrap_err(),
        codec::PageError::Bounds
    );
}

#[test]
fn the_encoder_refuses_nonfinite_and_ill_shaped_attributes() {
    let normal = |values: Vec<f32>| Attribute {
        flag: FLAG_NORMAL,
        width: 3,
        values,
    };
    let nan = normal(vec![0.0, 0.0, f32::NAN, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0]);
    assert_eq!(
        encode(&[0, 1, 2], &TRIANGLE, &[nan], -8).unwrap_err().code,
        "INVALID_PAGE_ATTRIBUTE"
    );
    let short = normal(vec![0.0; 6]);
    assert_eq!(
        encode(&[0, 1, 2], &TRIANGLE, &[short], -8)
            .unwrap_err()
            .code,
        "INVALID_PAGE_ATTRIBUTE"
    );
    let wide = Attribute {
        flag: FLAG_UV,
        width: 3,
        values: vec![0.0; 9],
    };
    assert_eq!(
        encode(&[0, 1, 2], &TRIANGLE, &[wide], -8).unwrap_err().code,
        "INVALID_PAGE_ATTRIBUTE"
    );
    assert_eq!(
        encode(&[0, 1], &TRIANGLE, &[], -8).unwrap_err().code,
        "INVALID_PAGE"
    );
}
