use super::*;
use std::sync::atomic::AtomicBool;

/// A triangle on x from 0 to 1 with a normal, a tangent and a node placing it.
fn document(extras: Value) -> (Value, Vec<u8>) {
    let floats = [
        [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0].as_slice(),
        [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0].as_slice(),
        [1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0].as_slice(),
    ];
    let bytes = crate::support::le::f32_bytes(&floats.concat());
    let accessor = |view: usize, count: usize, kind: &str| json!({"bufferView": view, "componentType": 5126, "count": count, "type": kind});
    let g = json!({
        "buffers": [{"byteLength": bytes.len()}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 36},
            {"buffer": 0, "byteOffset": 36, "byteLength": 36},
            {"buffer": 0, "byteOffset": 72, "byteLength": 48},
        ],
        "accessors": [accessor(0, 3, "VEC3"), accessor(1, 3, "VEC3"), accessor(2, 3, "VEC4")],
        "meshes": [{"primitives": [
            {"attributes": {"POSITION": 0, "NORMAL": 1, "TANGENT": 2}}
        ]}],
        "nodes": [{"mesh": 0, "extras": {"splineMesh": extras}}],
    });
    (g, bytes)
}

/// The spline pass over `bin`, within a budget that holds it.
fn run(g: &mut Value, bin: Vec<u8>, limit: usize) -> Result<Binary> {
    let cancelled = AtomicBool::new(false);
    let budget = Budget {
        limit,
        cancelled: &cancelled,
    };
    bend_spline_meshes(g, Binary::Owned(bin), &budget).map(|(binary, _)| binary)
}

fn floats(g: &Value, bin: &[u8], semantic: &str) -> Vec<f32> {
    let id = g["meshes"][1]["primitives"][0]["attributes"][semantic].as_u64();
    let reader = accessor(g, bin, id.expect("a bent accessor") as usize, None);
    reader.expect("reads").collect_f32().expect("floats")
}

fn near(a: &[f32], b: &[f32]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-5)
}

// Behaviour: a node naming a spline takes a bent copy of its mesh and the spline leaves its
// extras; the reference's default curve, a straight line along x, leaves the mesh as it is.
#[test]
fn the_default_spline_leaves_the_mesh_as_it_is_in_a_copy_of_its_own() {
    let (mut g, bin) = document(json!({}));
    let bent = run(&mut g, bin, usize::MAX).expect("bends");
    assert_eq!(g["nodes"][0]["mesh"], 1);
    assert!(g["nodes"][0]["extras"].get("splineMesh").is_none());
    let expected = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    assert!(near(&floats(&g, bent.bytes(), "POSITION"), &expected));
    assert!(g["meshes"][1]["primitives"][0].get("indices").is_none());
}

// Behaviour: the scale across the curve stretches the mesh across it.
#[test]
fn a_scale_across_the_curve_stretches_the_mesh_across_it() {
    let spec = json!({"startScale": [2.0, 1.0], "endScale": [2.0, 1.0]});
    let (mut g, bin) = document(spec);
    let bent = run(&mut g, bin, usize::MAX).expect("bends");
    let expected = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 2.0, 0.0];
    assert!(near(&floats(&g, bent.bytes(), "POSITION"), &expected));
}

// Behaviour: a mesh the curve mirrors — start scales of mixed signs — has its triangles turned
// over and its tangents' sign reversed, as the normal map's green channel needs it; one it does not
// mirror keeps both.
#[test]
fn a_mirrored_spline_turns_the_triangles_over_and_reverses_the_tangents_sign() {
    let mirrored = json!({"startScale": [-1.0, 1.0], "endScale": [-1.0, 1.0]});
    let (mut g, bin) = document(mirrored);
    let bent = run(&mut g, bin, usize::MAX).expect("bends");
    let signs = floats(&g, bent.bytes(), "TANGENT");
    assert_eq!([signs[3], signs[7], signs[11]], [-1.0, -1.0, -1.0]);
    let id = g["meshes"][1]["primitives"][0]["indices"]
        .as_u64()
        .expect("indices");
    let indices = accessor(&g, bent.bytes(), id as usize, None).expect("reads");
    assert_eq!(indices.collect_u32().expect("corners"), [0, 2, 1]);
    // Both start scales negative: no mirror, the tangents keep their sign.
    let (mut g, bin) = document(json!({"startScale": [-1.0, -1.0], "endScale": [-1.0, -1.0]}));
    let bent = run(&mut g, bin, usize::MAX).expect("bends");
    assert_eq!(floats(&g, bent.bytes(), "TANGENT")[3], 1.0);
    assert!(g["meshes"][1]["primitives"][0].get("indices").is_none());
}

