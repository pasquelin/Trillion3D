use super::*;

/// One vector track and one rotation track over three keys, linear: `(tracks, data)`.
fn two_tracks(kind_extra: u32) -> (Vec<u32>, Vec<f32>) {
    let times = [0.0f32, 0.5, 1.0];
    let positions = [0.0f32, 1.0, 2.0, 3.0, 4.0, 5.0, -1.0, -0.0, 7.5];
    let half = core::f32::consts::FRAC_1_SQRT_2;
    let rotations = [
        0.0f32, 0.0, 0.0, 1.0, 0.0, half, 0.0, half, 0.0, -1.0, 0.0, 0.0,
    ];
    let mut data = Vec::new();
    data.extend(times);
    data.extend(positions);
    data.extend(times);
    data.extend(rotations);
    let tracks = vec![
        0,
        3,
        3,
        3,
        kind_extra,
        0, //
        12,
        3,
        15,
        4,
        QUATERNION | kind_extra,
        3,
    ];
    (tracks, data)
}

fn run(tracks: &[u32], data: &[f32], t: f64) -> Vec<f64> {
    let n = tracks.len() / TRACK_WORDS;
    let mut keys = vec![0u32; n];
    let mut arcs = vec![-1.0f64; n * ARC_VALUES];
    let mut out = vec![0.0f64; 7];
    sample_tracks(tracks, data, &mut keys, &mut arcs, &mut out, t);
    out
}

#[test]
fn keys_lines_and_arcs_sample_as_the_clip_says() {
    let (tracks, data) = two_tracks(LINEAR);
    // On a key: the key itself, the rotation unit.
    let at_key = run(&tracks, &data, 0.5);
    assert_eq!(&at_key[..3], &[3.0, 4.0, 5.0]);
    // Halfway along the first segment: the line between the two keys.
    let half = run(&tracks, &data, 0.25);
    assert_eq!(&half[..3], &[1.5, 2.5, 3.5]);
    let length: f64 = half[3..].iter().map(|v| v * v).sum();
    assert!((length - 1.0).abs() < 1e-15);
    // Past the end: the last key; NaN time: NaN weights, never a panic.
    assert_eq!(&run(&tracks, &data, 9.0)[..3], &[-1.0, -0.0, 7.5]);
    assert!(run(&tracks, &data, f64::NAN)[0].is_nan() || run(&tracks, &data, f64::NAN)[0] == 0.0);
}

#[test]
fn a_kept_arc_gives_the_bits_of_a_fresh_one() {
    let (tracks, data) = two_tracks(LINEAR);
    let mut keys = vec![0u32; 2];
    let mut arcs = vec![-1.0f64; 2 * ARC_VALUES];
    let mut out = vec![0.0f64; 7];
    for step in 0..200 {
        let t = f64::from(step) / 199.0;
        sample_tracks(&tracks, &data, &mut keys, &mut arcs, &mut out, t);
        let fresh = run(&tracks, &data, t);
        for (a, b) in out.iter().zip(&fresh) {
            assert_eq!(a.to_bits(), b.to_bits(), "t = {t}");
        }
    }
}

#[test]
fn steps_and_splines_read_their_own_layout() {
    let (tracks, data) = two_tracks(STEP);
    assert_eq!(&run(&tracks, &data, 0.75)[..3], &[3.0, 4.0, 5.0]);
    // A spline of two keys whose tangents are zero: smoothstep between the values.
    let data = [0.0f32, 1.0, 0.0, 2.0, 0.0, 0.0, 6.0, 0.0];
    let tracks = [0u32, 2, 2, 1, CUBIC, 0];
    let mut keys = [0u32];
    let mut arcs = [-1.0f64; ARC_VALUES];
    let mut out = [0.0f64];
    sample_tracks(&tracks, &data, &mut keys, &mut arcs, &mut out, 0.5);
    assert_eq!(out[0], 4.0);
}

#[test]
fn the_normalisation_falls_back_to_the_scaled_length_out_of_range() {
    let mut q = [1e300, 1e300, 0.0, 0.0];
    normalize(&mut q);
    assert_eq!(q[0], q[1]);
    assert!((q[0] - core::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15);
    let mut zero = [0.0, -0.0, 0.0, 0.0];
    normalize(&mut zero);
    assert!(zero[1].is_sign_negative() && zero[0] == 0.0);
}
