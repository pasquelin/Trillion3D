//! Ce que le découpage d une géométrie lue produit : triangulation, face sets, refus de topologie.
//!
//! Les archives réelles passent par la dorée ; ici, la géométrie est donnée à la main, face par face.
use super::super::geom::Geometry;
use super::super::mesh::{parts, FaceSet};
use super::super::TOPOLOGY_INVALID;

/// Un maillage de trois faces sur six positions : un triangle, un pentagone, et une face de deux
/// côtés, qui ne porte aucune surface.
fn three_faces() -> Geometry {
    Geometry {
        positions: (0..18).map(|value| value as f32).collect(),
        counts: vec![3, 5, 2],
        corners: vec![0, 1, 2, 0, 1, 2, 3, 4, 0, 1],
        normals: None,
        uv: None,
        dropped: Vec::new(),
    }
}

// Comportement : une face de plus de trois côtés est découpée en éventail, dans l'ordre inverse de
// celui qu'Alembic écrit, et chaque face set devient un morceau à part. Une face revendiquée deux
// fois reste au premier face set, et une face de moins de trois côtés est comptée sans être rendue.
#[test]
fn faces_are_fanned_backwards_and_split_by_face_set() {
    let facesets = [
        FaceSet {
            name: "A".into(),
            faces: vec![1],
        },
        FaceSet {
            name: "B".into(),
            faces: vec![1, 0],
        },
    ];
    let (parts, counted) = parts(&three_faces(), &facesets).expect("morceaux");
    assert_eq!(counted.overlaps, 1, "la face 1 est revendiquée deux fois");
    assert_eq!(counted.degenerate, 1, "la face de deux côtés est comptée");
    assert_eq!(parts.len(), 2, "un morceau par face set servi");
    assert_eq!(parts[0].faceset, Some(0));
    // Le pentagone 0,1,2,3,4 lu à l'envers donne 4,3,2,1,0, découpé en trois triangles.
    assert_eq!(parts[0].indices, [0, 1, 2, 0, 2, 3, 0, 3, 4]);
    assert_eq!(
        parts[0].positions[..3],
        [12.0, 13.0, 14.0],
        "le coin 4 d'abord"
    );
    assert_eq!(parts[1].faceset, Some(1));
    assert_eq!(
        parts[1].indices,
        [0, 1, 2],
        "le triangle 0,1,2 lu à l'envers"
    );
    assert_eq!(
        parts[1].positions[..3],
        [6.0, 7.0, 8.0],
        "le coin 2 d'abord"
    );
}

// Comportement : un indice de face hors de la table des positions est un fichier qui se contredit,
// refusé par son nom plutôt que lu hors de ce qu'il porte.
#[test]
fn a_face_index_outside_the_positions_is_refused_by_name() {
    let mut geometry = three_faces();
    geometry.corners[0] = 99;
    let refusal = parts(&geometry, &[])
        .err()
        .expect("cette topologie devait être refusée");
    assert_eq!(refusal.code, TOPOLOGY_INVALID);
}
