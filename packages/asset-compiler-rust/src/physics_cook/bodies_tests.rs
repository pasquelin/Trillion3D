//! Rigid bodies a compiled model declares (`KHR_physics_rigid_bodies`): a declared shape kept as
//! declared, a shapeless one decomposed into hulls and weighed at cook time, both listed in
//! `physics.json` beside the static ground their nodes still are.
use super::decompose::decompose;
use super::hulls::{hulls_shape, DENSITY};
use super::stage_physics;
use super::tests::assert_golden;
use crate::compiler_coplanar::DepthLayerScene;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// The golden hull: a unit cube from the origin, Jolt's `ConvexHullShape` binary state.
const GOLDEN: &str = "../../tests/fixtures/physics/cube-hull.bin";
const FACES: [u32; 36] = [
    0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3,
    5, 3, 7, 5,
];
fn cube(o: [f32; 3], s: [f32; 3]) -> Vec<f32> {
    (0..8)
        .flat_map(|c| (0..3).map(move |a| o[a] + if c >> a & 1 == 1 { s[a] } else { 0.0 }))
        .collect()
}
/// Asserts the mass properties of a unit cube from the origin at the runtime's density: 1000 kg
/// about its middle, inertia m/6 on the diagonal, none off it.
fn assert_unit_cube(mass: f64, centre: &[f64], inertia: &[f64]) {
    assert!((mass - 1000.0).abs() < 1e-2, "{mass}");
    assert!(centre.iter().all(|c| (c - 0.5).abs() < 1e-5), "{centre:?}");
    for (k, i) in inertia.iter().enumerate() {
        let expected = if k % 4 == 0 { 1000.0 / 6.0 } else { 0.0 };
        assert!((i - expected).abs() < 1e-2, "inertia {k}: {i}");
    }
}

// Behaviour: a unit cube's hull weighs 1000 kg about its middle at the runtime's density
// (`commands.cpp`), and cooks to the golden bytes (`TRILLION3D_WRITE_GOLDEN` rewrites them); an
// L of two boxes is cut into convex parts, within the cap of 64; a flat square has none.
#[test]
fn a_hull_is_weighed_at_cook_and_a_concave_body_decomposed() {
    let runtime = include_str!("../../../physics-jolt-wasm/src/commands.cpp");
    assert!(runtime.contains(&format!("SHAPE_DENSITY = {DENSITY:.1}f;")));
    let (bytes, mass) = hulls_shape(&[cube([0.0; 3], [1.0; 3])], DENSITY).unwrap();
    let widen = |v: &[f32]| v.iter().map(|&x| x as f64).collect::<Vec<_>>();
    assert_unit_cube(
        mass.mass as f64,
        &widen(&mass.centre),
        &widen(&mass.inertia),
    );
    assert_golden(&bytes, GOLDEN);
    let (mut pos, mut triangles) = (cube([0.0; 3], [4.0, 1.0, 1.0]), FACES.to_vec());
    pos.extend(cube([0.0, 1.0, 0.0], [1.0, 3.0, 1.0]));
    triangles.extend(FACES.iter().map(|i| i + 8));
    let parts = decompose(&pos, &triangles, 0.05).len();
    assert!((2..=64).contains(&parts), "{parts} parts");
    let square = cube([0.0; 3], [1.0, 1.0, 0.0]);
    assert!(
        decompose(&square, &FACES, 0.05).is_empty(),
        "a flat part has no hull"
    );
}

