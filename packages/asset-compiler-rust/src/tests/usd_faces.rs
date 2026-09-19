//! Faces a `Mesh` declares and its arrays do not carry: an index outside the
//! points, a negative index, a corner count below three, a negative primvar index.
//!
//! None is guessed and none leaves in silence: it is counted by name, and the
//! surface around it is rendered.
use super::*;
use usd_driver::{compile_layer, wrap};
use usd_matiere::unsupported;

/// Compiles a mesh alone, at the subdivision scheme the case names.
fn mesh_layer(tag: &str, attributes: &str, scheme: &str) -> GoldenRun {
    let body = format!(
        r#"
    def Mesh "Quad"
    {{
{attributes}        uniform token subdivisionScheme = "{scheme}"
    }}
"#
    );
    compile_layer(tag, &wrap("", &body))
}

/// Triangle count of a mesh without subdivision, and the count of its invalid faces.
fn mesh_run(tag: &str, attributes: &str) -> (Value, Value) {
    let run = mesh_layer(tag, attributes, "none");
    let faces = unsupported(&run)["usd-face-invalid"].clone();
    (run.result["sourceTriangles"].clone(), faces)
}

/// Points of a ribbon of two quads, and nothing else.
const POINTS: &str =
    "        point3f[] points = [(0,0,0), (1,0,0), (1,1,0), (0,1,0), (1,2,0), (0,2,0)]\n";

// Behaviour 52: a face whose an index leaves the points array, whose an index is
// negative, or that counts fewer than three corners, is counted by name and
// dropped — never clamped to zero, which would fold it onto the first point. The
// rule also holds for a primvar's indices.
#[test]
fn a_face_whose_indices_leave_the_arrays_is_counted_and_dropped_never_clamped() {
    let outside = format!(
        "        int[] faceVertexCounts = [4, 3, 4]\n        int[] faceVertexIndices = [0, 1, 2, 3, 0, 1, 9, 3, 2, 4, 5]\n{POINTS}"
    );
    assert_eq!(
        mesh_run("face-hors", &outside),
        (json!(4), json!(1)),
        "the index outside the points drops its face and counts it"
    );

    let negative = format!(
        "        int[] faceVertexCounts = [4, 3]\n        int[] faceVertexIndices = [0, 1, 2, 3, 0, 1, -1]\n{POINTS}"
    );
    assert_eq!(
        mesh_run("face-negatif", &negative),
        (json!(2), json!(1)),
        "a negative index is invalid, it is not point zero"
    );

    let thin = format!(
        "        int[] faceVertexCounts = [4, 2]\n        int[] faceVertexIndices = [0, 1, 2, 3, 0, 1]\n{POINTS}"
    );
    assert_eq!(
        mesh_run("face-mince", &thin),
        (json!(2), json!(1)),
        "a face of fewer than three corners is counted and dropped"
    );

    let primvar = format!(
        r#"        int[] faceVertexCounts = [4, 4]
        int[] faceVertexIndices = [0, 1, 2, 3, 3, 2, 4, 5]
{POINTS}        texCoord2f[] primvars:st = [(0,0), (1,0), (1,1), (0,1)] (
            interpolation = "faceVarying"
        )
        int[] primvars:st:indices = [0, 1, 2, -1, 0, 1, 2, 3]
"#
    );
    assert_eq!(
        mesh_run("face-primvar", &primvar),
        (json!(2), json!(1)),
        "a negative primvar index drops its face instead of reading rank zero"
    );
}

/// The whole ribbon, its two quads, and the holes the case declares.
fn ribbon(holes: &str) -> String {
    format!("        int[] faceVertexCounts = [4, 4]\n        int[] faceVertexIndices = [0, 1, 2, 3, 3, 2, 4, 5]\n{POINTS}        int[] holeIndices = [{holes}]\n")
}

// Finding A11: `holeIndices` names the faces OpenUSD renders invisible. They were
// read nowhere: the ribbon came out whole, four triangles, and the report said
// nothing. They now leave the surface and are counted, whichever the subdivision
// scheme — an invisible face is so before any subdivision.
#[test]
fn les_faces_de_holeindices_sortent_de_la_surface_et_sont_comptees() {
    let run = mesh_layer("trou", &ribbon("1"), "none");
    assert_eq!(
        (
            run.result["sourceTriangles"].clone(),
            unsupported(&run)["usd-face-hole"].clone()
        ),
        (json!(2), json!(1)),
        "the named face leaves the ribbon and its drop is counted"
    );

    let subdivided = mesh_layer("trou-subdivise", &ribbon("1"), "catmullClark");
    assert_eq!(
        (
            subdivided.result["sourceTriangles"].clone(),
            unsupported(&subdivided)["usd-face-hole"].clone(),
            unsupported(&subdivided)["usd-subdivision-unsupported"].clone()
        ),
        (json!(2), json!(1), json!(1)),
        "the hole holds under an unrendered subdivision too"
    );

    let outside = mesh_layer("trou-hors", &ribbon("7"), "none");
    assert_eq!(
        (
            outside.result["sourceTriangles"].clone(),
            unsupported(&outside)["usd-face-hole"].clone(),
            unsupported(&outside)["usd-face-invalid"].clone()
        ),
        (json!(4), Value::Null, json!(1)),
        "a hole index outside the face array is an invalid face, not a hole"
    );
}