// Behaviour: a field the spline does not have, a value of the wrong kind and a skinned node are
// refused by name; a mesh that names an assembly is bent as its own triangles (the job that builds
// the assembly refuses the bent copy: `assembly::tests`).
#[test]
fn a_spline_that_does_not_read_is_refused_by_name() {
    for (spec, words) in [
        (json!({"startPoss": [0, 0, 0]}), "startPoss"),
        (json!({"endPos": [1, 0]}), "endPos"),
        (json!({"forwardAxis": "w"}), "forwardAxis"),
        (json!({"smoothInterpRollScale": 1}), "smoothInterpRollScale"),
    ] {
        let (mut g, bin) = document(spec);
        let refusal = run(&mut g, bin, usize::MAX).err().expect("refused");
        assert_eq!(refusal.code, "INVALID_SPLINE_MESH");
        assert!(refusal.message.contains(words), "{}", refusal.message);
    }
    let (mut g, bin) = document(json!({}));
    g["nodes"][0]["skin"] = json!(0);
    assert!(run(&mut g, bin, usize::MAX).is_err());
    for (field, value) in [
        ("attributes", json!({"POSITION": 0, "JOINTS_0": 0})),
        ("targets", json!([{}])),
    ] {
        let (mut g, bin) = document(json!({}));
        g["meshes"][0]["primitives"][0][field] = value;
        let refusal = run(&mut g, bin, usize::MAX)
            .err()
            .expect("a deformed primitive");
        assert!(
            refusal.message.contains("skinned or morphed"),
            "{}",
            refusal.message
        );
    }
    let (mut g, bin) = document(json!({}));
    g["meshes"][0]["extras"] = json!({"assembly": {"parts": [], "nodes": []}});
    run(&mut g, bin, usize::MAX).expect("an assembly not built yet is bent as any mesh");
}

// Behaviour: a spline pass past the job's memory budget is refused before the binary is copied, and
// a document naming no spline is handed back as it came, never copied.
#[test]
fn the_spline_pass_is_admitted_by_the_jobs_memory_budget() {
    let (mut g, bin) = document(json!({}));
    let refusal = run(&mut g, bin.clone(), bin.len())
        .err()
        .expect("over the budget");
    assert_eq!(refusal.code, "RAM_ADMISSION_BUDGET_EXCEEDED");
    let (mut g, bin) = document(json!({}));
    g["nodes"][0]["extras"] = json!({});
    let untouched = run(&mut g, bin.clone(), 0).expect("no spline named");
    assert_eq!(untouched.bytes(), bin.as_slice());
    assert_eq!(g["nodes"][0]["mesh"], 0);
}

// Behaviour: nodes that name one mesh with curves of their own each take a bent copy under their
// own curve — the mesh they share is decoded once, never bent twice alike — and the budget counts
// the arrays kept decoded while the last of them waits.
#[test]
fn nodes_bending_one_mesh_each_take_a_copy_bent_under_their_own_curve() {
    let (mut g, bin) = document(json!({}));
    let stretched = json!({"startScale": [2.0, 1.0], "endScale": [2.0, 1.0]});
    g["nodes"].as_array_mut().expect("nodes").push(json!({
        "mesh": 0, "extras": {"splineMesh": stretched}
    }));
    let bent = run(&mut g, bin.clone(), usize::MAX).expect("bends");
    assert_eq!(
        (g["nodes"][0]["mesh"].clone(), g["nodes"][1]["mesh"].clone()),
        (json!(1), json!(2))
    );
    let position = |mesh: usize| {
        let id = g["meshes"][mesh]["primitives"][0]["attributes"]["POSITION"].as_u64();
        let reader = accessor(
            &g,
            bent.bytes(),
            id.expect("a bent accessor") as usize,
            None,
        );
        reader.expect("reads").collect_f32().expect("floats")
    };
    assert!(near(
        &position(1),
        &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    ));
    assert!(near(
        &position(2),
        &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 2.0, 0.0]
    ));
    // The bent copies and the one decoded mesh kept for the second node, over the binary.
    let (mut g, bin) = document(json!({}));
    g["nodes"].as_array_mut().expect("nodes").push(json!({
        "mesh": 0, "extras": {"splineMesh": {}}
    }));
    let appended = 2 * (12 * 3 + 12 * 3 + 16 * 3 + 16);
    let kept = 12 * 3 + 12 * 3 + 16 * 3 + 4 * 3;
    run(&mut g.clone(), bin.clone(), bin.len() + appended + kept).expect("holds both");
    let refusal = run(&mut g, bin.clone(), bin.len() + appended + kept - 1)
        .err()
        .expect("one byte short");
    assert_eq!(refusal.code, "RAM_ADMISSION_BUDGET_EXCEEDED");
}

// Behaviour: a bend that sends a vertex to a point that is not a number is refused at the bend,
// naming the node whose spline did it and what it was: a curve of no tangent has no direction at its
// ends, where the mesh's first and last vertices lie.
#[test]
fn a_bend_that_leaves_a_vertex_not_a_number_is_refused_naming_its_node() {
    let (mut g, bin) = document(json!({"startTangent": [0, 0, 0], "endTangent": [0, 0, 0]}));
    // A node before the bent one, so that the node named is not the first.
    g["nodes"]
        .as_array_mut()
        .expect("nodes")
        .insert(0, json!({"name": "first"}));
    let refusal = run(&mut g, bin, usize::MAX).err().expect("not a number");
    assert_eq!(refusal.code, "NONFINITE_POSITION");
    let message = &refusal.message;
    assert!(message.contains("nodes[1].extras.splineMesh"), "{message}");
    assert!(
        message.contains("Position is not finite once bent"),
        "{message}"
    );
}
