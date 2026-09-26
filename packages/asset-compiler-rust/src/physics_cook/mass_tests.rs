//! The exact mass of a closed mesh (`mass.rs`) against analytic solids, and the hull a shapeless
//! body collides by (`hull.rs`).
use super::hull::hull_shape;
use super::mass::{solid_mass, DENSITY};
use super::tests::assert_golden;
use serde_json::{json, Value};

/// The golden hull: a unit cube from the origin, Jolt's `ConvexHullShape` binary state.
const GOLDEN: &str = "../../tests/fixtures/physics/cube-hull.bin";
pub(super) const FACES: [u32; 36] = [
    0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3,
    5, 3, 7, 5,
];
pub(super) fn cube(o: [f32; 3], s: [f32; 3]) -> Vec<f32> {
    (0..8)
        .flat_map(|c| (0..3).map(move |a| o[a] + if c >> a & 1 == 1 { s[a] } else { 0.0 }))
        .collect()
}
/// Asserts the `mass` of a unit cube from the origin at the runtime's density: 1000 kg about its
/// middle, inertia m/6 on the diagonal, none off it.
pub(super) fn assert_unit_cube(mass: &Value) {
    let floats = |key: &str| {
        mass[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
    };
    assert!(
        (mass["mass"].as_f64().unwrap() - 1000.0).abs() < 1e-2,
        "{mass}"
    );
    assert!(
        floats("centerOfMass").all(|c| (c - 0.5).abs() < 1e-5),
        "{mass}"
    );
    for (k, i) in floats("inertia").enumerate() {
        let expected = if k % 4 == 0 { 1000.0 / 6.0 } else { 0.0 };
        assert!((i - expected).abs() < 1e-2, "inertia {k}: {i}");
    }
}

/// Mass, centre and inertia of solid boxes (`corner`, `size`) at `DENSITY`, by the textbook box
/// formula and the parallel-axis theorem: the analytic values the integrals must meet.
fn boxes(list: &[([f64; 3], [f64; 3])]) -> (f64, [f64; 3], [[f64; 3]; 3]) {
    let weight = |s: &[f64; 3]| DENSITY * s[0] * s[1] * s[2];
    let mass: f64 = list.iter().map(|(_, s)| weight(s)).sum();
    let centre = [0, 1, 2].map(|k| {
        let moment = |(o, s): &([f64; 3], [f64; 3])| weight(s) * (o[k] + s[k] / 2.0);
        list.iter().map(moment).sum::<f64>() / mass
    });
    let mut inertia = [[0.0; 3]; 3];
    for (o, s) in list {
        let d = [0, 1, 2].map(|k| o[k] + s[k] / 2.0 - centre[k]);
        let square = |v: &[f64; 3]| v.iter().map(|x| x * x).sum::<f64>();
        for (r, row) in inertia.iter_mut().enumerate() {
            for (c, value) in row.iter_mut().enumerate() {
                let own = if r == c {
                    (square(s) - s[r] * s[r]) / 12.0
                } else {
                    0.0
                };
                let shift = if r == c { square(&d) } else { 0.0 } - d[r] * d[c];
                *value += weight(s) * (own + shift);
            }
        }
    }
    (mass, centre, inertia)
}

/// Asserts `mass` is the analytic weighing of `list`.
pub(super) fn assert_boxes(mass: &Value, list: &[([f64; 3], [f64; 3])]) {
    let (m, centre, inertia) = boxes(list);
    let near = |key: &str, expected: Vec<f64>| {
        let found = mass[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap());
        assert!(
            found.zip(expected).all(|(f, e)| (f - e).abs() < 1e-6),
            "{key}: {mass}"
        );
    };
    assert!((mass["mass"].as_f64().unwrap() - m).abs() < 1e-6, "{mass}");
    near("centerOfMass", centre.to_vec());
    near("inertia", inertia.concat());
}

// Behaviour: a closed mesh weighs exactly as the solid it bounds at the runtime's density
// (`commands.cpp`), whichever way it is wound and at its scale: a unit cube 1000 kg about its
// middle, inertia m/6; an L of two boxes 7000 kg, its analytic centre and inertia. An open box is
// refused by name; a unit cube's hull cooks to the golden bytes (`TRILLION3D_WRITE_GOLDEN`).
#[test]
fn a_closed_mesh_is_weighed_exactly_and_its_hull_cooked() {
    let runtime = include_str!("../../../physics-jolt-wasm/src/commands.cpp");
    assert!(runtime.contains(&format!("SHAPE_DENSITY = {DENSITY:.1}f;")));
    let unit = cube([0.0; 3], [1.0; 3]);
    assert_unit_cube(&solid_mass(&unit, &FACES, [1.0; 3], 0).unwrap());
    let inward: Vec<u32> = FACES
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|t| [t[0], t[2], t[1]])
        .collect();
    assert_unit_cube(&solid_mass(&unit, &inward, [1.0; 3], 0).unwrap());
    let stretched = solid_mass(&unit, &FACES, [2.0, 1.0, 1.0], 0).unwrap();
    assert_boxes(&stretched, &[([0.0; 3], [2.0, 1.0, 1.0])]);
    let (mut pos, mut triangles) = (cube([0.0; 3], [4.0, 1.0, 1.0]), FACES.to_vec());
    pos.extend(cube([0.0, 1.0, 0.0], [1.0, 3.0, 1.0]));
    triangles.extend(FACES.iter().map(|i| i + 8));
    let l = solid_mass(&pos, &triangles, [1.0; 3], 0).unwrap();
    assert_eq!(l["mass"], json!(7000.0));
    assert_boxes(
        &l,
        &[
            ([0.0; 3], [4.0, 1.0, 1.0]),
            ([0.0, 1.0, 0.0], [1.0, 3.0, 1.0]),
        ],
    );
    let open = solid_mass(&unit, &FACES[6..], [1.0; 3], 2).unwrap_err();
    assert_eq!(
        open.message,
        "Mesh 2 is not closed: it bounds no volume to weigh."
    );
    assert_golden(&hull_shape(&unit).unwrap(), GOLDEN);
}
