//! The grids of a page: a constant colour costs nothing, the primitive grid follows the size of its
//! finest clusters, vertices on one cell are kept once, every page shares its primitive's
//! precision, and a page beyond that grid is refused.

use trillion3d_page_codec::bits::grid::{Extent, PageGrid, Precision};
use trillion3d_page_codec::encode::{encode, Attribute};
use trillion3d_page_codec::FLAG_COLOR;

/// The box of one cluster of the finest level, `side` metres wide on x and y.
fn cluster(side: f32) -> Extent {
    Extent {
        low: [0.0; 3],
        high: [side, side, 0.0],
        finest: true,
    }
}

#[test]
fn a_constant_colour_costs_no_bits_and_the_primitive_grid_follows_the_finest_clusters() {
    let colour = Attribute {
        flag: FLAG_COLOR,
        width: 3,
        values: vec![0.5, 0.25, 1.0, 0.5, 0.25, 1.0, 0.5, 0.25, 1.0],
    };
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let grid = PageGrid::at(4);
    let plain = encode(&[0, 1, 2], &positions, &[], grid)
        .expect("plain")
        .bytes
        .len();
    let tinted = encode(&[0, 1, 2], &positions, &[&colour], grid).expect("tinted");
    assert_eq!(tinted.bytes.len(), plain);
    let page = trillion3d_page_codec::decode(&tinted.bytes, 1 << 20).expect("decode");
    let bytes = [128, 64, 255, 255].map(trillion3d_page_codec::bits::color_value);
    assert_eq!(page.attribute(10), Some(&bytes.repeat(3)[..]));
    // A cluster a metre wide is half a diagonal of 70.7 cm: seven less its base-2 logarithm, 6,
    // is 1, under the finest the density alone may pick, a sixteenth of a centimetre.
    let of = |precision, side| PageGrid::of(precision, &[cluster(side)]);
    assert_eq!(of(Precision::default(), 1.0).map(|g| g.position), Some(4));
    // A kilometre cluster fits 2^21 cells at that precision; one and a half do not.
    assert_eq!(
        of(Precision::default(), 1000.0).map(|g| g.position),
        Some(4)
    );
    assert_eq!(
        of(Precision::default(), 1500.0).map(|g| g.position),
        Some(3)
    );
    // A named precision is held, then lowered as far as the widest cluster needs.
    let named = |position| Precision {
        position: Some(position),
        ..Precision::default()
    };
    assert_eq!(of(named(10), 1.0).map(|g| g.position), Some(10));
    assert_eq!(of(named(20), 1000.0).map(|g| g.position), Some(4));
    assert_eq!(of(named(100), 1.0).map(|g| g.position), Some(14));
    // Only the finest clusters set it: a coarse one is fitted but never counted. A hundredth of a
    // millimetre cluster asks for 14; a metre one beside it fits that, and would have said 7.
    let coarse = Extent {
        finest: false,
        ..cluster(1.0)
    };
    let fine = cluster(0.0001);
    let grid = PageGrid::of(Precision::default(), &[coarse, fine]);
    assert_eq!(grid.map(|g| g.position), Some(14));
    // The normals' and tangents' bits are the format's, or the mesh's.
    let bits = Precision {
        normal: Some(12),
        tangent: Some(3),
        ..Precision::default()
    };
    let grid = of(bits, 1.0).expect("grid");
    assert_eq!((grid.normal, grid.tangent), (12, 3));
    let grid = of(Precision::default(), 1.0).expect("grid");
    assert_eq!((grid.normal, grid.tangent), (8, 7));
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
    // A centimetre cell: a metre is a hundred cells, a millionth of one under half a cell.
    let encoded = encode(&[0, 1, 3, 0, 2, 3], &positions, &[], PageGrid::at(0)).expect("encode");
    assert_eq!(encoded.header.vertex_count, 3);
    let page = trillion3d_page_codec::decode(&encoded.bytes, 1 << 20).expect("decode");
    assert_eq!(page.indices(), [0, 1, 2, 0, 1, 2]);
    let decoded = page.attribute(0).expect("position")[3..6].to_vec();
    assert!(decoded
        .iter()
        .zip([1.0, 0.0, 0.0])
        .all(|(d, s)| (d - s).abs() < 1e-6));
}

#[test]
fn every_page_of_a_primitive_shares_its_precision_and_a_page_beyond_the_grid_is_refused() {
    // A primitive a kilometre wide: its widest page still fits at the precision of a sixteenth of
    // a centimetre, and a page of a few centimetres sits on the same one.
    let corners = [0.0, 0.0, 0.0, 1000.0, 0.0, 0.0, 0.0, 1000.0, 0.0];
    let grid = PageGrid::of(Precision::default(), &[cluster(1000.0)]).expect("grid");
    assert_eq!(grid.position, 4);
    let near = [0.0, 0.0, 0.0, 0.05, 0.0, 0.0, 0.0, 0.05, 0.0];
    for page in [&corners, &near] {
        let encoded = encode(&[0, 1, 2], page, &[], grid).expect("page on the grid");
        let header = trillion3d_page_codec::Header::parse(&encoded.bytes, 1 << 20).expect("header");
        assert_eq!(header.position.precision, grid.position);
    }
    // A page wider than 2^21 cells of the grid it was given is refused, never re-gridded.
    let wide = [0.0, 0.0, 0.0, 1e5, 0.0, 0.0, 0.0, 1e5, 0.0];
    assert_eq!(
        encode(&[0, 1, 2], &wide, &[], grid).unwrap_err().code,
        "PAGE_ATTRIBUTE_RANGE"
    );
    // Too wide for the coarsest precision: no grid.
    let beyond = Extent {
        low: [-f32::MAX, 0.0, 0.0],
        high: [f32::MAX, 0.0, 0.0],
        finest: true,
    };
    assert!(PageGrid::of(Precision::default(), &[beyond]).is_none());
}
