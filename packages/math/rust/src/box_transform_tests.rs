use super::*;
use crate::golden::HOSTILE_F64 as HOSTILE;

/// Marsaglia's xorshift, the draws of the codec's tests.
fn xorshift(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

#[test]
fn the_affine_sums_are_the_corner_walk_s_bits() {
    let mut state = crate::GOLDEN;
    let mut draw = || xorshift(&mut state);
    let value = |draw: &mut dyn FnMut() -> u64| match draw() % 4 {
        0 => HOSTILE[(draw() % 16) as usize],
        1 => [0.0, -0.0][(draw() % 2) as usize],
        _ => (draw() >> 11) as f64 / (1u64 << 53) as f64 * 200.0 - 100.0,
    };
    let (mut affine, mut zeros) = (0, 0);
    for _ in 0..1_000_000 {
        let mut m: [f64; 16] = std::array::from_fn(|_| value(&mut draw));
        if draw() % 4 != 0 {
            for at in [3, 7, 11] {
                m[at] = [0.0, -0.0][(draw() % 2) as usize];
            }
            m[15] = 1.0;
        }
        let mut b: [f64; 6] = std::array::from_fn(|_| value(&mut draw));
        for axis in 0..3 {
            if b[axis + 3] < b[axis] {
                b.swap(axis, axis + 3);
            }
        }
        let (lo, hi) = ([b[0], b[1], b[2]], [b[3], b[4], b[5]]);
        let (mut fast, mut walked) = ([0f64; 6], [0f64; 6]);
        corner_walk(&mut walked, lo, hi, &m);
        if affine_box(&mut fast, lo, hi, &m) {
            affine += 1;
            zeros += usize::from(fast.contains(&0.0));
            assert_eq!(
                fast.map(f64::to_bits),
                walked.map(f64::to_bits),
                "{m:?} {b:?}"
            );
        }
    }
    // Both paths are exercised, signed zeros among the results.
    assert!(affine > 150_000 && zeros > 10_000, "{affine} {zeros}");
}

#[test]
fn an_empty_box_is_copied_and_a_full_one_moved() {
    let empty = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    let mut out = [9.0f64; BOX_VALUES];
    box_transform(&mut out, &empty, &crate::matrix::IDENTITY);
    assert_eq!(out, empty);
    let shifted = crate::matrix::translation([1.0, 2.0, 3.0]);
    box_transform(&mut out, &[0.0, 0.0, 0.0, 1.0, 1.0, 1.0], &shifted);
    assert_eq!(out, [1.0, 2.0, 3.0, 2.0, 3.0, 4.0]);
}
