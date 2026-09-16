//! Les faces qu'un `Mesh` déclare et que ses tableaux ne portent pas : un indice hors des points,
//! un indice négatif, un compte de coins inférieur à trois, un indice de primvar négatif.
//!
//! Aucune n'est devinée et aucune ne part en silence : elle est comptée par son nom, et la surface
//! qui l'entoure est rendue.
use super::*;
use usd_driver::{compile_layer, wrap};
use usd_matiere::unsupported;

/// Compile un maillage seul et rend son nombre de triangles et le compte des faces invalides.
fn mesh_run(tag: &str, attributes: &str) -> (Value, Value) {
    let body = format!(
        r#"
    def Mesh "Quad"
    {{
{attributes}        uniform token subdivisionScheme = "none"
    }}
"#
    );
    let run = compile_layer(tag, &wrap("", &body));
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
