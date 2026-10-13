//! A ray crossing an axis-aligned box (`aabb.rs`), by the slab test: what the compiler's CPU tracer
//! (`asset-compiler-rust/src/proxy/tracer.rs`) tests each tree node with.

/// Whether the ray from `origin`, its direction's reciprocal `inverse`, crosses the box `[low,
/// high]` between 0 and `limit`: the slab test, axis by axis in axis order, each side's distance
/// `(bound − origin) · inverse`, the entry raised from 0 by `f64::max` of the nearer and the exit
/// lowered from `limit` by `f64::min` of the farther; a hit when the entry is not past the exit. A
/// NaN distance (`0 · ∞`, a zero component of the direction against a bound through the origin) is
/// passed over by `min` and `max`, the other bound's distance then both the nearer and the farther.
#[inline]
pub fn ray_aabb(
    low: [f64; 3],
    high: [f64; 3],
    origin: [f64; 3],
    inverse: [f64; 3],
    limit: f64,
) -> bool {
    let mut entry = 0.0f64;
    let mut exit = limit;
    for axis in 0..3 {
        let near = (low[axis] - origin[axis]) * inverse[axis];
        let far = (high[axis] - origin[axis]) * inverse[axis];
        entry = entry.max(near.min(far));
        exit = exit.min(near.max(far));
    }
    entry <= exit
}

#[cfg(test)]
#[path = "ray_box_tests.rs"]
mod tests;
