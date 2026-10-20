use super::*;

// The matrices a node's transform composes with, from the maths crate; a scene driver imports the
// ones it composes with from there too.
use trillion3d_math::matrix::{compose_trs, multiply_matrix4_from_zero, IDENTITY};

/// A glTF node transform, column-major like the format itself.
pub(super) type Mat4 = [f64; 16];

/// The node's field `key`, `N` finite numbers named `label`; `default` when the node leaves it out.
fn field<const N: usize>(
    node: &Value,
    key: &str,
    label: &str,
    default: [f64; N],
) -> Result<[f64; N]> {
    node.get(key)
        .map_or(Ok(default), |value| GLTF.numbers(Some(value), label))
}

/// `matrix` when the node carries one, otherwise translation · rotation · scale, as glTF defines it.
pub(super) fn local_matrix(node: &Value) -> Result<Mat4> {
    if let Some(matrix) = node.get("matrix") {
        return GLTF.numbers(Some(matrix), "node.matrix");
    }
    Ok(compose_trs(
        field(node, "translation", "node.translation", [0., 0., 0.])?,
        field(node, "rotation", "node.rotation", [0., 0., 0., 1.])?,
        field(node, "scale", "node.scale", [1., 1., 1.])?,
    ))
}

/// World transform of every node, by node index. A node glTF never reaches keeps the identity, and
/// nothing reads it: only the nodes a scene names carry a mesh the compiler selected. The walk
/// starts at the roots of a forest (`hierarchy_roots` refuses a node of two parents), so no cycle
/// is reachable from them and every node is visited once, however deep: the cycles no root reaches
/// are refused before any publication (`check_acyclic`).
pub(super) fn world_matrices(g: &Value) -> Result<Vec<Mat4>> {
    let nodes = values(g, "nodes")?;
    let mut world = vec![IDENTITY; nodes.len()];
    let mut stack: Vec<(usize, Mat4)> = crate::compiler_nodes::hierarchy_roots(nodes)?
        .into_iter()
        .map(|id| (id, IDENTITY))
        .collect();
    while let Some((id, parent)) = stack.pop() {
        let matrix = multiply_matrix4_from_zero(&parent, &local_matrix(&nodes[id])?);
        world[id] = matrix;
        for child in crate::compiler_nodes::children_of(nodes, id)? {
            stack.push((child, matrix));
        }
    }
    Ok(world)
}
