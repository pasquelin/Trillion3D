//! The ball of balls (`ball_of_balls`) against the spheres it replaced: the sequential merge and
//! the box-centred sphere, oracles of the tests alone; and adversarial sets.
use trillion3d_math::sphere::merge_spheres;
use trillion3d_page_codec::min_ball::ball_of_balls;

/// The test's oracle: `spheres` merged in order (`merge_spheres`), the zero sphere for none.
pub(super) fn merged(spheres: &[[f64; 4]]) -> [f64; 4] {
    let result = spheres
        .iter()
        .fold([0.0, 0.0, 0.0, -1.0], |m, &s| merge_spheres(m, s));
    [result[0], result[1], result[2], result[3].max(0.0)]
}

/// The test's other oracle: the radius the centre of the spheres' box needs to hold them.
pub(super) fn box_centred(spheres: &[[f64; 4]]) -> f64 {
    let live: Vec<&[f64; 4]> = spheres.iter().filter(|s| s[3] >= 0.0).collect();
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for s in &live {
        for k in 0..3 {
            low[k] = low[k].min(s[k] - s[3]);
            high[k] = high[k].max(s[k] + s[3]);
        }
    }
    let c = [0, 1, 2].map(|k| (low[k] + high[k]) * 0.5);
    let reach = |s: &&[f64; 4]| {
        let d = [0, 1, 2].map(|k| s[k] - c[k]);
        (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt() + s[3]
    };
    live.iter().map(reach).fold(0.0, f64::max)
}

// Behaviour: adversarial sets — nested balls, radii spread over six orders, coplanar and
// cospherical centres — get a ball holding every one, never larger than the merge or the box one.
#[test]
fn an_adversarial_ball_of_balls_is_the_smallest_of_the_candidates() {
    let ring = |n: usize, r: f64| -> Vec<[f64; 4]> {
        (0..n)
            .map(|i| {
                let a = i as f64 * std::f64::consts::TAU / n as f64;
                [a.cos() * 10.0, a.sin() * 10.0, 0.0, r]
            })
            .collect()
    };
    let nested = vec![
        [0.0, 0.0, 0.0, 5.0],
        [1.0, 0.0, 0.0, 3.0],
        [1.5, 0.5, 0.0, 1.0],
    ];
    let spread = vec![
        [0.0, 0.0, 0.0, 1e-6],
        [3.0, 0.0, 0.0, 1.0],
        [0.0, 4.0, 1.0, 1e3],
    ];
    let cosphere: Vec<[f64; 4]> = (0..12)
        .map(|i| {
            let (t, p) = (i as f64 * 0.7, i as f64 * 1.3);
            [
                t.sin() * p.cos() * 7.0,
                t.sin() * p.sin() * 7.0,
                t.cos() * 7.0,
                0.25,
            ]
        })
        .collect();
    for (name, spheres) in [
        ("nested", nested),
        ("spread", spread),
        ("coplanar", ring(9, 0.5)),
        ("cospherical", cosphere),
    ] {
        let ball = ball_of_balls(&spheres);
        assert!(ball[3] <= merged(&spheres)[3] + 1e-9, "{name}");
        assert!(ball[3] <= box_centred(&spheres) + 1e-9, "{name}");
        for s in &spheres {
            let d = [0, 1, 2].map(|k| s[k] - ball[k]);
            let reach = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt() + s[3];
            assert!(reach <= ball[3], "{name}");
        }
    }
}
