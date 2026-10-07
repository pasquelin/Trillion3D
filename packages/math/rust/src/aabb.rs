//! Axis-aligned boxes, as a low and a high corner, grown by points and by boxes with `f64::min`
//! and `f64::max`: every compiler stage that bounds geometry grows its boxes here.

/// Extends bounding box by another box, axis by axis in axis order.
///
/// `f64::min` and `f64::max` keep semantics: NaN in read box leaves bound
/// as is, NaN in bound replaced by coordinate. Min corner compared
/// only to min corner and max to max corner: no extra comparison deciding
/// differently between `+0.0` and `−0.0`.
#[inline]
pub fn merge_aabb<const N: usize>(
    low: &mut [f64; N],
    high: &mut [f64; N],
    other_low: [f64; N],
    other_high: [f64; N],
) {
    for axis in 0..N {
        low[axis] = low[axis].min(other_low[axis]);
        high[axis] = high[axis].max(other_high[axis]);
    }
}

/// Extends bounding box by point: box reduced to point.
#[inline]
pub fn extend_aabb<const N: usize>(low: &mut [f64; N], high: &mut [f64; N], point: [f64; N]) {
    merge_aabb(low, high, point, point);
}

/// Same box in single precision: site accumulating `f32` does not go through `f64`.
#[inline]
pub fn extend_aabb_f32<const N: usize>(low: &mut [f32; N], high: &mut [f32; N], point: [f32; N]) {
    for axis in 0..N {
        low[axis] = low[axis].min(point[axis]);
        high[axis] = high[axis].max(point[axis]);
    }
}

/// The box of `points`: low bounds at `+∞` and high at `−∞` when there is none, each point taken
/// in order by `extend_aabb`.
#[inline]
pub fn aabb_of<const N: usize>(points: impl IntoIterator<Item = [f64; N]>) -> ([f64; N], [f64; N]) {
    let (mut low, mut high) = ([f64::INFINITY; N], [f64::NEG_INFINITY; N]);
    for point in points {
        extend_aabb(&mut low, &mut high, point);
    }
    (low, high)
}

/// `aabb_of` in single precision, by `extend_aabb_f32`.
#[inline]
pub fn aabb_of_f32<const N: usize>(
    points: impl IntoIterator<Item = [f32; N]>,
) -> ([f32; N], [f32; N]) {
    let (mut low, mut high) = ([f32::INFINITY; N], [f32::NEG_INFINITY; N]);
    for point in points {
        extend_aabb_f32(&mut low, &mut high, point);
    }
    (low, high)
}

/// The box of `boxes`, each merged in order by `merge_aabb`: low bounds at `+∞` and high at `−∞`
/// when there is none.
#[inline]
pub fn aabb_of_boxes<const N: usize>(
    boxes: impl IntoIterator<Item = ([f64; N], [f64; N])>,
) -> ([f64; N], [f64; N]) {
    let (mut low, mut high) = ([f64::INFINITY; N], [f64::NEG_INFINITY; N]);
    for (other_low, other_high) in boxes {
        merge_aabb(&mut low, &mut high, other_low, other_high);
    }
    (low, high)
}

/// A box laid out flat, the low corner then the high one, `[x, y, z, X, Y, Z]`, no point is in yet.
pub const EMPTY_FLAT: [f64; 6] = [
    f64::INFINITY,
    f64::INFINITY,
    f64::INFINITY,
    f64::NEG_INFINITY,
    f64::NEG_INFINITY,
    f64::NEG_INFINITY,
];

/// `merge_aabb` of boxes laid out flat (`EMPTY_FLAT`).
#[inline]
pub fn grow_flat(into: &mut [f64; 6], other: &[f64; 6]) {
    for axis in 0..3 {
        into[axis] = into[axis].min(other[axis]);
        into[axis + 3] = into[axis + 3].max(other[axis + 3]);
    }
}

/// `extend_aabb` of a box laid out flat (`EMPTY_FLAT`): the box reduced to the point.
#[inline]
pub fn extend_flat(into: &mut [f64; 6], point: [f64; 3]) {
    let [x, y, z] = point;
    grow_flat(into, &[x, y, z, x, y, z]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extend_aabb_starts_from_an_empty_box() {
        let mut low = [f64::INFINITY; 3];
        let mut high = [f64::NEG_INFINITY; 3];
        extend_aabb(&mut low, &mut high, [2.0, -3.0, 4.0]);
        assert_eq!(low, [2.0, -3.0, 4.0]);
        assert_eq!(high, [2.0, -3.0, 4.0]);
    }

    #[test]
    fn extend_aabb_nan_in_the_point_leaves_the_bound_unchanged() {
        let mut low = [5.0, 5.0, 5.0];
        let mut high = [5.0, 5.0, 5.0];
        extend_aabb(&mut low, &mut high, [f64::NAN, 5.0, 5.0]);
        assert_eq!(low[0].to_bits(), 5.0_f64.to_bits());
        assert_eq!(high[0].to_bits(), 5.0_f64.to_bits());
    }

    #[test]
    fn extend_aabb_nan_in_the_bound_is_replaced_by_the_coordinate() {
        let mut low = [f64::NAN, 0.0, 0.0];
        let mut high = [f64::NAN, 0.0, 0.0];
        extend_aabb(&mut low, &mut high, [3.0, 0.0, 0.0]);
        assert_eq!(low[0].to_bits(), 3.0_f64.to_bits());
        assert_eq!(high[0].to_bits(), 3.0_f64.to_bits());
    }

    #[test]
    fn extend_aabb_keeps_the_sign_of_negative_zero() {
        let mut low = [f64::INFINITY; 3];
        let mut high = [f64::NEG_INFINITY; 3];
        extend_aabb(&mut low, &mut high, [-0.0, -0.0, -0.0]);
        assert_eq!(low[0].to_bits(), (-0.0_f64).to_bits());
        assert_ne!(low[0].to_bits(), (0.0_f64).to_bits());
        assert_eq!(high[0].to_bits(), (-0.0_f64).to_bits());
    }

    #[test]
    fn merge_aabb_combines_two_disjoint_boxes() {
        let mut low = [0.0, 0.0, 0.0];
        let mut high = [1.0, 1.0, 1.0];
        merge_aabb(&mut low, &mut high, [5.0, 5.0, 5.0], [6.0, 6.0, 6.0]);
        assert_eq!(low, [0.0, 0.0, 0.0]);
        assert_eq!(high, [6.0, 6.0, 6.0]);
    }

    #[test]
    fn extend_aabb_f32_starts_from_an_empty_box() {
        let mut low = [f32::INFINITY; 3];
        let mut high = [f32::NEG_INFINITY; 3];
        extend_aabb_f32(&mut low, &mut high, [1.5, -2.5, 0.5]);
        assert_eq!(low, [1.5, -2.5, 0.5]);
        assert_eq!(high, [1.5, -2.5, 0.5]);
    }
}
