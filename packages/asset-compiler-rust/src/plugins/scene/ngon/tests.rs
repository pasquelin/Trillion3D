//! What ear clipping guarantees: the area of a simple polygon, the fan on a convex polygon, and
//! a counted output rather than a panic on a ring that nothing makes cuttable.
//!
//! The U ring and the area measure are those of the drivers, in `crate::tests::ngones`: one
//! definition of the audit polygon, and one way to measure what comes out of it.
use super::*;
use crate::tests::ngones::{cut_area, U_RING};

/// A planar ring, placed in the plane `z = 0`.
fn flat_ring(points: &[[f64; 2]]) -> Vec<[f64; 3]> {
    points.iter().map(|[x, y]| [*x, *y, 0.0]).collect()
}

/// Cut of a ring: its triangles, and whether it is exact.
fn cut(ring: &[[f64; 3]]) -> (Vec<[usize; 3]>, bool) {
    let mut ngon = Ngon::default();
    ngon.begin();
    for point in ring {
        ngon.corner(*point);
    }
    let exact = ngon.cut(&AtomicBool::new(false)).expect("token at rest");
    (ngon.triangles().to_vec(), exact)
}

// Behaviour: a concave polygon keeps exactly its area. The fan from the first corner filled the
// hollow of the U and yielded eleven for seven; ears only cut empty triangles, so the sum of
// areas falls back on the written area.
#[test]
fn a_concave_polygon_keeps_its_own_area() {
    let ring = flat_ring(&U_RING);
    let (triangles, exact) = cut(&ring);
    assert!(exact, "a simple U cuts entirely into ears");
    assert_eq!(triangles.len(), 6, "eight corners make six triangles");
    assert!(
        (cut_area(&ring, &triangles) - 7.0).abs() < 1e-9,
        "{triangles:?}"
    );
    let fan: Vec<[usize; 3]> = (1..7).map(|step| [0, step, step + 1]).collect();
    assert!(
        (cut_area(&ring, &fan) - 11.0).abs() < 1e-9,
        "the fan, for its part, yielded eleven"
    );
}

// Behaviour: a convex polygon is cut exactly like the fan from its first corner, index by
// index. A scene that has only convex faces therefore comes out unchanged.
#[test]
fn a_convex_polygon_is_cut_exactly_like_the_fan() {
    for sides in 3..12usize {
        let points: Vec<[f64; 2]> = (0..sides)
            .map(|rank| {
                let angle = std::f64::consts::TAU * rank as f64 / sides as f64;
                [angle.cos(), angle.sin()]
            })
            .collect();
        let ring = flat_ring(&points);
        let (triangles, exact) = cut(&ring);
        let fan: Vec<[usize; 3]> = (1..sides - 1).map(|step| [0, step, step + 1]).collect();
        assert!(exact, "{sides} convex sides");
        assert_eq!(triangles, fan, "{sides} sides: the cut follows the fan");
    }
}

// Behaviour: collinear corners do not stall the cut. The square whose each side carries one
// more vertex keeps its area, and the ring whose every corner is collinear — zero area, no
// plane — comes out counted rather than as a panic.
#[test]
fn collinear_corners_do_not_stall_the_cut() {
    let square = [
        [0.0, 0.0],
        [1.0, 0.0],
        [2.0, 0.0],
        [2.0, 1.0],
        [2.0, 2.0],
        [0.0, 2.0],
    ];
    let ring = flat_ring(&square);
    let (triangles, exact) = cut(&ring);
    assert!(exact, "a square with collinear corners stays simple");
    assert!(
        (cut_area(&ring, &triangles) - 4.0).abs() < 1e-9,
        "{triangles:?}"
    );

    let line = flat_ring(&[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0]]);
    let (degenerate, exact) = cut(&line);
    assert!(!exact, "a ring with no plane is said uncuttable");
    assert_eq!(degenerate.len(), 2, "it still comes out as a fan");
    assert!(cut_area(&line, &degenerate) < 1e-12, "of zero area");
}

// Behaviour: a self-crossing ring does not always have an ear. The cut finishes anyway, yields
// as many triangles as a fan, and a ring of fewer than three corners yields none.
#[test]
fn a_self_crossing_ring_is_cut_rather_than_looping() {
    let bow = flat_ring(&[[0.0, 0.0], [2.0, 2.0], [2.0, 0.0], [0.0, 2.0]]);
    assert_eq!(cut(&bow).0.len(), 2, "four corners make two triangles");
    assert_eq!(cut(&[]).0.len(), 0, "an empty ring yields nothing");
    assert_eq!(cut(&bow[..2]).0.len(), 0, "two corners neither");
}

// Behaviour: the Newell sum of a planar ring is normal to its plane, and its length is twice
// the polygon's area — including when it is concave.
#[test]
fn the_newell_sum_measures_the_polygon() {
    let normal = newell(&flat_ring(&U_RING));
    assert_eq!(normal[0], 0.0);
    assert_eq!(normal[1], 0.0);
    assert!((normal[2] - 14.0).abs() < 1e-9, "{normal:?}");
}

/// Signed area of a triangle of the ring, read in the plane `z = 0`: positive in the direct
/// sense.
fn signed(ring: &[[f64; 3]], face: [usize; 3]) -> f64 {
    let [a, b, c] = face.map(|rank| ring[rank]);
    ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2.0
}

/// Does the centre of a triangle fall in the ring? A ray to the right counts the sides it
/// crosses: an odd number says inside.
fn inside(ring: &[[f64; 3]], face: [usize; 3]) -> bool {
    let point: Vec<f64> = (0..2)
        .map(|axis| face.iter().map(|rank| ring[*rank][axis]).sum::<f64>() / 3.0)
        .collect();
    let crossings = (0..ring.len())
        .filter(|rank| {
            let (here, next) = (ring[*rank], ring[(rank + 1) % ring.len()]);
            (here[1] > point[1]) != (next[1] > point[1])
                && point[0]
                    < here[0] + (point[1] - here[1]) / (next[1] - here[1]) * (next[0] - here[0])
        })
        .count();
    crossings % 2 == 1
}

// Behaviour: a diagonal that passes through another living corner is not an ear. This simple
// polygon of area thirteen places its last corner on the diagonal of the first candidate
// triangle; cut there, it yielded fourteen and its last triangle started backwards, without
// counting anything in the report.
#[test]
fn a_diagonal_through_a_corner_is_not_an_ear() {
    let mut walk = [
        [-4.0, 0.0],
        [1.0, -3.0],
        [-1.0, 3.0],
        [-3.0, 2.0],
        [-3.0, 1.0],
    ];
    for _ in 0..2 {
        let ring = flat_ring(&walk);
        let (triangles, exact) = cut(&ring);
        assert!(exact, "a simple polygon cuts into ears");
        assert_eq!(triangles.len(), 3, "five corners make three triangles");
        assert!(
            (cut_area(&ring, &triangles) - 13.0).abs() < 1e-9,
            "{triangles:?}"
        );
        let turn = newell(&ring)[2].signum();
        for face in &triangles {
            assert!(
                signed(&ring, *face) * turn > 0.0,
                "{face:?} starts backwards"
            );
            assert!(inside(&ring, *face), "{face:?} leaves the face");
        }
        walk.reverse();
    }
}