// Behaviour: of four drawn unit cubes, the one declaring a dynamic box keeps its shape, motion and
// matter as declared; the one declaring motion without a shape gets a cooked hull weighed as a unit
// cube; the one declaring nothing is no body; the one naming a missing shape is refused by name,
// as is a cube's flat face asking for its convex hull. The cubes stay static ground until the page
// restores their bodies.
#[test]
fn declared_bodies_are_cooked_beside_the_static_ground() {
    let mut bin = crate::import::f32_bytes(&cube([0.0; 3], [1.0; 3]));
    bin.extend(FACES.iter().flat_map(|i| i.to_le_bytes()));
    let rigid = |body: Value| json!({"mesh":0,"extensions":{"KHR_physics_rigid_bodies":body}});
    let g = json!({
        "bufferViews":[{"buffer":0,"byteLength":96},{"buffer":0,"byteOffset":96,"byteLength":144}],
        "accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":8},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":36},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":6}],
        "meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]},
            {"primitives":[{"attributes":{"POSITION":0},"indices":2}]}],
        "extensions":{"KHR_implicit_shapes":{"shapes":[{"type":"box","box":{"size":[2, 1, 1]}}]},
            "KHR_physics_rigid_bodies":{"physicsMaterials":[{"dynamicFriction":0.9,"restitution":0.2}]}},
        "nodes":[rigid(json!({"motion":{"mass":5},"collider":{"geometry":{"shape":0},"physicsMaterial":0}})),
            rigid(json!({"motion":{}})), {"mesh":0},
            rigid(json!({"motion":{"isKinematic":true},"collider":{"geometry":{"shape":3}}})),
            {"mesh":1,"extensions":{"KHR_physics_rigid_bodies":{"motion":{},"collider":{"geometry":{"convexHull":true}}}}}],
    });
    let root =
        std::path::Path::new(env!("OUT_DIR")).join(format!("body-cook-{}", std::process::id()));
    let o = crate::texture_preview::tests::options(&root);
    std::fs::create_dir_all(o.cache.join("native/objects")).unwrap();
    let (chosen, mesh_map) = (BTreeSet::from([0, 1, 2, 3, 4]), BTreeMap::from([(0, 0)]));
    let scene = DepthLayerScene {
        o: &o,
        g: &g,
        bin: &bin,
        chosen: &chosen,
        mesh_map: &mesh_map,
        cluster_planes: &[],
    };
    let collision = json!({"kind":"mesh","tiles":[],"triangles":12});
    stage_physics(
        &scene,
        &[json!({"mesh":0,"primitive":0})],
        &[collision],
        &root,
    )
    .unwrap();
    let written: Value =
        serde_json::from_slice(&std::fs::read(root.join("physics.json")).unwrap()).unwrap();
    let [declared, shapeless] = written["bodies"].as_array().unwrap().as_slice() else {
        panic!("two bodies: {}", written["bodies"]);
    };
    assert_eq!(
        declared,
        &json!({"node":0,"motion":{"mass":5},"shape":{"type":"box","box":{"size":[2, 1, 1]}},
            "friction":0.9,"restitution":0.2,"position":[0.0, 0.0, 0.0],
            "rotation":[0.0, 0.0, 0.0, 1.0],"scale":[1.0, 1.0, 1.0]})
    );
    let shape = &shapeless["shape"];
    assert_eq!(
        (&shapeless["node"], &shape["type"], &shape["parts"]),
        (&json!(1), &json!("cooked"), &json!(1))
    );
    let floats = |key: &str| {
        let list = shape["mass"][key].as_array().unwrap();
        list.iter().map(|v| v.as_f64().unwrap()).collect::<Vec<_>>()
    };
    let mass = shape["mass"]["mass"].as_f64().unwrap();
    assert_unit_cube(mass, &floats("centerOfMass"), &floats("inertia"));
    let sha = shape["sha256"].as_str().unwrap();
    assert!(o.cache.join(format!("native/objects/{sha}.bin")).exists());
    let placed: Vec<&Value> = written["instances"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| &i["node"])
        .collect();
    assert_eq!(placed, [&json!(0), &json!(1), &json!(2), &json!(3)]);
    assert_eq!(written["report"]["bodies"], json!(2));
    assert_eq!(
        written["report"]["bodiesRefused"],
        json!([{"node":3,"reason":"A body's collider names shape 3, which is missing."},
            {"node":4,"reason":"Mesh 1 is flat: it has no volume to weigh."}])
    );
    std::fs::remove_dir_all(root).unwrap();
}
