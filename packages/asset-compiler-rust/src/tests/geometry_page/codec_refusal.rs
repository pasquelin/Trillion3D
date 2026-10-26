//! Shared decoder refusals, on pages the encoder would never write, and encoder refusals on
//! attributes no page may carry.

use trillion3d_page_codec::bits::grid::PageGrid;
use trillion3d_page_codec::bits::{ColorRange, PositionGrid, UvRange};
use trillion3d_page_codec::clusters::strip::strips_in_order;
use trillion3d_page_codec::encode::{encode, Attribute};
use trillion3d_page_codec::refs::Refs;
use trillion3d_page_codec::streams::{Page, Streams};
use trillion3d_page_codec::triangles::Spans;
use trillion3d_page_codec::{disk, Header, Skin, DISK_HEADER_WORDS, HEADER_BYTES, MAX_UV_SETS};
use trillion3d_page_codec::{FLAG_NORMAL, FLAG_UV, MAX_POSITION_BITS, MIN_POSITION_PRECISION};

const TRIANGLE: [f32; 9] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
/// A grid of cells a sixteenth of a centimetre.
const GRID: PageGrid = PageGrid {
    position: 4,
    normal: 8,
    tangent: 7,
};

#[test]
fn the_decoder_refuses_what_the_encoder_never_writes() {
    let good = encode(&[0, 1, 2], &TRIANGLE, &[], GRID)
        .expect("encode")
        .bytes;
    assert!(trillion3d_page_codec::decode(&good, 1 << 20).is_ok());
    // A strip that goes on past the last triangle, forged in the first word of masks, the first
    // after the header and the words that name the sections: the start bit of a triangle that is
    // not there.
    let mut forged = good.clone();
    forged[HEADER_BYTES + 4 * DISK_HEADER_WORDS] |= 2;
    assert_eq!(
        trillion3d_page_codec::decode(&forged, 1 << 20).unwrap_err(),
        trillion3d_page_codec::PageError::Bounds
    );
    // The widest field on the finest grid, from the farthest start: still a finite float, so no
    // page needs a nonfinite refusal and the decoder has none. Three corners on one cell make a
    // vertex laid three times, whose `x` takes every cell of the widest field.
    let top = (1u32 << MAX_POSITION_BITS) - 1;
    let strips = strips_in_order(&[0, 0, 0]);
    let header = Header {
        vertex_count: 3,
        index_count: 3,
        flags: 0,
        position: PositionGrid {
            start: [i32::MAX - top as i32, 0, 0],
            bits: [MAX_POSITION_BITS, 0, 0],
            precision: MIN_POSITION_PRECISION,
        },
        uv: [UvRange::default(); MAX_UV_SETS],
        color: ColorRange::default(),
        normal_precision: 8,
        tangent_precision: 7,
        corner_bits: Spans::of(&strips.triangles).bits,
        position_count: 1,
        skin: Skin::default(),
        morphs: Vec::new(),
    };
    let values = Streams {
        corners: strips.triangles,
        position: [vec![top], vec![0], vec![0]],
        links: vec![0, 0, 0],
        ..Streams::default()
    };
    let page = Page {
        header,
        streams: values,
        strip: strips.strip,
    };
    let extreme = disk::write(&page, &Refs::none(3));
    let page = trillion3d_page_codec::decode(&extreme, 1 << 20).expect("finite");
    assert!(page
        .attribute(0)
        .expect("position")
        .iter()
        .all(|v| v.is_finite()));
    assert_eq!(
        trillion3d_page_codec::decode(&good[..good.len() - 1], 1 << 20).unwrap_err(),
        trillion3d_page_codec::PageError::Bounds
    );
    assert_eq!(
        trillion3d_page_codec::decode(&good, 8).unwrap_err(),
        trillion3d_page_codec::PageError::Bounds
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
        encode(&[0, 1, 2], &TRIANGLE, &[&nan], GRID)
            .unwrap_err()
            .code,
        "INVALID_PAGE_ATTRIBUTE"
    );
    let short = normal(vec![0.0; 6]);
    assert_eq!(
        encode(&[0, 1, 2], &TRIANGLE, &[&short], GRID)
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
        encode(&[0, 1, 2], &TRIANGLE, &[&wide], GRID)
            .unwrap_err()
            .code,
        "INVALID_PAGE_ATTRIBUTE"
    );
    assert_eq!(
        encode(&[0, 1], &TRIANGLE, &[], GRID).unwrap_err().code,
        "INVALID_PAGE"
    );
}
