//! Tighter projection spheres (`tight.rs`, #929).
use super::*;
use tight::{ball_of_balls, point_sphere};

/// Deterministic uniform draws in [-1, 1).
fn draws(seed: u64) -> impl FnMut() -> f64 {
    let mut rng = crate::compute_bench::inputs::Xorshift::new(seed);
    move || (rng.next() >> 11) as f64 / (1u64 << 52) as f64 - 1.0
}

/// Whether `outer` holds `inner` by the rule the runtime reads: `|c_i - C| + r_i <= R`.
fn holds(outer: [f64; 4], inner: [f64; 4]) -> bool {
    let d = crate::shared_math::length(crate::shared_math::sub(
        [inner[0], inner[1], inner[2]],
        [outer[0], outer[1], outer[2]],
    ));
    d + inner[3] <= outer[3]
}

/// A grid rolled onto a cylinder of radius 8: a smooth curved surface.
fn cylinder(n: usize) -> (Vec<f32>, Vec<u32>) {
    let (mut positions, indices) = grid(n);
    for p in positions.chunks_exact_mut(3) {
        let angle = p[0] / n as f32 * 3.0;
        (p[0], p[2]) = (8.0 * angle.cos(), 8.0 * angle.sin() + p[2] * 0.1);
    }
    (positions, indices)
}

#[test]
fn a_point_sphere_holds_every_vertex_and_is_never_larger_than_the_box_one() {
    let mut next = draws(0x51f1_5e11);
    let mut tighter = 0;
    for case in 0..300 {
        let n = 1 + case % 50;
        let squash = [1.0, 1e-3, 1e3][case % 3];
        let positions: Vec<f32> = (0..n * 3)
            .map(|i| (next() * if i % 3 == 2 { squash } else { 1.0 }) as f32)
            .collect();
        let indices: Vec<u32> = (0..n as u32).chain(0..n as u32 / 2).collect();
        let sphere = point_sphere(&positions, &indices);
        let base = bounds::bounding_sphere(&positions, &indices);
        for &v in &indices {
            let p = crate::shared_math::point(&positions, v);
            assert!(holds(sphere, [p[0], p[1], p[2], 0.0]), "case {case}");
        }
        assert!(sphere[3] <= base[3], "case {case}");
        tighter += usize::from(sphere[3] < base[3]);
        if sphere[3] == base[3] {
            assert_eq!(
                sphere.map(f64::to_bits),
                base.map(f64::to_bits),
                "case {case}"
            );
        }
    }
    assert!(tighter > 150, "{tighter} spheres tightened");
}

#[test]
fn a_point_sphere_of_nothing_or_of_non_finite_vertices_is_the_box_one() {
    let positions = [0.0, -0.0, 0.0, f32::NAN, 1.0, 2.0, f32::INFINITY, 0.0, 0.0];
    assert_eq!(point_sphere(&positions, &[]), [0.0; 4]);
    assert_eq!(point_sphere(&positions, &[0]), [0.0; 4]);
    for bad in [[0, 1], [0, 2]] {
        let (sphere, base) = (
            point_sphere(&positions, &bad),
            bounds::bounding_sphere(&positions, &bad),
        );
        assert_eq!(sphere.map(f64::to_bits), base.map(f64::to_bits));
    }
}

#[test]
fn a_ball_of_balls_holds_every_ball_and_is_never_larger_than_the_merge() {
    let mut next = draws(0xba11);
    assert_eq!(ball_of_balls(&[]), enclosing_sphere(&[]));
    let one = [1.0, 2.0, 3.0, 0.5];
    assert_eq!(ball_of_balls(&[one, [9.0, 9.0, 9.0, -1.0]]), one);
    for case in 0..300 {
        let n = 2 + case % 32;
        // Up to 1 km from the origin: containment must survive the rounding far out.
        let far = [1.0, 1e3, 1e-2][case % 3];
        let spheres: Vec<[f64; 4]> = (0..n)
            .map(|i| {
                let r = if i == 3 { -1.0 } else { next().abs() * 0.3 };
                [next() + far, next() * 2.0 - far, next() * 0.1, r]
            })
            .collect();
        let (ball, merged) = (ball_of_balls(&spheres), enclosing_sphere(&spheres));
        assert!(ball[3] <= merged[3], "case {case}");
        // The merge falls back as it was, within its own rounding; a tightened ball holds exactly.
        let slack = if ball == merged { 1e-9 } else { 0.0 };
        for &s in spheres.iter().filter(|s| s[3] >= 0.0) {
            let grown = [ball[0], ball[1], ball[2], ball[3] + slack];
            assert!(holds(grown, s), "case {case}: {s:?} outside {ball:?}");
        }
    }
}

#[test]
fn every_tightened_sphere_holds_its_children_and_is_no_larger_than_the_builder_one() {
    for (positions, indices) in [grid(96), cylinder(96)] {
        let (dag, groups, _) = build_of(&positions, &indices);
        let mut loose: Vec<[f64; 4]> = vec![[0.0; 4]; dag.len()];
        for (id, cluster) in dag.iter().enumerate().filter(|(_, c)| c.level == 0) {
            loose[id] = bounds::bounding_sphere(&positions, &cluster.indices);
            assert!(dag[id].sphere[3] <= loose[id][3]);
            for &v in &cluster.indices {
                let p = crate::shared_math::point(&positions, v);
                assert!(holds(cluster.sphere, [p[0], p[1], p[2], 0.0]));
            }
        }
        let (mut smaller, mut larger) = (0usize, 0usize);
        for group in &groups {
            let children: Vec<[f64; 4]> = group.children.iter().map(|&id| loose[id]).collect();
            let builder = enclosing_sphere(&children);
            group.outputs.iter().for_each(|&id| loose[id] = builder);
            for &id in &group.children {
                assert!(
                    holds(group.sphere, dag[id].sphere),
                    "a child leaves its group"
                );
                assert_eq!(dag[id].parent_sphere, group.sphere);
            }
            smaller += usize::from(group.sphere[3] < builder[3]);
            larger += usize::from(group.sphere[3] > builder[3]);
        }
        assert_eq!(larger, 0, "{larger} of {} groups larger", groups.len());
        assert!(
            smaller * 2 > groups.len(),
            "{smaller} of {} groups smaller",
            groups.len()
        );
    }
}
