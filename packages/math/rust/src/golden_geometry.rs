//! The reference values of the vector and sphere twins (`golden.rs`, `golden_tests.rs`): the unit
//! vector in the normal band, and the sphere merge.

use crate::golden::{f64s, ordinary, Twin, Value};
use crate::sphere::merge_spheres;
use crate::vec3::unit_or_itself;

pub(crate) fn twins() -> Vec<Twin> {
    vec![
        Twin {
            file: "vec3_unit",
            name: "vec3_unit",
            about: "normalizeVector3 (math vector/vector.ts), unit_or_itself (math/rust vec3.rs): each axis times 1 / length, a zero vector as it is; inputs in the normal band, where the two lengths agree",
            inputs: "v: 3 f64",
            outputs: "3 f64",
            cases: unit_cases,
            compute: |v| f64s(&unit_or_itself([v[0].f64(), v[1].f64(), v[2].f64()])),
        },
        Twin {
            file: "sphere_union",
            name: "sphere_union",
            about: "sphereUnion (math geometry/sphere.ts), merge_spheres (math/rust sphere.rs): the sphere enclosing two, an empty one (negative radius) given up; centres apart",
            inputs: "left: 4 f64 (x, y, z, radius), right: 4 f64",
            outputs: "4 f64",
            cases: sphere_cases,
            compute: |v| {
                let x: Vec<f64> = v.iter().map(|x| x.f64()).collect();
                f64s(&merge_spheres(
                    [x[0], x[1], x[2], x[3]],
                    [x[4], x[5], x[6], x[7]],
                ))
            },
        },
    ]
}

/// The axes and zeros, signed zeros, ordinary vectors, then ones of a few magnitudes.
fn unit_cases() -> Vec<Vec<Value>> {
    let mut cases: Vec<Vec<Value>> = vec![
        f64s(&[0.0, 0.0, 0.0]),
        f64s(&[-0.0, 0.0, -0.0]),
        f64s(&[1.0, 0.0, 0.0]),
        f64s(&[0.0, -1.0, 0.0]),
        f64s(&[0.0, 0.0, 3.0]),
        f64s(&[3.0, 4.0, 12.0]),
    ];
    cases.extend(
        (0..128u64).map(|i| f64s(&[ordinary(3 * i), ordinary(3 * i + 1), ordinary(3 * i + 2)])),
    );
    for scale in [1e-30, 1e-6, 1e6, 1e30, 1e100] {
        cases.extend(
            (0..8u64).map(|i| {
                f64s(&[ordinary(i), ordinary(i + 9), ordinary(i + 17)].map(|c| c * scale))
            }),
        );
    }
    cases
}

/// Spheres held by the other, apart, touching, one empty, and ordinary pairs.
fn sphere_cases() -> Vec<Vec<Value>> {
    let mut cases: Vec<Vec<Value>> = vec![
        f64s(&[0.0, 0.0, 0.0, -1.0, 1.0, 2.0, 3.0, 4.0]),
        f64s(&[1.0, 2.0, 3.0, 4.0, 0.0, 0.0, 0.0, -1.0]),
        f64s(&[0.0, 0.0, 0.0, 10.0, 1.0, 0.0, 0.0, 1.0]),
        f64s(&[1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 10.0]),
        f64s(&[0.0, 0.0, 0.0, 1.0, 2.0, 0.0, 0.0, 1.0]),
        f64s(&[0.0, 0.0, 0.0, 0.0, 3.0, 4.0, 0.0, 0.0]),
    ];
    cases.extend((0..128u64).map(|i| {
        let c = |k: u64| ordinary(8 * i + k);
        f64s(&[
            c(0),
            c(1),
            c(2),
            c(3).abs() / 4.0,
            c(4),
            c(5),
            c(6),
            c(7).abs() / 4.0,
        ])
    }));
    cases
}

#[test]
fn golden_geometry_twins() {
    crate::golden::run(&twins());
}
