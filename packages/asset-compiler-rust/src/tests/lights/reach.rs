//! A light's reach is shortened, never lengthened, and no point's irradiance moves by more than
//! the display floor (#958, audit CMP-16). The harness weighs the engine's own window
//! (`range_window`) at every distance, against the range develop published, on random lights and
//! on the edge cases: zero intensity, infinite, NaN, ±0 and maximal values.
use super::*;
use crate::compiler_lights::reach::{quantum_reach, MIN_RANGE};
use crate::compiler_lights::{range_of, MAX_RANGE, RANGE_CUTOFF_IRRADIANCE as FLOOR};
use crate::shared_math::{range_window, splitmix_unit, GOLDEN};

/// Largest irradiance change, over the whole old range, between a light of `peak` W/sr windowed by
/// `old` and by `new`, as the shaders weigh it (inverse square floored at 1e-4 m²): sampled finely
/// both inside the new range and between the two.
fn worst_move(peak: f64, old: f64, new: f64) -> f64 {
    const SAMPLES: usize = 20_000;
    let share = |i: usize| i as f64 / SAMPLES as f64;
    (1..=SAMPLES)
        .flat_map(|i| [new * share(i), new + (old - new) * share(i)])
        .map(|d| peak * (range_window(d, old) - range_window(d, new)).abs() / (d * d).max(1e-4))
        .fold(0.0, f64::max)
}
/// The range develop published: declared, else deduced from the floor, within its bounds.
fn develop_range(declared: Option<f64>, peak: f64) -> f64 {
    declared.map_or((peak / FLOOR).sqrt().clamp(MIN_RANGE, MAX_RANGE), |r| {
        r.min(MAX_RANGE)
    })
}
/// Log-uniform draw in `[10^low, 10^high)`.
fn draw(seed: u64, low: f64, high: f64) -> f64 {
    10f64.powf(low + (high - low) * splitmix_unit(seed.wrapping_mul(GOLDEN)))
}

// Behaviour: on random lights the reach never grows, never moves a point by more than the floor,
// and gives up no more than it must — the worst move sits at the floor itself when it shrinks.
#[test]
fn a_random_light_moves_no_point_beyond_the_floor() {
    for case in 0..400u64 {
        let peak = draw(3 * case, -6.0, 8.0);
        let declared = (case % 2 == 0).then(|| draw(3 * case + 1, -4.0, 4.0));
        let old = develop_range(declared, peak);
        let new = quantum_reach(old, peak);
        assert!(
            new <= old && new >= MIN_RANGE.min(old),
            "case {case}: {old} -> {new}"
        );
        let moved = worst_move(peak, old, new);
        // The rounding of two windows near one, weighed by the floored inverse square, is all the
        // harness itself may add.
        let rounding = peak * 8.0 * f64::EPSILON / 1e-4;
        assert!(
            moved <= FLOOR + rounding,
            "case {case}: moved {moved} ({peak} W/sr, {old} m)"
        );
        // Tight wherever the worst point (about 0.9 of the new range) lies past the 1 cm the
        // shaders floor the inverse square at.
        if new < old && new > 0.02 {
            assert!(moved >= FLOOR * 0.99, "case {case}: gave up only {moved}");
        }
    }
}

// Behaviour: a range deduced from the intensity always keeps the same share of develop's, about
// 77 %, since its tail sits at the floor whatever the light.
#[test]
fn a_deduced_range_is_shortened_by_the_same_share() {
    for radiant in [0.05, 1.0, 1000.0 / 683.0, 25.0, 4.0e4] {
        let old = (radiant / FLOOR).sqrt();
        let share = range_of(&json!({"type":"point"}), radiant, [1.0, 0.5, 0.0]) / old;
        assert!((0.773..0.775).contains(&share), "{radiant}: {share}");
    }
}

// Behaviour: the edge cases keep a finite range within develop's: an infinite, NaN or ±0 declared
// range falls back on the deduced one, the largest finite one stays within the cap, a black light shrinks to the minimum, an overflowing or
// NaN peak leaves the range as it is, and the maximal range still shrinks when it may.
#[test]
fn the_edge_cases_keep_a_finite_range_within_develops() {
    let deduced = range_of(&json!({}), 1.0, [1.0; 3]);
    for range in [json!(0.0), json!(-0.0), json!(-3.0), json!("NaN")] {
        assert_eq!(range_of(&json!({ "range": range }), 1.0, [1.0; 3]), deduced);
    }
    assert!(deduced < (1.0 / FLOOR).sqrt());
    assert!(range_of(&json!({"range":f64::MAX}), 1.0, [1.0; 3]) <= MAX_RANGE);
    assert_eq!(range_of(&json!({"range":5.0}), 1.0, [0.0; 3]), MIN_RANGE);
    assert_eq!(range_of(&json!({}), 1.0, [0.0; 3]), MIN_RANGE);
    assert_eq!(quantum_reach(5.0, f64::INFINITY), 5.0);
    assert_eq!(quantum_reach(5.0, f64::NAN), 5.0);
    assert_eq!(quantum_reach(MIN_RANGE, 1e-12), MIN_RANGE);
    let maximal = range_of(&json!({}), 1e300, [1.0; 3]);
    assert!(
        maximal > MAX_RANGE * 0.999 && maximal <= MAX_RANGE,
        "{maximal}"
    );
    let at_cap = range_of(
        &json!({"range":1e9}),
        MAX_RANGE * MAX_RANGE * FLOOR,
        [1.0; 3],
    );
    assert!((0.773..0.775).contains(&(at_cap / MAX_RANGE)), "{at_cap}");
}
