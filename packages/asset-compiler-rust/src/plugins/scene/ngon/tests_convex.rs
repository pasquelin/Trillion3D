//! What the convex path guarantees: the fan it writes is the ear cut, triangle for triangle,
//! and every ring the ears could cut otherwise stays with them.
use super::tests::{cut, flat_ring};
use super::{convex, Ngon};
use crate::tests::ngones::U_RING;

/// A cutter holding the ring, projected in its plane, with the walk sense of that plane.
fn projected(ring: &[[f64; 3]]) -> (Ngon, f64) {
    let mut ngon = Ngon::default();
    ngon.begin();
    ring.iter().for_each(|point| ngon.corner(*point));
    let turn = ngon.project().expect("a ring with a plane");
    (ngon, turn)
}

/// Is the ring strictly convex, read as the cut reads it?
fn convex(ring: &[[f64; 3]]) -> bool {
    let (ngon, turn) = projected(ring);
    convex::fan_is_exact(&ngon.flat, turn)
}

/// Ear cut of a ring, forced past the convex path: the reference the fan must match.
fn ears(ring: &[[f64; 3]]) -> (Vec<[usize; 3]>, bool) {
    let (mut ngon, turn) = projected(ring);
    let exact = ngon.ears(turn);
    (ngon.triangles().to_vec(), exact)
}

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

// Behaviour: a strictly convex ring takes the fan path, and that fan is exactly what the
// ears yielded — same triangles, same order, in both walk senses, for a tilted ring too.
// The output of a convex scene therefore does not move by one index.
#[test]
fn the_fan_of_a_convex_ring_is_the_ear_cut_triangle_for_triangle() {
    for sides in 3..12usize {
        let mut ring = regular(sides);
        for sense in ["direct", "reversed"] {
            assert!(convex(&ring), "{sides} sides, {sense}");
            let (fan, exact) = cut(&ring);
            assert!(exact, "{sides} sides, {sense}: the fan is exact");
            assert_eq!(fan, ears(&ring).0, "{sides} sides, {sense}");
            assert_eq!(fan.len(), sides - 2, "{sides} sides, {sense}");
            ring.reverse();
        }
    }
}

// Behaviour: a ring that is not strictly convex keeps the ear path, so its cut is the one it
// always had. The U turns back on itself; the star turns the same way at every corner but
// swings round twice; the square with a corner in the middle of a side turns by zero there;
// the duplicated corner turns by zero too.
#[test]
fn a_ring_that_is_not_strictly_convex_keeps_the_ear_cut() {
    let star: Vec<[f64; 2]> = (0..5)
        .map(|rank| {
            let angle = std::f64::consts::TAU * (rank * 2) as f64 / 5.0;
            [angle.cos(), angle.sin()]
        })
        .collect();
    let rings = [
        ("U", flat_ring(&U_RING)),
        ("star", flat_ring(&star)),
        (
            "collinear corner",
            flat_ring(&[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]]),
        ),
        (
            "duplicated corner",
            flat_ring(&[[0.0, 0.0], [2.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]]),
        ),
    ];
    for (name, ring) in rings {
        assert!(!convex(&ring), "{name} is not convex");
        assert_eq!(cut(&ring), ears(&ring), "{name}: the cut is the ear cut");
    }
}

// Behaviour: a ring with no plane never reaches the convex test. Every corner on one line, or
// a corner that is not a number: the cut comes out as a fan and says it was not exact, as it
// did before.
#[test]
fn a_ring_with_no_plane_is_still_a_counted_fan() {
    let line = flat_ring(&[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0]]);
    let broken = [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [f64::NAN, 1.0, 0.0],
        [0.0, 1.0, 0.0],
    ];
    for ring in [line, broken.to_vec()] {
        let (triangles, exact) = cut(&ring);
        assert!(!exact, "no plane, no ear: the face is counted");
        assert_eq!(
            triangles,
            [[0, 1, 2], [0, 2, 3]],
            "the fan, for lack of better"
        );
    }
}
