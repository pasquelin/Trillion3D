//! Projection spheres (`bounds::point_sphere`, `ball_of_balls`): their edge cases, then whole DAGs
//! of smooth meshes.
use super::*;
use bounds::point_sphere;
use trillion3d_math::sphere::enclosing_sphere;
use trillion3d_math::vec3::point;
use trillion3d_math::vecn::{length, sub};
use trillion3d_page_codec::min_ball::{ball_of_balls, min_ball};

/// Deterministic uniform draws in [-1, 1).
fn draws(seed: u64) -> impl FnMut() -> f64 {
    let mut rng = crate::tests::random::Xorshift::new(seed);
    move || (rng.next() >> 11) as f64 / (1u64 << 52) as f64 - 1.0
}

/// Whether `outer` holds the ball `(c, r)`, grown by `slack` of its radius, by the rule the
/// runtime reads: `|c - C| + r <= R`.
fn holds(outer: [f64; 4], c: [f64; 3], r: f64, slack: f64) -> bool {
    length(sub(c, [outer[0], outer[1], outer[2]])) + r <= outer[3] * (1.0 + slack)
}

fn holds_vertices(sphere: [f64; 4], positions: &[f32], indices: &[u32]) -> bool {
    indices
        .iter()
        .all(|&v| holds(sphere, point(positions, v), 0.0, 0.0))
}

/// A grid wrapped onto a sphere of radius 5: a smooth surface, its largest gains.
fn ball(n: usize) -> (Vec<f32>, Vec<u32>) {
    let (mut positions, indices) = grid(n);
    for p in positions.as_chunks_mut::<3>().0 {
        let (theta, phi) = (0.05 + p[1] / n as f32 * 3.0, p[0] / n as f32 * 6.2);
        let (sin, cos) = theta.sin_cos();
        [p[0], p[1], p[2]] = [5.0 * sin * phi.cos(), 5.0 * cos, 5.0 * sin * phi.sin()];
    }
    (positions, indices)
}

#[test]
fn a_point_sphere_holds_every_vertex_and_is_never_larger_than_the_box_one() {
    let mut next = draws(0x51f1_5e11);
    let mut tighter = 0;
    for case in 0..400 {
        // General, flat, colinear and mostly duplicated clouds, up to 1 km out, 1 mm to 1 km wide.
        let (n, scale, far) = (
            1 + case % 50,
            [1e-3, 1.0, 1e3][case % 3],
            [0.0, 1e3][case % 2],
        );
        let positions: Vec<f32> = (0..n)
            .flat_map(|i| {
                let p = [next(), next(), next()];
                match case % 4 {
                    1 => [p[0], p[1], 0.0],
                    2 => [p[0], p[0] * 0.5, -p[0]],
                    3 if i % 3 != 0 => [0.1, 0.2, 0.3],
                    _ => p,
                }
            })
            .map(|x| (far + x * scale) as f32)
            .collect();
        let indices: Vec<u32> = (0..n as u32).chain(0..n as u32 / 2).collect();
        let (sphere, base) = (
            point_sphere(&positions, &indices),
            bounds::bounding_sphere(&positions, &indices),
        );
        assert!(holds_vertices(sphere, &positions, &indices), "case {case}");
        // The smallest ball, up to the rounding of its re-measured radius.
        assert!(sphere[3] <= base[3] * (1.0 + 1e-12), "case {case}");
        tighter += usize::from(sphere[3] < base[3]);
    }
    assert!(tighter > 200, "{tighter} spheres tightened");
    // Nothing and non-finite vertices give the zero sphere; one vertex is its own point.
    let positions = [0.0, -0.0, 0.0, f32::NAN, 1.0, 2.0, f32::INFINITY, 0.0, 0.0];
    for indices in [&[][..], &[0, 1], &[0, 2]] {
        assert_eq!(point_sphere(&positions, indices), [0.0; 4]);
    }
    assert_eq!(point_sphere(&positions, &[0]), [0.0, -0.0, 0.0, 0.0]);
}

#[test]
fn a_ball_of_balls_holds_every_ball_and_is_the_smallest() {
    let mut next = draws(0xba11);
    assert_eq!(ball_of_balls(&[]), [0.0; 4]);
    let one = [1.0, 2.0, 3.0, 0.5];
    assert_eq!(ball_of_balls(&[one, [9.0, 9.0, 9.0, -1.0]]), one);
    for case in 0..400 {
        // Up to 1 km from the origin, points (radius 0) among them, an absent ball (radius -1).
        let (n, far) = (2 + case % 32, [1.0, 1e3, 1e-2][case % 3]);
        let spheres: Vec<[f64; 4]> = (0..n)
            .map(|i| {
                let r = match (i, case % 5) {
                    (3, _) => -1.0,
                    (_, 0) => 0.0,
                    _ => next().abs() * 0.3,
                };
                [next() + far, next() * 2.0 - far, next() * 0.1, r]
            })
            .collect();
        let (ball, merged) = (ball_of_balls(&spheres), enclosing_sphere(&spheres));
        // Never larger than the sequential merge, up to the containment margin.
        assert!(ball[3] <= merged[3] + 1e-9, "case {case}");
        for &s in spheres.iter().filter(|s| s[3] >= 0.0) {
            assert!(holds(ball, [s[0], s[1], s[2]], s[3], 0.0), "case {case}");
        }
        // Balls of radius zero are points: their ball is the points' smallest one.
        if case % 5 == 0 {
            let mut points: Vec<[f64; 3]> = spheres
                .iter()
                .filter(|s| s[3] >= 0.0)
                .map(|s| [s[0], s[1], s[2]])
                .collect();
            let (_, radius) = min_ball(&mut points).expect("points");
            assert!(
                (ball[3] - radius).abs() <= 1e-9 * (1.0 + far),
                "case {case}"
            );
        }
    }
}

#[test]
fn every_sphere_holds_its_cluster_and_children() {
    for (positions, indices) in [grid(96), ball(160)] {
        let (dag, groups, _) = build_of(&positions, &indices);
        for cluster in dag.iter().filter(|c| c.level == 0) {
            assert_eq!(cluster.sphere, point_sphere(&positions, &cluster.indices));
            assert!(holds_vertices(cluster.sphere, &positions, &cluster.indices));
        }
        for group in &groups {
            let children: Vec<[f64; 4]> = group.children.iter().map(|&id| dag[id].sphere).collect();
            assert_eq!(group.sphere, ball_of_balls(&children));
            for &id in &group.children {
                // A ball left on the merge keeps its rounding (1.1e-13 m).
                let [x, y, z, r] = dag[id].sphere;
                assert!(holds(group.sphere, [x, y, z], r, 1e-12), "a child leaves");
                assert_eq!(dag[id].parent_sphere, group.sphere);
            }
            for &id in &group.outputs {
                assert!(holds_vertices(group.sphere, &positions, &dag[id].indices));
            }
            // A group under the floor is its level's only one, with no group to join.
            let peers = groups.iter().filter(|g| g.level == group.level).count();
            assert!(group.children.len() >= DAG_GROUP_MIN || peers == 1);
        }
    }
}
