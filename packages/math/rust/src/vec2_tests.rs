use super::*;

#[test]
fn sub_takes_each_axis_apart() {
    assert_eq!(sub([3.0, -1.0], [1.0, 2.0]), [2.0, -3.0]);
}

#[test]
fn cross_is_twice_the_signed_area_with_the_origin() {
    assert_eq!(cross([1.0, 0.0], [0.0, 1.0]), 1.0);
    assert_eq!(cross([0.0, 1.0], [1.0, 0.0]), -1.0);
    let (a, b) = ([0.1, 0.7], [0.3, -0.9]);
    assert_eq!(cross(a, b).to_bits(), (a[0] * b[1] - a[1] * b[0]).to_bits());
}

#[test]
fn double_area_is_positive_counter_clockwise() {
    let (a, b, c) = ([0.0, 0.0], [2.0, 0.0], [0.0, 3.0]);
    assert_eq!(double_area(a, b, c), 6.0);
    assert_eq!(double_area(a, c, b), -6.0);
    let (a, b, c) = ([0.1, 0.2], [0.7, -0.3], [0.45, 0.9]);
    // The written-out form, its second product with its factors swapped: the same float.
    let by_hand = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    assert_eq!(double_area(a, b, c).to_bits(), by_hand.to_bits());
}

#[test]
fn barycentric_weights_rebuild_the_point() {
    let (a, b, c) = ([0.0, 0.0], [4.0, 0.0], [0.0, 2.0]);
    let area = double_area(a, b, c);
    assert_eq!(barycentric(a, b, c, a, area), [0.0, 0.0]);
    assert_eq!(barycentric(a, b, c, b, area), [1.0, 0.0]);
    assert_eq!(barycentric(a, b, c, c, area), [0.0, 1.0]);
    assert_eq!(barycentric(a, b, c, [1.0, 0.5], area), [0.25, 0.25]);
    let (a, b, c, p) = ([0.1, 0.2], [0.7, -0.3], [0.45, 0.9], [0.4, 0.3]);
    let area = double_area(a, b, c);
    let [v, w] = barycentric(a, b, c, p, area);
    let v_by_hand = ((p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])) / area;
    let w_by_hand = ((b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1])) / area;
    assert_eq!(
        [v.to_bits(), w.to_bits()],
        [v_by_hand.to_bits(), w_by_hand.to_bits()]
    );
}
