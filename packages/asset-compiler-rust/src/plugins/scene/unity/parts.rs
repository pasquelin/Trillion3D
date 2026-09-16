//! Ce qu'un modèle versé laisse à instancier, et où chaque morceau se tient dans le modèle.
//!
//! Le pilote du format a rendu un glTF complet : une hiérarchie de nœuds, dont certains portent un
//! maillage. La scène Unity, elle, instancie ces morceaux sous le nœud qu'elle pose. Chacun garde
//! donc la matrice qui le place dans le modèle — sa transformation locale composée avec celles de
//! ses pères — et c'est cette matrice qui se compose ensuite avec celle de l'instance.
use super::*;
use crate::compiler_world::{Mat4, IDENTITY};

/// Ce qu'un modèle versé laisse à instancier : ses nœuds porteurs de maillage.
#[derive(Clone)]
pub(super) struct Parts {
    /// Nom, matrice du nœud dans le modèle — sa hiérarchie comprise —, rang du maillage dans la
    /// scène. `Null` quand cette matrice est l'identité : le nœud versé n'en porte alors aucune.
    pub(super) nodes: Vec<(String, Value, usize)>,
}

/// La matrice de chaque nœud du modèle dans l'espace du modèle : sa transformation locale — écrite
/// en matrice, ou en translation, rotation et échelle — composée avec celles de ses pères. Un modèle
/// dont la hiérarchie ne se compose pas (indice hors table, nœud à deux pères, arbre sans fin) est
/// versé sans transformation, et le fait est compté plutôt que deviné.
pub(super) fn model_matrices(gltf: &Value, scene: &mut Scene) -> Vec<Mat4> {
    match crate::compiler_world::world_matrices(gltf) {
        Ok(matrices) => matrices,
        Err(_) => {
            scene.report.add("unity-model-hierarchy-invalid");
            Vec::new()
        }
    }
}

/// Les nœuds porteurs de maillage du modèle, chacun avec la matrice qui le place dans le modèle.
pub(super) fn mesh_nodes(
    gltf: &Value,
    map: &[usize],
    matrices: &[Mat4],
) -> Vec<(String, Value, usize)> {
    let mut nodes = Vec::new();
    for (rank, node) in array(gltf, "nodes").iter().enumerate() {
        let Some(mesh) = index(&node["mesh"], map) else {
            continue;
        };
        let name = node["name"].as_str().unwrap_or("mesh").to_string();
        let matrix = match matrices.get(rank) {
            Some(matrix) if *matrix != IDENTITY => json!(matrix),
            Some(_) => Value::Null,
            None => node["matrix"].clone(),
        };
        nodes.push((name, matrix, mesh));
    }
    nodes
}
