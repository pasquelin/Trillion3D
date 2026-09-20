//! The grids of a page: a constant colour costs nothing, the primitive grid follows the finest
//! group error, vertices on one cell are kept once, and a page beyond every grid is refused.

use crate::geometry_page::{encode, Attribute, FLAG_COLOR};
use crate::geometry_page_quant::primitive_exponent;
use web_geometry_page_codec as codec;

#[test]
fn a_constant_colour_costs_no_bits_and_the_primitive_grid_follows_the_finest_error() {
    let colour = Attribute {
        flag: FLAG_COLOR,
        width: 3,
        values: vec![0.5, 0.25, 1.0, 0.5, 0.25, 1.0, 0.5, 0.25, 1.0],
    };
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let plain = encode(&[0, 1, 2], &positions, &[], -8)
        .expect("plain")
        .bytes
        .len();
    let tinted = encode(&[0, 1, 2], &positions, &[colour], -8).expect("tinted");
    assert_eq!(tinted.bytes.len(), plain);
    let page = codec::decode(&tinted.bytes, 1 << 20).expect("decode");
    assert_eq!(
        page.optional[3].as_deref(),
        Some(&[0.5, 0.25, 1.0, 1.0].repeat(3)[..])
    );
    // A primitive one unit wide: 2^-16 by extent; an error of 2^-15 asks for 2^-18, the finer.
    assert_eq!(primitive_exponent(&positions, [0.5f64].into_iter()), -16);
    assert_eq!(
        primitive_exponent(&positions, [0.0, 2f64.powi(-15)].into_iter()),
        -18
    );
    assert_eq!(primitive_exponent(&[0.0; 3], [].into_iter()), -16);
}

#[test]
fn vertices_on_the_same_grid_cells_are_kept_once() {
    // Two corners a hair apart on a coarse grid, and a third copy exactly equal: one vertex.
    let positions = [
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        1.0 + 1e-6,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
    ];
    let encoded = encode(&[0, 1, 3, 0, 2, 3], &positions, &[], -4).expect("encode");
    assert_eq!(encoded.vertex_count, 3);
    let page = codec::decode(&encoded.bytes, 1 << 20).expect("decode");
    assert_eq!(page.indices, [0, 1, 2, 0, 1, 2]);
    assert_eq!(page.position[3..6], [1.0, 0.0, 0.0]);
}

#[test]
fn a_page_wider_than_its_grid_coarsens_and_a_page_beyond_any_grid_is_refused() {
    let wide = [0.0, 0.0, 0.0, 1e9, 0.0, 0.0, 0.0, 1e9, 0.0];
    let encoded = encode(&[0, 1, 2], &wide, &[], -16).expect("coarsened");
    let page = codec::decode(&encoded.bytes, 1 << 20).expect("decode");
    assert!((f64::from(page.position[3]) - 1e9).abs() <= encoded.quantization_error);
    let beyond = [-f32::MAX, 0.0, 0.0, f32::MAX, 0.0, 0.0, 0.0, 0.0, 0.0];
    assert_eq!(
        encode(&[0, 1, 2], &beyond, &[], -16).unwrap_err().code,
        "INVALID_PAGE_ATTRIBUTE"
    );
}
