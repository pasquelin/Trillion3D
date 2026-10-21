//! The smallest ball of points (`min_ball::point_sphere`) on its edge cases, then the DAG's
//! projection spheres (`bounds::points_ball`, `bounds::balls_ball`) on whole DAGs of smooth meshes.
use super::*;
use trillion3d_math::vector::vec3::point;
use trillion3d_math::vector::vecn::{length, sub};
use trillion3d_page_codec::min_ball::point_sphere;

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

/// The oracle the smallest ball is checked against: the box centre and its farthest vertex.
fn box_sphere(positions: &[f32], indices: &[u32]) -> [f64; 4] {
    let points: Vec<[f64; 3]> = indices.iter().map(|&v| point(positions, v)).collect();
    let (low, high) = trillion3d_math::geometry::aabb::aabb_of(points.iter().copied());
    let c = trillion3d_math::geometry::aabb::centre(low, high);
    let r = trillion3d_math::geometry::sphere::farthest(c, points.iter().map(|&p| (p, 0.0)));
    [c[0], c[1], c[2], r]
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
            box_sphere(&positions, &indices),
        );
        assert!(holds_vertices(sphere, &positions, &indices), "case {case}");
        // The smallest ball, up to the rounding of its re-measured radius.
        assert!(
            sphere[3] <= base[3] * (1.0 + 1e-12),
            "case {case}: {sphere:?} over the box sphere {base:?}"
        );
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
fn every_group_sphere_is_its_children_ball() {
    for (positions, indices) in [grid(96), ball(160)] {
        let (dag, groups, ..) = build_of(&positions, &indices);
        for group in &groups {
            // The children's balls alone: the sphere projects the error, the page's box bounds
            // what it draws (`reduce.rs`).
            let children: Vec<[f64; 4]> = group.children.iter().map(|&id| dag[id].sphere).collect();
            assert_eq!(group.sphere, bounds::balls_ball(&children));
            for &id in &group.children {
                assert_eq!(dag[id].parent_sphere, group.sphere);
            }
            for &id in &group.outputs {
                assert_eq!(dag[id].sphere, group.sphere);
            }
            // A group under the floor is its level's only one, with no group to join.
            let peers = groups.iter().filter(|g| g.level == group.level).count();
            assert!(group.children.len() >= DAG_GROUP_MIN || peers == 1);
        }
    }
}
