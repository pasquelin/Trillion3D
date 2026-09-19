//! What a poured model leaves to instantiate, and where each piece sits in the model.
//!
//! The format driver has yielded a complete glTF: a node hierarchy, some of which carry a mesh.
//! The Unity scene instantiates those pieces under the node it places. Each therefore keeps the
//! matrix that locates it in the model — its local transform composed with those of its parents —
//! and it is that matrix which then composes with the instance's.
use super::*;
use crate::compiler_world::{Mat4, IDENTITY};

/// What a poured model leaves to instantiate: its mesh-bearing nodes.
#[derive(Clone)]
pub(super) struct Parts {
    /// Name, node matrix in the model — hierarchy included —, mesh index in the scene. `Null` when
    /// that matrix is identity: the poured node then carries none.
    pub(super) nodes: Vec<(String, Value, usize)>,
}

/// Matrix of each model node in model space: its local transform — written as a matrix, or as
/// translation, rotation and scale — composed with those of its parents. A model whose hierarchy
/// does not compose (index out of table, node with two parents, endless tree) is poured without
/// a transform, and the fact is counted rather than guessed.
pub(super) fn model_matrices(gltf: &Value, scene: &mut Scene) -> Vec<Mat4> {
    match crate::compiler_world::world_matrices(gltf) {
        Ok(matrices) => matrices,
        Err(_) => {
            scene.report.add("unity-model-hierarchy-invalid");
            Vec::new()
        }
    }
}

/// Mesh-bearing nodes of the model, each with the matrix that locates it in the model.
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
