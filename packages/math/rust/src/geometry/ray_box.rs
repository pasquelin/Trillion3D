//! A ray crossing an axis-aligned box (`aabb.rs`), by the slab test: what the compiler's CPU tracer
//! (`asset-compiler-rust/src/trace/tracer.rs`) and the triangle trees' walks
//! (`asset-compiler-rust/src/hlod/flatten/bake/tree.rs`) test each tree node with.

/// The least magnitude a divisor may have: `DIVISOR_FLOOR` of `packages/math/src/matrix/singular.ts`,
/// the same number every shader divisor floors at.
pub const DIVISOR_FLOOR: f64 = 1e-20;

/// The reciprocal of the direction `ray`, axis by axis; `f64::INFINITY` for a component nearer zero
/// than `DIVISOR_FLOOR`, which has none: the ray runs along that axis' slabs (`ray_span`).
#[inline]
pub fn inverse(ray: [f64; 3]) -> [f64; 3] {
    ray.map(|d| {
        if d.abs() < DIVISOR_FLOOR {
            f64::INFINITY
        } else {
            1.0 / d
        }
    })
}

/// Where the ray from `origin`, its direction's reciprocal `inverse`, first meets the box `[low,
/// high]` for `t` in `[from, to]`: that `t`, none when it misses the box there. The slab test, axis
/// by axis: the entry raised from `from` by `f64::max` of the nearer side's distance `(bound −
/// origin) · inverse`, the exit lowered from `to` by `f64::min` of the farther; a hit when the entry
/// is not past the exit. An axis whose `inverse` is infinite (a ray along it) bounds no `t`: it
/// keeps the box when the origin lies between the sides, inclusive, and misses it otherwise.
#[inline]
pub fn ray_span(
    (low, high): ([f64; 3], [f64; 3]),
    (origin, inverse): ([f64; 3], [f64; 3]),
    (from, to): (f64, f64),
) -> Option<f64> {
    let (mut entry, mut exit) = (from, to);
    for axis in 0..3 {
        if inverse[axis].is_infinite() {
            if origin[axis] < low[axis] || origin[axis] > high[axis] {
                return None;
            }
            continue;
        }
        let near = (low[axis] - origin[axis]) * inverse[axis];
        let far = (high[axis] - origin[axis]) * inverse[axis];
        entry = entry.max(near.min(far));
        exit = exit.min(near.max(far));
    }
    (entry <= exit).then_some(entry)
}

/// Whether the ray crosses the box between 0 and `limit` (`ray_span`).
#[inline]
pub fn ray_aabb(
    low: [f64; 3],
    high: [f64; 3],
    origin: [f64; 3],
    inverse: [f64; 3],
    limit: f64,
) -> bool {
    ray_span((low, high), (origin, inverse), (0.0, limit)).is_some()
}

#[cfg(test)]
mod tests;
