use super::*;

#[test]
fn length_is_the_root_of_the_squares_powi_or_product_alike() {
    let mut state = crate::GOLDEN;
    for _ in 0..10_000 {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let v = [0, 21, 42].map(|shift| f64::from_bits((state >> shift) & 0x3FFF_FFFF_FFFF_FFFF));
        let by_powi = (v[0].powi(2) + v[1].powi(2) + v[2].powi(2)).sqrt();
        assert_eq!(length(v).to_bits(), by_powi.to_bits());
        let plane = (v[0].powi(2) + v[1].powi(2)).sqrt();
        assert_eq!(crate::vec2::length([v[0], v[1]]).to_bits(), plane.to_bits());
    }
    assert_eq!(crate::vec2::length([3.0, -4.0]), 5.0);
}

#[test]
fn the_single_precision_forms_round_in_f32() {
    let v = [1.0f32, 2.0, 2.0];
    assert_eq!(length_f32(v), 3.0);
    assert_eq!(divide_f32(v, 3.0), [1.0 / 3.0, 2.0 / 3.0, 2.0 / 3.0]);
    // Rounded in `f32` at each step, not once from `f64`: some vectors land a float apart.
    let apart = (1..1000)
        .map(|i| [i as f32 * 0.37, 1.0 / i as f32, 0.1])
        .filter(|&v| length_f32(v) != length(v.map(f64::from)) as f32)
        .count();
    assert!(apart > 0);
}
