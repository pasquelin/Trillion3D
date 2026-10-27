//! The strands of a groom packed into groups: the ending point, the shuffle and the radius.
use super::{groom, groups, point, row, SHUFFLED};
use crate::hair_strands::abi::HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT;
use crate::hair_strands::build::Group;
use crate::hair_strands::description::Widths;
use half::f16;

// Behaviour: a strand of three points is a curve of four, the last a tenth of the last segment past
// the end; the points lie relative to the centre of the box in half floats, with their distance along
// the curve and their radius over the greatest, and the first, the last and the others say so.
#[test]
fn a_linear_curve_is_packed_with_its_ending_point() {
    let built = groups(&groom(&[3], &row(0.0, 3)), true);
    assert_eq!(built.len(), 1);
    let group = &built[0];
    assert_eq!(group.curves, [4 << 24], "the first point 0, four points");
    assert_eq!(group.points.len(), 4 * 8);
    assert_eq!(
        point(group, 0),
        ([0xbc33, 0, 0], 0, 63 | 1 << 6),
        "the first point"
    );
    assert_eq!(point(group, 1), ([0xaa66, 0, 0], 121, 63));
    assert_eq!(point(group, 2), ([0x3b9a, 0, 0], 242, 63));
    assert_eq!(
        point(group, 3),
        ([0x3c33, 0, 0], 255, 63 | 2 << 6),
        "the ending point"
    );
    assert_eq!(group.lengths, [0x4033], "2.1 as a half float");
    assert_eq!((group.low, group.high), ([0.0; 3], [2.1, 0.0, 0.0]));
    assert_eq!((group.max_length, group.max_radius), (2.1, 0.01));
    assert_eq!(group.flags, HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT | SHUFFLED);
    assert_eq!((group.source_curves, group.source_points), (1, 3));
}

// Behaviour: a curve of two points and the control polygon of a cubic of four are built alike — the
// type of a curve does not change how it is drawn through its points. The curves of a group are
// shuffled: of two, the second comes first, and each takes its points with it.
#[test]
fn a_line_and_a_cubic_polygon_follow_one_another_in_a_group_in_the_shuffled_order() {
    let mut points = row(0.0, 2);
    points.extend([
        [0.0, 1.0, 0.0],
        [1.0, 2.0, 0.0],
        [2.0, 2.0, 0.0],
        [3.0, 1.0, 0.0],
    ]);
    let built = groups(&groom(&[2, 4], &points), true);
    let group = &built[0];
    assert_eq!(
        group.curves,
        [5 << 24, 5 | 3 << 24],
        "the cubic of five points first, then the line of three"
    );
    assert_eq!(group.points.len(), 8 * 8);
    assert_eq!(
        point(group, 4).2 >> 6,
        2,
        "the cubic ends at its ending point"
    );
    assert_eq!(point(group, 5).2 >> 6, 1, "the line starts after it");
    assert_eq!(
        point(group, 0).0,
        [f16::from_f32(-1.55).to_bits(), 0, 0],
        "the cubic's first point, 1.55 left of the box's centre and at its height"
    );
}

// Behaviour: the radius of a point is half the width its point gives, else its strand, else the
// groom; it is written over the greatest radius of the group, on six bits. The curves are shuffled,
// the radius of each stays with its curve.
#[test]
fn widths_are_the_points_then_the_strands_then_the_grooms() {
    let radius = |group: &Group, k: usize| point(group, k).2 & 63;
    let mut strands = groom(&[2, 2], &[row(0.0, 2), row(5.0, 2)].concat());
    strands.widths = Widths::Strand(vec![0.02, 0.04]);
    let built = groups(&strands, true);
    let group = &built[0];
    assert_eq!(group.max_radius, 0.02);
    assert_eq!(
        (radius(group, 0), radius(group, 3)),
        (63, 31),
        "the wide strand came first, then half of it"
    );
    let mut points = groom(&[3], &row(0.0, 3));
    points.widths = Widths::Vertex(vec![0.0, 0.02, 0.04]);
    let built = groups(&points, true);
    let group = &built[0];
    let seen: Vec<u8> = (0..4).map(|k| radius(group, k)).collect();
    assert_eq!(
        seen,
        [0, 31, 63, 63],
        "the ending point has the last point's width"
    );
    let plain = groups(&groom(&[2], &row(0.0, 2)), true);
    assert_eq!(
        radius(&plain[0], 0),
        63,
        "the groom's width is the greatest, and all"
    );
    let mut undeclared = groom(&[2], &row(0.0, 2));
    undeclared.groom_width = None;
    assert_eq!(
        groups(&undeclared, true)[0].max_radius,
        0.00005,
        "a groom that declares no width has the default one, a tenth of a millimetre"
    );
}

// Behaviour: the curves of a group are shuffled by the stream the reference seeds with 0xdeedbeed: each
// curve in turn is swapped with the one the stream draws, its first number times the count. The orders
// below are computed apart, from the generator's definition (a congruence over 32 bits whose top 23
// bits make a float from 1 to 2), for six and for ten curves; the seeds follow the shuffled order.
#[test]
fn the_curves_of_a_group_are_shuffled_by_the_fixed_stream() {
    let expected: [(usize, &[usize]); 2] = [
        (6, &[3, 5, 1, 4, 0, 2]),
        (10, &[7, 8, 3, 5, 4, 1, 9, 6, 0, 2]),
    ];
    for (curves, order) in expected {
        // Curve `i` starts at x = 10 i and is i + 1 long: its length and first point tell it.
        let points: Vec<[f32; 3]> = (0..curves)
            .flat_map(|i| {
                [
                    [10.0 * i as f32, 0.0, 0.0],
                    [10.0 * i as f32 + i as f32 + 1.0, 0.0, 0.0],
                ]
            })
            .collect();
        let built = groups(&groom(&vec![2; curves], &points), true);
        let group = &built[0];
        assert_eq!(group.flags & SHUFFLED, SHUFFLED);
        let lengths: Vec<usize> = group
            .lengths
            .iter()
            .map(|&bits| (f16::from_bits(bits).to_f32() / 1.1).round() as usize - 1)
            .collect();
        assert_eq!(lengths, order, "{curves} curves");
        let centre = (0.0 + (10.0 * (curves - 1) as f32 + curves as f32 * 1.1)) * 0.5;
        for (rank, &source) in order.iter().enumerate() {
            let at = group.curves[rank] as usize & 0xFF_FFFF;
            let x = f16::from_bits(u16::from_le_bytes([
                group.points[at * 8],
                group.points[at * 8 + 1],
            ]));
            let wanted = 10.0 * source as f32 - centre;
            assert!(
                (x.to_f32() - wanted).abs() < 0.05,
                "curve {source} at rank {rank}"
            );
        }
    }
    let many = groups(&groom(&[2; 6], &row(0.0, 12)), true);
    assert_eq!(many[0].seeds, [53, 156, 244, 246, 68, 67]);
}
