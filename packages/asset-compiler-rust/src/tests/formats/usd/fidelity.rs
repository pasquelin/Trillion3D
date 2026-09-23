//! What the layer says of its scene and that the driver must yield as-is: the
//! axis of each Euler angle, the implicit unit, every root, and what an invisible
//! prim takes with it.
//!
//! Materials have their own file, `material.rs`; what is only counted is in
//! `report.rs`.
use super::driver::{compile_layer, wrap, QUAD};
use super::*;

/// The six Euler orders USD names.
const ORDERS: [&str; 6] = ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"];

/// Quarter turn around X, then Y, then Z, as glTF writes its matrix.
const QUARTERS: [[f64; 16]; 3] = [
    [
        1., 0., 0., 0., 0., 0., 1., 0., 0., -1., 0., 0., 0., 0., 0., 1.,
    ],
    [
        0., 0., -1., 0., 0., 1., 0., 0., 1., 0., 0., 0., 0., 0., 0., 1.,
    ],
    [
        0., 1., 0., 0., -1., 0., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
    ],
];

/// Matrix of the node of this name, rounded to the millionth.
fn matrix_of(gltf: &Value, name: &str) -> Vec<f64> {
    gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["name"] == name)
        .unwrap_or_else(|| panic!("the node {name}"))["matrix"]
        .as_array()
        .expect("matrix")
        .iter()
        .map(|value| (value.as_f64().expect("number") * 1e6).round() / 1e6)
        .collect()
}

/// Root node of the scene, the one that carries the layer's unit and up-axis.
fn scene_root(gltf: &Value) -> &Value {
    gltf["nodes"]
        .as_array()
        .expect("nodes")
        .last()
        .expect("root")
}

// Behaviour 42: the three letters of a `rotateXYZ` … `rotateZYX` name the
// **order** of the rotations, never the order of the components: angles stay
// written `(x, y, z)`. A single non-zero angle therefore turns around its own
// axis, under all six orders.
#[test]
fn the_letters_of_a_euler_order_name_the_order_not_the_axis_of_each_angle() {
    for order in ORDERS {
        for (axis, quarter) in QUARTERS.iter().enumerate() {
            let mut angles = [0.0; 3];
            angles[axis] = 90.0;
            let body = format!(
                r#"    def Xform "Tourne"
    {{
        float3 xformOp:rotate{order} = ({}, {}, {})
        uniform token[] xformOpOrder = ["xformOp:rotate{order}"]
{QUAD}    }}"#,
                angles[0], angles[1], angles[2]
            );
            let run = compile_layer("euler", &wrap("", &body));
            let (_, gltf) = run.prepared("usd");
            assert_eq!(
                matrix_of(&gltf, "Tourne"),
                quarter.to_vec(),
                "rotate{order}: component {axis} is the angle of its own axis"
            );
        }
    }
}

// Behaviour 43: a layer that does not declare `metersPerUnit` is in centimetres,
// which the specification poses as the default — reading it in metres enlarges
// the scene a hundred times.
#[test]
fn a_layer_without_meters_per_unit_is_read_in_centimetres() {
    let run = compile_layer("unite", &wrap("", QUAD));
    let (_, gltf) = run.prepared("usd");
    let root = scene_root(&gltf);
    assert_eq!(root["name"], "usd-root");
    assert_eq!(
        root["matrix"],
        json!([0.01, 0., 0., 0., 0., 0.01, 0., 0., 0., 0., 0.01, 0., 0., 0., 0., 1.]),
        "USD's implicit unit is the centimetre"
    );
}

// Behaviour 44: `defaultPrim` names the asset's entry point, it does not cut the
// rest of the layer: both roots are converted, the one it designates first.
#[test]
fn every_root_of_a_layer_is_converted_and_the_default_prim_comes_first() {
    let body = format!(
        "#usda 1.0\n(\n    defaultPrim = \"B\"\n)\n\ndef Xform \"A\"\n{{\n{QUAD}}}\n\ndef Xform \"B\"\n{{\n{QUAD}}}\n"
    );
    let run = compile_layer("racines", &body);
    assert_eq!(run.result["sourceTriangles"], 4, "both roots are converted");
    let (_, gltf) = run.prepared("usd");
    let nodes = gltf["nodes"].as_array().expect("nodes");
    let children: Vec<&Value> = scene_root(&gltf)["children"]
        .as_array()
        .expect("children")
        .iter()
        .map(|rank| &nodes[rank.as_u64().expect("rank") as usize]["name"])
        .collect();
    assert_eq!(
        children,
        ["B", "A"],
        "the defaultPrim opens the scene, the other root follows"
    );
}

// Behaviour 45: `visibility = invisible` is inherited — the prim and its whole
// descendants leave the scene, and the count says so.
#[test]
fn an_invisible_prim_takes_its_whole_subtree_out_of_the_scene() {
    let body = format!(
        r#"{QUAD}
    def Xform "Cache"
    {{
        token visibility = "invisible"
{QUAD}    }}"#
    );
    let run = compile_layer("invisible", &wrap("", &body));
    assert_eq!(
        run.result["sourceTriangles"], 2,
        "only the visible surface is rendered"
    );
    let (manifest, gltf) = run.prepared("usd");
    assert_eq!(manifest["source"]["counts"]["invisible"], 1);
    assert!(
        !gltf["nodes"]
            .as_array()
            .expect("nodes")
            .iter()
            .any(|node| node["name"] == "Cache"),
        "the invisible prim leaves no node"
    );
}
