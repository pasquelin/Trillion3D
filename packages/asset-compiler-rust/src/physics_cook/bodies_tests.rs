//! Rigid bodies a compiled model declares (`KHR_physics_rigid_bodies`): a declared shape kept as
//! declared, a shapeless one given one hull and weighed exactly at cook time, both listed in
//! `physics.json` beside the static ground their nodes still are.
use super::mass_tests::{assert_boxes, cube, FACES, UNIT};
use super::stage_physics;
use crate::compiler_coplanar::DepthLayerScene;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

// Behaviour: of four drawn unit cubes, the one declaring a dynamic box keeps its shape, motion and
// matter as declared; the one declaring motion without a shape gets a cooked hull weighed as a unit
// cube; the one declaring nothing is no body; the one naming a missing shape is refused by name,
// as is an open square asking for its convex hull. A body that draws nothing, 5 m away, whose
// collider names the plain cube's node, weighs that cube in its own frame; a cube the slice left
// out is no body; a kinematic open square gets its hull, unweighed. The cubes stay static ground
// until the page restores their bodies.
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
            {"mesh":1,"extensions":{"KHR_physics_rigid_bodies":{"motion":{},"collider":{"geometry":{"convexHull":true}}}}},
            {"translation":[5, 0, 0],"extensions":{"KHR_physics_rigid_bodies":{"motion":{},"collider":{"geometry":{"node":2}}}}},
            rigid(json!({"motion":{}})),
            {"mesh":1,"extensions":{"KHR_physics_rigid_bodies":{"motion":{"isKinematic":true}}}}],
    });
    let root =
        std::path::Path::new(env!("OUT_DIR")).join(format!("body-cook-{}", std::process::id()));
    let o = crate::texture_preview::tests::options(&root);
    std::fs::create_dir_all(o.cache.join("native/objects")).unwrap();
    let (chosen, mesh_map) = (BTreeSet::from([0, 1, 2, 3, 4, 7]), BTreeMap::from([(0, 0)]));
    let scene = DepthLayerScene {
        o: &o,
        g: &g,
        bin: &bin,
        chosen: &chosen,
        mesh_map: &mesh_map,
        cluster_planes: &[],
    };
    let primitive = json!({"mesh":0,"primitive":0});
    let collision = json!({"kind":"mesh","tiles":[],"triangles":12});
    stage_physics(&scene, &[primitive], &[collision], &root).unwrap();
    let written: Value =
        serde_json::from_slice(&std::fs::read(root.join("physics.json")).unwrap()).unwrap();
    let bodies = written["bodies"].as_array().unwrap();
    let [declared, shapeless, offset, kinematic] = bodies.as_slice() else {
        panic!("four bodies: {}", written["bodies"]);
    };
    assert_eq!(
        declared,
        &json!({"node":0,"motion":{"mass":5},"shape":{"type":"box","box":{"size":[2, 1, 1]}},
            "friction":0.9,"restitution":0.2,"position":[0.0, 0.0, 0.0],
            "rotation":[0.0, 0.0, 0.0, 1.0],"scale":[1.0, 1.0, 1.0]})
    );
    let shape = &shapeless["shape"];
    assert_eq!(
        (&shapeless["node"], &shape["type"]),
        (&json!(1), &json!("cooked"))
    );
    assert_boxes(&shape["mass"], &UNIT);
    assert_eq!(offset["node"], json!(5));
    assert_boxes(&offset["shape"]["mass"], &[([-5.0, 0.0, 0.0], [1.0; 3])]);
    let sha = shape["sha256"].as_str().unwrap();
    assert!(o.cache.join(format!("native/objects/{sha}.bin")).exists());
    let placed: Vec<&Value> = written["instances"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| &i["node"])
        .collect();
    assert_eq!(placed, [&json!(0), &json!(1), &json!(2), &json!(3)]);
    assert_eq!(written["report"]["bodies"], json!(4));
    let hull = &kinematic["shape"];
    assert_eq!(
        (&kinematic["node"], &hull["type"], &hull["mass"]),
        (&json!(7), &json!("cooked"), &Value::Null)
    );
    assert_eq!(
        written["report"]["bodiesRefused"],
        json!([{"node":3,"reason":"A body's collider names shape 3, which is missing."},
            {"node":4,"reason":"Mesh 1 is not closed: it bounds no volume to weigh."}])
    );
    std::fs::remove_dir_all(root).unwrap();
}
