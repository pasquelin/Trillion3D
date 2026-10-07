use super::*;
use crate::min_ball::xorshift;
use trillion3d_math::golden::HOSTILE_F64 as HOSTILE;

#[test]
fn the_affine_sums_are_the_corner_walk_s_bits() {
    let mut state = trillion3d_math::GOLDEN;
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
