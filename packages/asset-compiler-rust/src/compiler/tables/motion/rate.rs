//! The rate a clip is baked at: the first of the usual animation rates at which its duration is a
//! whole number of frames, within a millisecond; the default rate, `ANIMATION_BANK_SAMPLE_RATE`,
//! when none is. A rate is the number of frames a second as a fraction — the television rates
//! are over 1001 —, tried in the order below, so that a clip fitting several takes the first.
use super::*;

/// The rates tried, in order, as numerator over denominator.
const USUAL_RATES: [(f64, f64); 17] = [
    (ANIMATION_BANK_SAMPLE_RATE, 1.0),
    (24.0, 1.0),
    (24000.0, 1001.0),
    (25.0, 1.0),
    (30000.0, 1001.0),
    (48.0, 1.0),
    (50.0, 1.0),
    (60.0, 1.0),
    (60000.0, 1001.0),
    (72.0, 1.0),
    (90.0, 1.0),
    (100.0, 1.0),
    (120.0, 1.0),
    (144.0, 1.0),
    (165.0, 1.0),
    (240.0, 1.0),
    (480.0, 1.0),
];

/// How far a duration may lie from a whole number of frames, seconds, for a rate to fit it.
const FIT: f32 = 1e-3;

/// The decimals a rate is kept to, as a power of ten: the clip's rate is written as a fraction of
/// a million, the fractional rates rounded to it.
const RATE_RESOLUTION: f64 = 1e6;

/// The rate a clip of `duration` seconds is baked at, frames a second.
pub(super) fn bake_rate(duration: f64) -> f64 {
    USUAL_RATES
        .iter()
        .find(|&&(numerator, denominator)| {
            let frames = (duration * numerator / denominator).round();
            ((frames * denominator / numerator - duration).abs() as f32) <= FIT
        })
        .map_or(ANIMATION_BANK_SAMPLE_RATE, |&(numerator, denominator)| {
            (numerator / denominator * RATE_RESOLUTION).round() / RATE_RESOLUTION
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Behaviour: a duration of a whole number of frames at the default rate keeps it, whatever
    // the other rates it also fits (a second is 30, 24, 25 ... frames).
    #[test]
    fn a_duration_the_default_rate_fits_keeps_it() {
        for duration in [0.0, 1.0, 2.0 / 3.0, 1.0 / 30.0, 0.667] {
            assert_eq!(
                bake_rate(duration),
                ANIMATION_BANK_SAMPLE_RATE,
                "{duration}"
            );
        }
    }

    // Behaviour: a duration the default rate cannot fit takes the first usual rate that does.
    #[test]
    fn a_duration_only_another_rate_fits_takes_that_rate() {
        assert_eq!(bake_rate(23.0 / 24.0), 24.0);
        assert_eq!(
            bake_rate(1.12),
            25.0,
            "28 frames at 25, 33.6 at 30 and 26.9 at 24"
        );
        assert_eq!(
            bake_rate(0.35),
            60.0,
            "21 frames at 60, no slower rate fits"
        );
    }

    // Behaviour: the television rates are kept to a millionth, as a fractional rate is read back.
    #[test]
    fn the_television_rates_are_kept_to_a_millionth() {
        assert_eq!(bake_rate(100.0 * 1001.0 / 24000.0), 23.976024);
        assert_eq!(bake_rate(301.0 * 1001.0 / 30000.0), 29.97003);
    }

    // Behaviour: a duration no usual rate fits (half a frame at the fastest) is baked at the default
    // rate.
    #[test]
    fn a_duration_no_usual_rate_fits_is_baked_at_the_default() {
        assert_eq!(bake_rate(0.5 / 480.0), ANIMATION_BANK_SAMPLE_RATE);
    }
}
