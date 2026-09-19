//! What only the driver's interior can prove: the shape of the text read by the command split,
//! and the rules for writing an attribute by slices. Everything else — geometry, materials,
//! textures, refusals — is proven from the golden, by the whole compiler.
use super::*;

/// Document of a text, header included.
fn read_document(body: &str) -> Document {
    document::read(&format!("{HEADER} 2024 scene\n{body}")).expect("document")
}

// Behaviour: a never-closed string stops the read by a named refusal, instead of swallowing the
// rest of the file as if it were part of the name.
#[test]
fn an_unclosed_string_is_refused_by_name() {
    let error = document::read(&format!("{HEADER}\ncreateNode transform -n \"Sans fin;\n"))
        .err()
        .expect("refusal");
    assert_eq!(error.code, FILE_INVALID);
}

// Behaviour: a file that does not open on Maya's header is not read.
#[test]
fn a_file_without_the_maya_header_is_refused() {
    let error = document::read("createNode transform -n \"X\";\n")
        .err()
        .expect("refusal");
    assert_eq!(error.code, FILE_INVALID);
}

// Behaviour: comments of both forms and empty semicolons make no command, and a command outside
// the subset is counted under its own name, never executed.
#[test]
fn a_command_outside_the_subset_is_counted_under_its_own_name() {
    let read = read_document("// a word\n/* another */;;\npython \"print(1)\";\n");
    assert_eq!(read.nodes.len(), 0);
    assert_eq!(
        read.report.unsupported.get("ma-command-ignored:python"),
        Some(&1)
    );
}

// Behaviour: a `setAttr` writes a slice of an array, the stride coming from the type when it
// fixes it and from the number of values per element of the range otherwise.
#[test]
fn set_attr_writes_one_slice_of_an_array_at_a_time() {
    let read = read_document(concat!(
        "createNode mesh -n \"M\";\n",
        "setAttr -s 2 \".vt[0:1]\" -type \"float3\" 0 0 0  1 0 0;\n",
        "setAttr \".vt[2]\" -type \"float3\" 0 1 0;\n",
        "setAttr -s 3 \".ed[0:2]\" 0 1 0  1 2 0  2 0 0;\n",
    ));
    let mesh = &read.nodes[0];
    assert_eq!(
        mesh.attr(&["vt"]).expect("vertices").numbers(),
        [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    );
    assert_eq!(
        mesh.attr(&["ed"]).expect("edges").numbers(),
        [0.0, 1.0, 0.0, 1.0, 2.0, 0.0, 2.0, 0.0, 0.0]
    );
}

// Behaviour: a `setAttr` without a current node is counted, and does not pour onto any node at
// random.
#[test]
fn an_attribute_without_a_node_is_counted() {
    let read = read_document("select -ne :time1;\nsetAttr \".o\" 1;\n");
    assert_eq!(
        read.report.unsupported.get(report::ATTRIBUTE_UNATTACHED),
        Some(&1)
    );
}

// Behaviour: the file's linear unit becomes the factor into metres, and the angular unit the
// factor into degrees.
#[test]
fn the_declared_units_become_the_factors_of_the_scene() {
    assert_eq!(
        read_document("currentUnit -l meter;\n").meters_per_unit,
        1.0
    );
    assert_eq!(
        read_document("currentUnit -l inch;\n").meters_per_unit,
        0.0254
    );
    assert!(read_document("currentUnit -a radian;\n").degrees_per_unit > 57.0);
    assert_eq!(read_document("").meters_per_unit, 0.01);
}

// Behaviour: a face cites its edges, and its corner of rank `k` is the start vertex of the
// `k`-th — the second vertex when the index is written negative.
#[test]
fn a_face_corner_is_the_start_vertex_of_its_signed_edge() {
    let edges = [[0.0, 1.0, 0.0], [1.0, 2.0, 0.0], [2.0, 0.0, 0.0]];
    assert_eq!(mesh::corner(&edges, 1, 3), Some(1));
    assert_eq!(mesh::corner(&edges, -2, 3), Some(2));
    assert_eq!(mesh::corner(&edges, 9, 3), None);
}

// Behaviour: a component list yields the faces it names, and counts what names none.
#[test]
fn a_component_list_names_faces_and_counts_what_is_not_one() {
    let list = [
        "f[0:2]".to_string(),
        "f[5]".to_string(),
        "vtx[1]".to_string(),
    ];
    assert_eq!(faces::components(&list), (vec![0, 1, 2, 5], 1));
}
