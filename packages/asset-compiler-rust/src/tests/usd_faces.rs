//! Les faces qu'un `Mesh` déclare et que ses tableaux ne portent pas : un indice hors des points,
//! un indice négatif, un compte de coins inférieur à trois, un indice de primvar négatif.
//!
//! Aucune n'est devinée et aucune ne part en silence : elle est comptée par son nom, et la surface
//! qui l'entoure est rendue.
use super::*;
use usd_driver::{compile_layer, wrap};
use usd_matiere::unsupported;

/// Compile un maillage seul, au schéma de subdivision que le cas nomme.
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

/// Le nombre de triangles d'un maillage sans subdivision, et le compte de ses faces invalides.
fn mesh_run(tag: &str, attributes: &str) -> (Value, Value) {
    let run = mesh_layer(tag, attributes, "none");
    let faces = unsupported(&run)["usd-face-invalid"].clone();
    (run.result["sourceTriangles"].clone(), faces)
}

/// Les points d'un ruban de deux quadrilatères, et rien d'autre.
const POINTS: &str =
    "        point3f[] points = [(0,0,0), (1,0,0), (1,1,0), (0,1,0), (1,2,0), (0,2,0)]\n";

// Comportement 52 : une face dont un indice sort du tableau de points, dont un indice est négatif,
// ou qui compte moins de trois coins, est comptée par son nom et retirée — jamais ramenée à zéro,
// ce qui la replierait sur le premier point. La règle vaut aussi pour les indices d'une primvar.
#[test]
fn a_face_whose_indices_leave_the_arrays_is_counted_and_dropped_never_clamped() {
    let outside = format!(
        "        int[] faceVertexCounts = [4, 3, 4]\n        int[] faceVertexIndices = [0, 1, 2, 3, 0, 1, 9, 3, 2, 4, 5]\n{POINTS}"
    );
    assert_eq!(
        mesh_run("face-hors", &outside),
        (json!(4), json!(1)),
        "l'indice hors des points retire sa face et la compte"
    );

    let negative = format!(
        "        int[] faceVertexCounts = [4, 3]\n        int[] faceVertexIndices = [0, 1, 2, 3, 0, 1, -1]\n{POINTS}"
    );
    assert_eq!(
        mesh_run("face-negatif", &negative),
        (json!(2), json!(1)),
        "un indice négatif est invalide, il ne vaut pas le point zéro"
    );

    let thin = format!(
        "        int[] faceVertexCounts = [4, 2]\n        int[] faceVertexIndices = [0, 1, 2, 3, 0, 1]\n{POINTS}"
    );
    assert_eq!(
        mesh_run("face-mince", &thin),
        (json!(2), json!(1)),
        "une face de moins de trois coins est comptée et retirée"
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
        "un indice de primvar négatif retire sa face au lieu de lire le rang zéro"
    );
}

/// Le ruban entier, ses deux quadrilatères, et les trous que le cas déclare.
fn ribbon(holes: &str) -> String {
    format!("        int[] faceVertexCounts = [4, 4]\n        int[] faceVertexIndices = [0, 1, 2, 3, 3, 2, 4, 5]\n{POINTS}        int[] holeIndices = [{holes}]\n")
}

// Constat A11 : `holeIndices` nomme les faces qu'OpenUSD rend invisibles. Elles étaient lues nulle
// part : le ruban sortait entier, quatre triangles, et le rapport ne disait rien. Elles sortent
// maintenant de la surface et sont comptées, quel que soit le schéma de subdivision — une face
// invisible l'est avant toute subdivision.
#[test]
fn les_faces_de_holeindices_sortent_de_la_surface_et_sont_comptees() {
    let run = mesh_layer("trou", &ribbon("1"), "none");
    assert_eq!(
        (
            run.result["sourceTriangles"].clone(),
            unsupported(&run)["usd-face-hole"].clone()
        ),
        (json!(2), json!(1)),
        "la face nommée sort du ruban et son retrait est compté"
    );

    let subdivided = mesh_layer("trou-subdivise", &ribbon("1"), "catmullClark");
    assert_eq!(
        (
            subdivided.result["sourceTriangles"].clone(),
            unsupported(&subdivided)["usd-face-hole"].clone(),
            unsupported(&subdivided)["usd-subdivision-unsupported"].clone()
        ),
        (json!(2), json!(1), json!(1)),
        "le trou vaut aussi sous une subdivision non rendue"
    );

    let outside = mesh_layer("trou-hors", &ribbon("7"), "none");
    assert_eq!(
        (
            outside.result["sourceTriangles"].clone(),
            unsupported(&outside)["usd-face-hole"].clone(),
            unsupported(&outside)["usd-face-invalid"].clone()
        ),
        (json!(4), Value::Null, json!(1)),
        "un indice de trou hors du tableau des faces est une face invalide, pas un trou"
    );
}
