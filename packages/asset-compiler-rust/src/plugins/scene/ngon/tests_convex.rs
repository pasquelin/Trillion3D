//! What the convex path guarantees: the fan it writes is the ear cut, triangle for triangle,
//! and every ring the ears could cut otherwise stays with them.
use super::convex::fan_is_exact;
use super::tests::{cut, flat_ring, loaded};
use super::Ngon;
use crate::tests::ngones::U_RING;

/// A cutter holding the ring, projected in its plane, with the walk sense of that plane.
fn projected(ring: &[[f64; 3]]) -> (Ngon, f64) {
    let mut ngon = loaded(ring);
    let turn = ngon.project().expect("a ring with a plane");
    (ngon, turn)
}

/// Is the ring strictly convex, read as the cut reads it?
fn is_convex(ring: &[[f64; 3]]) -> bool {
    let (ngon, turn) = projected(ring);
    fan_is_exact(&ngon.flat, turn)
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
// ears yielded — same triangles, same order, in both walk senses, for a tilted ring as for
// the axis-aligned quads that fill most scenes, whose vertical steps the swing count skips.
// The output of a convex scene therefore does not move by one index.
#[test]
fn the_fan_of_a_convex_ring_is_the_ear_cut_triangle_for_triangle() {
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
            assert!(is_convex(&ring), "ring {rank}, {sense}");
            let (fan, exact) = cut(&ring);
            assert!(exact, "ring {rank}, {sense}: the fan is exact");
            assert_eq!((fan, exact), ears(&ring), "ring {rank}, {sense}");
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
    let pentagon = regular(5);
    let star: Vec<[f64; 3]> = (0..5).map(|rank| pentagon[rank * 2 % 5]).collect();
    let rings = [
        ("U", flat_ring(&U_RING)),
        ("star", star),
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
        assert!(!is_convex(&ring), "{name} is not convex");
        assert_eq!(cut(&ring), ears(&ring), "{name}: the cut is the ear cut");
    }
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
