use super::*;

/// The farthest point of `points` from `centre`: the radius a ball there needs.
fn reach(points: &[[f64; 3]], centre: [f64; 3]) -> f64 {
    points
        .iter()
        .map(|&p| length(sub(p, centre)))
        .fold(0.0, f64::max)
}

fn close(ball: Ball, centre: [f64; 3], radius: f64) -> bool {
    length(sub(ball.0, centre)) < 1e-12 && (ball.1 - radius).abs() < 1e-12
}

#[test]
fn the_edge_cases_give_their_known_ball() {
    assert_eq!(min_ball(&mut []), None);
    assert_eq!(
        min_ball(&mut [[1.0, -2.0, 3.0]]),
        Some(([1.0, -2.0, 3.0], 0.0))
    );
    assert_eq!(min_ball(&mut [[0.5; 3]; 7]), Some(([0.5; 3], 0.0)));
    // Colinear points: the two ends are the diameter.
    let mut line = [[0.0; 3], [3.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]];
    assert!(close(min_ball(&mut line).unwrap(), [1.5, 0.0, 0.0], 1.5));
    // Coplanar points: a square and its centre, the circle through the corners.
    let mut square = [
        [0.0, 0.0, 2.0],
        [2.0, 0.0, 2.0],
        [2.0, 2.0, 2.0],
        [0.0, 2.0, 2.0],
        [1.0, 1.0, 2.0],
    ];
    assert!(close(
        min_ball(&mut square).unwrap(),
        [1.0, 1.0, 2.0],
        2f64.sqrt()
    ));
    // The corners of a cube: the ball through all eight (four support points, the maximum).
    let mut cube: Vec<[f64; 3]> = (0..8)
        .map(|i| [(i & 1) as f64, (i >> 1 & 1) as f64, (i >> 2 & 1) as f64])
        .collect();
    assert!(close(
        min_ball(&mut cube).unwrap(),
        [0.5; 3],
        0.75f64.sqrt()
    ));
}

#[test]
fn a_random_cloud_is_enclosed_by_a_ball_no_nearby_centre_beats_in_any_order() {
    let mut state = 0x9e37_79b9_7f4a_7c15u64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state >> 11) as f64 / (1u64 << 52) as f64 - 1.0
    };
    for case in 0..200 {
        let squash = [1.0, 1e-3, 0.0][case % 3];
        let points: Vec<[f64; 3]> = (0..1 + case % 60)
            .map(|_| [next() * 5.0, next(), next() * squash])
            .collect();
        let (centre, radius) = min_ball(&mut points.clone()).unwrap();
        let needed = reach(&points, centre);
        assert!(
            needed <= radius * (1.0 + 1e-9) + 1e-12,
            "case {case}: {needed} > {radius}"
        );
        // The farthest-point distance is convex in the centre: no step around a minimum lowers it.
        for (axis, step) in (0..3).flat_map(|a| [(a, 1e-4), (a, -1e-4)]) {
            let mut moved = centre;
            moved[axis] += step;
            assert!(
                reach(&points, moved) >= needed - 1e-9,
                "case {case} axis {axis}"
            );
        }
        let mut reversed: Vec<[f64; 3]> = points.iter().rev().copied().collect();
        let (other, _) = min_ball(&mut reversed).unwrap();
        assert!(
            length(sub(centre, other)) < 1e-9,
            "case {case}: the order moves the ball"
        );
    }
}
