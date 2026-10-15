//! What the one ear cut guarantees on convex and nearly convex rings.
use super::tests::{cut, flat_ring};
use crate::tests::ngons::{cut_area, U_RING};

/// A regular polygon of `sides` corners, tilted out of every axis plane so the projection is
/// not the ring itself.
fn regular(sides: usize) -> Vec<[f64; 3]> {
    (0..sides)
        .map(|rank| {
            let angle = std::f64::consts::TAU * rank as f64 / sides as f64;
            let (x, y) = (angle.cos(), angle.sin());
            [x, y * 0.8 + 0.1, 0.3 * x - 0.5 * y]
        })
        .collect()
}

// Behaviour: a strictly convex ring is cut along the fan from its first corner — same triangles,
// same order — in both walk senses, for a tilted ring as for the axis-aligned quads that fill most
// scenes: the output of a convex scene does not move by one index.
#[test]
fn a_convex_ring_is_cut_along_its_fan() {
    let square = flat_ring(&[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]);
    let upright = vec![
        [0.0, 0.0, 0.0],
        [2.0, 0.0, 0.0],
        [2.0, 0.0, 1.0],
        [0.0, 0.0, 1.0],
    ];
    let rings = (3..12usize).map(regular).chain([square, upright]);
    for (rank, mut ring) in rings.enumerate() {
        for sense in ["direct", "reversed"] {
            let fan: Vec<[usize; 3]> = (1..ring.len() - 1).map(|k| [0, k, k + 1]).collect();
            assert_eq!(cut(&ring), (fan, true), "ring {rank}, {sense}");
            ring.reverse();
        }
    }
}

// Behaviour: a ring that is not strictly convex keeps the area it declares — the U turns back on
// itself, a corner in the middle of a side or a duplicated corner turns by zero — and a star,
// which turns the same way at every corner but crosses itself, still gets its three triangles.
#[test]
fn a_ring_that_is_not_strictly_convex_keeps_its_area() {
    let (u, exact) = cut(&flat_ring(&U_RING));
    assert!(exact);
    assert!((cut_area(&flat_ring(&U_RING), &u) - 7.0).abs() < 1e-9);
    for ring in [
        flat_ring(&[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]]),
        flat_ring(&[[0.0, 0.0], [2.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]]),
    ] {
        let (triangles, exact) = cut(&ring);
        assert!(exact);
        assert!((cut_area(&ring, &triangles) - 4.0).abs() < 1e-9);
    }
    let pentagon = regular(5);
    let star: Vec<[f64; 3]> = (0..5).map(|rank| pentagon[rank * 2 % 5]).collect();
    assert_eq!(cut(&star).0.len(), 3);
}

// Behaviour: a ring with no plane never reaches the convex test. A corner that is not a
// number leaves the ring without a normal: the cut comes out as a fan and says it was not
// exact, as it did before — the collinear ring is proved the same way in `tests`.
#[test]
fn a_ring_with_no_plane_is_still_a_counted_fan() {
    let broken = [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [f64::NAN, 1.0, 0.0],
        [0.0, 1.0, 0.0],
    ];
    let (triangles, exact) = cut(&broken);
    assert!(!exact, "no plane, no ear: the face is counted");
    assert_eq!(
        triangles,
        [[0, 1, 2], [0, 2, 3]],
        "the fan, for lack of better"
    );
}
