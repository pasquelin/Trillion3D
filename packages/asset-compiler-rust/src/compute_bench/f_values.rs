//! Hostile values of lot F equivalence benches: NaN, infinities, signed zeros,
//! denormals. Reference: old version, French names.
use super::inputs::Xorshift;

/// Double floats that make a naive comparison fall, in a fixed order.
pub(crate) const POISON_F64: [f64; 10] = [
    f64::NAN,
    f64::INFINITY,
    f64::NEG_INFINITY,
    -0.0,
    0.0,
    f64::MIN_POSITIVE,
    -f64::MIN_POSITIVE,
    5e-324,
    -5e-324,
    f64::MAX,
];

/// The same in single precision.
pub(crate) const POISON_F32: [f32; 10] = [
    f32::NAN,
    f32::INFINITY,
    f32::NEG_INFINITY,
    -0.0,
    0.0,
    f32::MIN_POSITIVE,
    -f32::MIN_POSITIVE,
    1e-45,
    -1e-45,
    f32::MAX,
];

/// `count` double points: one in seven is poisoned, coordinate by coordinate.
pub(crate) fn points_f64(seed: u64, count: usize) -> Vec<[f64; 3]> {
    let mut rng = Xorshift::new(seed);
    (0..count)
        .map(|id| {
            let mut point = [0.0f64; 3];
            for (axis, slot) in point.iter_mut().enumerate() {
                *slot = if (id + axis) % 7 == 0 {
                    POISON_F64[(id + axis) / 7 % POISON_F64.len()]
                } else {
                    f64::from(rng.coordinate())
                };
            }
            point
        })
        .collect()
}

/// `count` single points, poisoned the same way.
pub(crate) fn points_f32(seed: u64, count: usize) -> Vec<[f32; 3]> {
    let mut rng = Xorshift::new(seed);
    (0..count)
        .map(|id| {
            let mut point = [0.0f32; 3];
            for (axis, slot) in point.iter_mut().enumerate() {
                *slot = if (id + axis) % 7 == 0 {
                    POISON_F32[(id + axis) / 7 % POISON_F32.len()]
                } else {
                    rng.coordinate()
                };
            }
            point
        })
        .collect()
}

/// `count` boxes, of which one in eleven is inverted (low corner above the high
/// corner): that is where comparing the low corner to the high one, or the reverse,
/// would no longer yield the same box.
pub(crate) fn boxes_f64(seed: u64, count: usize) -> Vec<([f64; 3], [f64; 3])> {
    let points = points_f64(seed, count * 2);
    (0..count)
        .map(|id| {
            let (low, high) = (points[id * 2], points[id * 2 + 1]);
            if id % 11 == 0 {
                (high, low)
            } else {
                (low, high)
            }
        })
        .collect()
}
