//! Ce que la couche dit de sa scène et que le pilote doit rendre tel quel : l'axe de chaque angle
//! d'Euler, l'unité implicite, toutes les racines, et ce qu'un prim invisible emporte.
//!
//! Les matériaux ont leur propre fichier, `usd_matiere.rs` ; ce qui est seulement compté est dans
//! `usd_rapport.rs`.
use super::*;
use usd_driver::{compile_layer, wrap, QUAD};

/// Les six ordres d'Euler que USD nomme.
const ORDERS: [&str; 6] = ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"];

/// Le quart de tour autour de X, de Y puis de Z, tel que glTF écrit sa matrice.
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

/// La matrice du nœud de ce nom, arrondie au millionième.
fn matrix_of(gltf: &Value, name: &str) -> Vec<f64> {
    gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["name"] == name)
        .unwrap_or_else(|| panic!("le nœud {name}"))["matrix"]
        .as_array()
        .expect("matrix")
        .iter()
        .map(|value| (value.as_f64().expect("nombre") * 1e6).round() / 1e6)
        .collect()
}

/// Le nœud racine de la scène, celui qui porte l'unité et l'axe haut de la couche.
fn scene_root(gltf: &Value) -> &Value {
    gltf["nodes"]
        .as_array()
        .expect("nodes")
        .last()
        .expect("racine")
}

// Comportement 42 : les trois lettres d'un `rotateXYZ` … `rotateZYX` nomment l'**ordre** des
// rotations, jamais l'ordre des composantes : les angles restent écrits `(x, y, z)`. Un seul angle
// non nul tourne donc autour de son propre axe, sous les six ordres.
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
                "rotate{order} : la composante {axis} est l'angle de son propre axe"
            );
        }
    }
}

// Comportement 43 : une couche qui ne déclare pas `metersPerUnit` est en centimètres, ce que la
// spécification pose comme valeur par défaut — la lire en mètres agrandit la scène cent fois.
#[test]
fn a_layer_without_meters_per_unit_is_read_in_centimetres() {
    let run = compile_layer("unite", &wrap("", QUAD));
    let (_, gltf) = run.prepared("usd");
    let root = scene_root(&gltf);
    assert_eq!(root["name"], "usd-root");
    assert_eq!(
        root["matrix"],
        json!([0.01, 0., 0., 0., 0., 0.01, 0., 0., 0., 0., 0.01, 0., 0., 0., 0., 1.]),
        "l'unité implicite de USD est le centimètre"
    );
}

// Comportement 44 : `defaultPrim` nomme le point d'entrée de l'asset, il ne retranche pas le reste
// de la couche : les deux racines sont converties, celle qu'il désigne en tête.
#[test]
fn every_root_of_a_layer_is_converted_and_the_default_prim_comes_first() {
    let body = format!(
        "#usda 1.0\n(\n    defaultPrim = \"B\"\n)\n\ndef Xform \"A\"\n{{\n{QUAD}}}\n\ndef Xform \"B\"\n{{\n{QUAD}}}\n"
    );
    let run = compile_layer("racines", &body);
    assert_eq!(
        run.result["sourceTriangles"], 4,
        "les deux racines sont converties"
    );
    let (_, gltf) = run.prepared("usd");
    let nodes = gltf["nodes"].as_array().expect("nodes");
    let children: Vec<&Value> = scene_root(&gltf)["children"]
        .as_array()
        .expect("children")
        .iter()
        .map(|rank| &nodes[rank.as_u64().expect("rang") as usize]["name"])
        .collect();
    assert_eq!(
        children,
        ["B", "A"],
        "le defaultPrim ouvre la scène, l'autre racine suit"
    );
}

