//! A coarse level never inherits a normal from another face (#484). Every corner of a coarse
//! triangle is a vertex some triangle of its group's children draws, with that very normal, and
//! that child's face turns the same way as the coarse face: the normal is its own face's, not the
//! underside of a slab on its top nor a cap on a log's side. Slivers have no face to agree with.
use super::silhouette::{page_indices, Mesh};
use super::*;
use crate::dag::quality::face_normal;
use crate::shared_math::dot;
use std::collections::HashMap;

/// A vertex as a page draws it: its position and its normal, bit for bit.
type Drawn = ([u64; 3], [u64; 3]);

fn drawn(mesh: &Mesh, v: u32) -> Drawn {
    let (p, n) = (mesh.positions[v as usize], mesh.normals[v as usize]);
    (p.map(f64::to_bits), n.map(f64::to_bits))
}

/// Every coarse corner of `primitive` whose normal no agreeing face of its group's children
/// carries, one line each.
pub(in crate::tests) fn foreign_normal_defects(
    objects: &Path,
    primitive: &Value,
    mesh: &Mesh,
) -> Vec<String> {
    let pages = primitive["pages"].as_array().expect("pages");
    let positions: Vec<f32> = mesh.positions.iter().flatten().map(|&v| v as f32).collect();
    let faces = |indices: &[u32]| -> Vec<([u32; 3], [f64; 3])> {
        let triangles = indices.as_chunks::<3>().0.iter();
        triangles
            .filter_map(|t| face_normal(&positions, t).map(|(face, _)| (*t, face)))
            .collect()
    };
    let groups = primitive["structure"]["groups"].as_array().expect("groups");
    let mut defects = Vec::new();
    for (index, group) in groups.iter().enumerate() {
        let ids = |key: &str| -> Vec<usize> {
            let list = group[key].as_array().expect(key).iter();
            list.map(|v| v.as_u64().expect("id") as usize).collect()
        };
        // Per drawn vertex of the children, the faces that draw it.
        let mut owners: HashMap<Drawn, Vec<[f64; 3]>> = HashMap::new();
        for child in ids("children") {
            for (t, face) in faces(&page_indices(objects, &pages[child])) {
                for v in t {
                    owners.entry(drawn(mesh, v)).or_default().push(face);
                }
            }
        }
        for output in ids("outputs") {
            for (t, face) in faces(&page_indices(objects, &pages[output])) {
                for v in t {
                    let own = owners.get(&drawn(mesh, v));
                    if !own.is_some_and(|faces| faces.iter().any(|&f| dot(f, face) > 0.0)) {
                        defects.push(format!(
                            "page {output}: corner {v} of {t:?} carries a normal no agreeing face of group {index} has"
                        ));
                    }
                }
            }
        }
    }
    defects
}
