//! What the Maya ASCII file says of its scene and that the driver must yield
//! as-is: two homonymous nodes under two parents, the faces no engine claims, and
//! the shapes Maya never draws.
//!
//! A `transform`'s pose has its own file, `xform.rs`; the golden scene is in
//! `golden.rs`.
use super::driver::{compile_ma, quad, translations};

/// A mesh of four independent triangles, enough that a partial binding leaves some.
fn four_triangles(name: &str, parent: &str) -> String {
    let vertices: String = (0..4)
        .map(|face| format!("{face} 0 0  {} 0 0  {face} 1 0  ", face + 1))
        .collect();
    let edges: String = (0..4)
        .flat_map(|face| {
            [(0, 1), (1, 2), (2, 0)].map(|(from, to)| (3 * face + from, 3 * face + to))
        })
        .map(|(from, to)| format!("{from} {to} 0  "))
        .collect();
    let records: String = (0..4)
        .map(|face| format!("\t\tf 3 {} {} {}", 3 * face, 3 * face + 1, 3 * face + 2))
        .collect::<Vec<String>>()
        .join("\n");
    format!(
        "createNode mesh -n \"{name}\" -p \"{parent}\";\n\
         \tsetAttr -s 12 \".vt[0:11]\" -type \"float3\" {vertices};\n\
         \tsetAttr -s 12 \".ed[0:11]\" {edges};\n\
         \tsetAttr -s 4 \".fc[0:3]\" -type \"polyFaces\"\n{records};\n"
    )
}

// Finding 10: two transforms named `M` under two different parents are two nodes.
// Maya distinguishes them by their full path — `|A|M` and `|B|M` — and confusing
// them made the second overwrite the first: a `setAttr` aimed at one landed on the other.
#[test]
fn two_transforms_of_the_same_name_under_two_parents_stay_two_nodes() {
    let body = format!(
        "createNode transform -n \"A\";\n\
         createNode transform -n \"M\" -p \"A\";\n{}\
         createNode transform -n \"B\";\n\
         createNode transform -n \"M\" -p \"B\";\n{}\
         setAttr \"|A|M.t\" -type \"double3\" 10 0 0;\n\
         setAttr \"|B|M.t\" -type \"double3\" 0 20 0;\n",
        quad("AShape", "|A|M"),
        quad("BShape", "|B|M"),
    );
    let run = compile_ma("ma-homonymes", &body);
    assert_eq!(
        run.result["sourceTriangles"], 4,
        "both homonymous shapes are rendered"
    );
    let (_, gltf) = run.prepared("ma");
    let moved = translations(&gltf, "M");
    assert_eq!(moved.len(), 2, "each parent keeps its own `M`");
    assert!(
        moved.contains(&[10.0, 0.0, 0.0]) && moved.contains(&[0.0, 20.0, 0.0]),
        "each `setAttr` lands on the node its path names, not the other: {moved:?}"
    );
}

// Finding 11: a `shadingEngine` that claims only part of the faces does not make
// the others vanish. Those no engine names come out in a primitive without a
// material, counted.
#[test]
fn the_faces_no_shading_group_claims_still_reach_the_scene() {
    let body = format!(
        "createNode transform -n \"T\";\n{}\
         \tsetAttr \".iog[0].og[0].gcl\" -type \"componentList\" 1 \"f[0:1]\";\n\
         createNode lambert -n \"Uni\";\n\
         createNode shadingEngine -n \"UniSG\";\n\
         connectAttr \"Uni.oc\" \"UniSG.ss\";\n\
         connectAttr \"TShape.iog.og[0]\" \"UniSG.dsm\" -na;\n",
        four_triangles("TShape", "T"),
    );
    let run = compile_ma("ma-liaison-partielle", &body);
    assert_eq!(
        run.result["sourceTriangles"], 4,
        "all four faces come out, bound or not"
    );
    let (manifest, gltf) = run.prepared("ma");
    let primitives = gltf["meshes"][0]["primitives"]
        .as_array()
        .expect("primitives");
    assert_eq!(
        primitives.len(),
        2,
        "one bound part, one without a material"
    );
    assert_eq!(
        primitives
            .iter()
            .filter(|part| part.get("material").is_none())
            .count(),
        1,
        "unbound faces form a primitive without a material"
    );
    assert_eq!(
        manifest["unsupported"]["ma-face-material-missing"], 2,
        "the two faces no engine claims are counted"
    );
}

// Finding 12: an intermediate shape is a work state Maya never draws, and an
// invisible shape is hidden by the file. Neither enters the scene.
#[test]
fn an_intermediate_or_invisible_shape_never_reaches_the_scene() {
    let body = format!(
        "createNode transform -n \"T\";\n{}{}\tsetAttr \".io\" yes;\n{}\tsetAttr \".v\" no;\n",
        quad("TShape", "T"),
        quad("TWork", "T"),
        quad("THidden", "T"),
    );
    let run = compile_ma("ma-formes-cachees", &body);
    assert_eq!(
        run.result["sourceTriangles"], 2,
        "only the shape Maya draws is rendered"
    );
    let (manifest, gltf) = run.prepared("ma");
    let names: Vec<&str> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .filter_map(|mesh| mesh["name"].as_str())
        .collect();
    assert_eq!(
        names,
        ["TShape"],
        "neither the work shape nor the hidden one"
    );
    assert_eq!(manifest["unsupported"]["ma-shape-intermediate"], 1);
    assert_eq!(manifest["source"]["counts"]["invisible"], 1);
}

// Finding 23: a face that cites the edge `i64::MIN` is refused under its name.
// Maya writes `-(i + 1)` for an edge walked backwards, and the lowest value has
// no opposite: negating it overflowed, which stopped compilation with a panic
// instead of a counted refusal.
#[test]
fn a_face_citing_the_lowest_edge_index_is_refused_by_name() {
    let body = format!(
        "createNode transform -n \"T\";\n{}\
         createNode transform -n \"H\";\n\
         createNode mesh -n \"HShape\" -p \"H\";\n\
         \tsetAttr -s 4 \".vt[0:3]\" -type \"float3\" 0 0 0  1 0 0  1 1 0  0 1 0;\n\
         \tsetAttr -s 4 \".ed[0:3]\" 0 1 0  1 2 0  2 3 0  3 0 0;\n\
         \tsetAttr -s 1 \".fc[0:0]\" -type \"polyFaces\"\n\
         \t\tf 4 {} 1 2 3;\n",
        quad("TShape", "T"),
        i64::MIN,
    );
    let run = compile_ma("ma-arete-minimale", &body);
    assert_eq!(
        run.result["sourceTriangles"], 2,
        "only the healthy shape is rendered"
    );
    let (manifest, _) = run.prepared("ma");
    assert_eq!(
        manifest["unsupported"]["ma-mesh-invalid"], 1,
        "the out-of-table edge is counted under its name"
    );
}
