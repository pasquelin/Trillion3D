use super::*;

/// The reference: the same crossing by dividing by the direction, interval by interval, on
/// directions whose components are powers of two (or zero), where the division is exact.
fn crosses_by_division(
    low: [f64; 3],
    high: [f64; 3],
    origin: [f64; 3],
    ray: [f64; 3],
    limit: f64,
) -> bool {
    let (mut from, mut to) = (0.0f64, limit);
    for axis in 0..3 {
        if ray[axis] == 0.0 {
            if origin[axis] < low[axis] || origin[axis] > high[axis] {
                return false;
            }
            continue;
        }
        let a = (low[axis] - origin[axis]) / ray[axis];
        let b = (high[axis] - origin[axis]) / ray[axis];
        from = from.max(a.min(b));
        to = to.min(a.max(b));
    }
    from <= to
}

fn inverse_of(ray: [f64; 3]) -> [f64; 3] {
    ray.map(|d| 1.0 / d)
}

#[test]
fn ray_aabb_meets_the_box_ahead_and_misses_beside_behind_and_past_the_limit() {
    let (low, high) = ([1.0, -1.0, -1.0], [3.0, 1.0, 1.0]);
    let along = inverse_of([1.0, 0.0, 0.0]);
    assert!(ray_aabb(low, high, [0.0; 3], along, 10.0));
    assert!(!ray_aabb(low, high, [0.0; 3], along, 0.5));
    assert!(ray_aabb(low, high, [0.0; 3], along, 1.0));
    assert!(!ray_aabb(low, high, [0.0, 2.0, 0.0], along, 10.0));
    assert!(!ray_aabb(low, high, [4.0, 0.0, 0.0], along, 10.0));
    // From inside, the entry stays at 0.
    assert!(ray_aabb(
        low,
        high,
        [2.0, 0.0, 0.0],
        inverse_of([-1.0, 0.0, 0.0]),
        1e-9
    ));
    // Touching an edge: the entry equals the exit.
    let diagonal = inverse_of([1.0, 1.0, 0.0]);
    assert!(ray_aabb(
        [1.0, -3.0, -1.0],
        [3.0, 1.0, 1.0],
        [0.0; 3],
        diagonal,
        10.0
    ));
    // Along a face, its direction zero across it: the bound through the origin gives `0 · ∞`, a
    // NaN that `min` and `max` pass over, so the other bound's infinite distance is both the
    // nearer and the farther, and the ray misses.
    assert!(!ray_aabb(low, high, [0.0, 1.0, 0.0], along, 10.0));
}

#[test]
fn ray_aabb_is_the_division_slab_on_exact_directions() {
    let mut state = 0x2545_f491u32;
    let mut draw = |span: f64| {
        let x = crate::random::xorshift32(&mut state);
        (f64::from(x >> 8) / f64::from(1u32 << 24) - 0.5) * span
    };
    let powers = [-4.0, -1.0, -0.25, 0.0, 0.125, 0.5, 2.0, 8.0];
    let mut hits = 0;
    for case in 0..20_000usize {
        let centre = [draw(8.0), draw(8.0), draw(8.0)];
        let half = [draw(4.0).abs(), draw(4.0).abs(), draw(4.0).abs()];
        let low = [0, 1, 2].map(|a| centre[a] - half[a]);
        let high = [0, 1, 2].map(|a| centre[a] + half[a]);
        let origin = [draw(16.0), draw(16.0), draw(16.0)];
        let ray = [0, 1, 2].map(|a| powers[(case * 3 + a * 5) % powers.len()]);
        if ray == [0.0; 3] {
            continue;
        }
        let limit = draw(40.0).abs();
        let expected = crosses_by_division(low, high, origin, ray, limit);
        assert_eq!(
            ray_aabb(low, high, origin, inverse_of(ray), limit),
            expected,
            "{case}"
        );
        hits += usize::from(expected);
    }
    // Both answers met many times: the sweep tests the test.
    assert!(hits > 100 && hits < 19_000, "{hits}");
}
