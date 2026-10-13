//! The reference values of the ray–triangle hit (`golden.rs`): the Möller–Trumbore distance of
//! `ray_triangle`, held to the TypeScript and WGSL twins by `packages/math/golden/ray_triangle.json`.

use crate::golden::{f64s, ordinary, Twin, Value, HOSTILE_F64};

pub(crate) fn twin() -> Twin {
    Twin {
            file: "ray_triangle",
            name: "ray_triangle",
            about: "rayTriangle (math geometry/rayTriangle.ts), ray_triangle (math/rust triangle.rs), rayTriangleDistance (math wgsl/geometry.ts): the distance of a two-sided Moller-Trumbore hit within (near, far), none for a miss",
            inputs: "origin: 3 f64, direction: 3 f64, a: 3 f64, b: 3 f64, c: 3 f64, near: f64, far: f64",
            outputs: "the distance as 1 f64, none for a miss",
            ulps: 0,
            cases: ray_triangle_cases,
            compute: |v| {
                let at = |k: usize| [v[k].f64(), v[k + 1].f64(), v[k + 2].f64()];
                match crate::triangle::ray_triangle(
                    at(0),
                    at(3),
                    [at(6), at(9), at(12)],
                    (v[15].f64(), v[16].f64()),
                ) {
                    Some((distance, _)) => f64s(&[distance]),
                    None => Vec::new(),
                }
            },
        }
}

/// A ray at `origin` along `direction` against the corners `a`, `b`, `c`, within (`near`, `far`).
fn ray_case(
    origin: [f64; 3],
    direction: [f64; 3],
    corners: [[f64; 3]; 3],
    range: (f64, f64),
) -> Vec<Value> {
    let [a, b, c] = corners;
    f64s(
        &[origin, direction, a, b, c]
            .concat()
            .into_iter()
            .chain([range.0, range.1])
            .collect::<Vec<_>>(),
    )
}

/// A unit right triangle crossed face on, at its edges and corners, parallel, behind and past the
/// range, a ray of another length and of the hostile values, then scattered rays and triangles.
fn ray_triangle_cases() -> Vec<Vec<Value>> {
    let corners = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
    let range = (1e-4, 10.0);
    let down = [0.0, 0.0, -1.0];
    let mut cases = Vec::new();
    for origin in [
        [0.25, 0.25, 3.0],
        [0.5, 0.5, 3.0],
        [0.0, 0.0, 3.0],
        [1.0, 0.0, 3.0],
        [0.0, 1.0, 3.0],
        [0.5, 0.0, 3.0],
        [0.0, 0.5, 3.0],
        [1.5, 1.5, 3.0],
        [-0.1, 0.5, 3.0],
        [0.25, 0.25, 1e-5],
        [0.25, 0.25, -3.0],
        [0.25, 0.25, 11.0],
    ] {
        cases.push(ray_case(origin, down, corners, range));
        cases.push(ray_case(origin, [0.0, 0.0, 1.0], corners, range));
    }
    for direction in [
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1e-13],
        [0.0, 0.0, -1e-11],
        [0.0, 0.0, -50.0],
        [0.1, 0.2, -1.0],
    ] {
        cases.push(ray_case([0.25, 0.25, 3.0], direction, corners, range));
    }
    for hostile in HOSTILE_F64 {
        cases.push(ray_case([0.25, 0.25, hostile], down, corners, range));
        cases.push(ray_case(
            [0.25, 0.25, 3.0],
            [0.0, 0.0, hostile],
            corners,
            range,
        ));
        cases.push(ray_case(
            [0.25, 0.25, 3.0],
            down,
            [[0.0, 0.0, 0.0], [hostile, 0.0, 0.0], [0.0, 1.0, 0.0]],
            range,
        ));
    }
    cases.push(ray_case([0.25, 0.25, 3.0], down, corners, (1e-4, 3.0)));
    cases.push(ray_case([0.25, 0.25, 3.0], down, corners, (3.0, 10.0)));
    cases.push(ray_case(
        [0.25, 0.25, 3.0],
        down,
        corners,
        (-f64::MAX, f64::INFINITY),
    ));
    cases.push(ray_case([0.25, 0.25, 3.0], down, [[0.0; 3]; 3], range));
    cases.push(ray_case(
        [0.25, 0.25, 3.0],
        down,
        [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]],
        range,
    ));
    let draw = |i: u64| ordinary(i) / 100.0;
    for k in 0..192u64 {
        let at = |j: u64| [draw(k * 15 + j), draw(k * 15 + j + 1), draw(k * 15 + j + 2)];
        let (origin, aim, triangle) = (at(0), at(3), [at(6), at(9), at(12)]);
        // Every third ray aims at the triangle's centre, the others anywhere.
        let direction = if k % 3 == 0 {
            let centre = |axis: usize| triangle.iter().map(|c| c[axis]).sum::<f64>() / 3.0;
            [
                centre(0) - origin[0],
                centre(1) - origin[1],
                centre(2) - origin[2],
            ]
        } else {
            aim
        };
        cases.push(ray_case(
            origin,
            direction,
            triangle,
            (1e-4, 10.0 + 4.0 * draw(k + 7)),
        ));
    }
    cases
}
