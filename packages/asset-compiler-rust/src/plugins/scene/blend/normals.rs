//! Les normales d'un maillage Blender, calculées à la lecture.
//!
//! Un fichier Blender ne stocke aucune normale de rendu : le programme les recalcule à chaque
//! ouverture, depuis la géométrie et le marquage des faces. Ce pilote fait la même chose, et le
//! consigne au rapport.
//!
//! La normale d'une face vient de la formule de Newell, qui vaut pour un polygone quelconque et
//! dont la longueur est le double de l'aire — c'est donc aussi la pondération naturelle d'une
//! moyenne par sommet. Une face marquée nette garde sa propre normale sur chacun de ses coins ;
//! une face lisse reçoit, sur chaque coin, la moyenne des faces lisses qui touchent ce sommet.
use super::*;

/// La normale de chaque coin du maillage, trois flottants par coin.
pub(super) fn corners(geometry: &Geometry) -> Vec<f32> {
    let faces = (0..geometry.faces())
        .map(|face| newell(geometry, face))
        .collect::<Vec<[f32; 3]>>();
    let mut smooth = vec![[0.0f32; 3]; geometry.positions.len() / 3];
    for (face, normal) in faces.iter().enumerate() {
        if geometry.sharp[face] {
            continue;
        }
        for corner in geometry.face(face) {
            let vertex = &mut smooth[*corner as usize];
            for axis in 0..3 {
                vertex[axis] += normal[axis];
            }
        }
    }
    let mut out = Vec::with_capacity(geometry.corners.len() * 3);
    for (face, normal) in faces.iter().enumerate() {
        let flat = unit(*normal);
        for corner in geometry.face(face) {
            let normal = if geometry.sharp[face] {
                flat
            } else {
                let averaged = unit(smooth[*corner as usize]);
                if averaged == [0.0, 0.0, 0.0] {
                    flat
                } else {
                    averaged
                }
            };
            out.extend_from_slice(&normal);
        }
    }
    out
}

/// La somme de Newell d'une face : sa direction normale, de longueur le double de son aire.
fn newell(geometry: &Geometry, face: usize) -> [f32; 3] {
    let corners = geometry.face(face);
    let mut normal = [0.0f32; 3];
    for (rank, corner) in corners.iter().enumerate() {
        let current = position(geometry, *corner);
        let next = position(geometry, corners[(rank + 1) % corners.len()]);
        normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
        normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
        normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
    }
    normal
}

fn position(geometry: &Geometry, vertex: u32) -> [f32; 3] {
    let at = vertex as usize * 3;
    [
        geometry.positions[at],
        geometry.positions[at + 1],
        geometry.positions[at + 2],
    ]
}

/// Le vecteur unitaire, ou le vecteur nul quand il n'y a pas de direction à donner.
fn unit(vector: [f32; 3]) -> [f32; 3] {
    let length = (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt();
    if !length.is_finite() || length == 0.0 {
        return [0.0, 0.0, 0.0];
    }
    [vector[0] / length, vector[1] / length, vector[2] / length]
}
