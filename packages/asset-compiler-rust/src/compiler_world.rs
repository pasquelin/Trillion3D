use super::*;

// The matrices and rotations every scene driver composes with, from the maths crate.
pub(super) use trillion3d_math::linear::cofactor_direction;
use trillion3d_math::matrix::{compose_trs, multiply_matrix4_from_zero};
pub(super) use trillion3d_math::matrix::{scaling, translation, IDENTITY};
pub(super) use trillion3d_math::rotation::{
    axis_angle, axis_rotation, identity, quaternion_wxyz, rotation_matrix, turn,
};

/// A glTF node transform, column-major like the format itself.
pub(super) type Mat4 = [f64; 16];
/// A scene graph deeper than this is refused rather than followed: a cycle would never end.
const MAX_DEPTH: usize = 256;

fn numbers(value: Option<&Value>, length: usize, what: &str) -> Result<Option<Vec<f64>>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let items = value
        .as_array()
        .ok_or_else(|| invalid(format!("node.{what} is not an array")))?;
    if items.len() != length {
        return Err(invalid(format!("node.{what} needs {length} numbers")));
    }
    items
        .iter()
        .map(|item| {
            item.as_f64()
                .filter(|v| v.is_finite())
                .ok_or_else(|| invalid(format!("node.{what} holds a non-finite number")))
        })
        .collect::<Result<Vec<f64>>>()
        .map(Some)
}

/// `matrix` when the node carries one, otherwise translation · rotation · scale, as glTF defines it.
pub(super) fn local_matrix(node: &Value) -> Result<Mat4> {
    if let Some(values) = numbers(node.get("matrix"), 16, "matrix")? {
        let mut matrix = IDENTITY;
        matrix.copy_from_slice(&values);
        return Ok(matrix);
    }
    let t = numbers(node.get("translation"), 3, "translation")?.unwrap_or(vec![0., 0., 0.]);
    let r = numbers(node.get("rotation"), 4, "rotation")?.unwrap_or(vec![0., 0., 0., 1.]);
    let s = numbers(node.get("scale"), 3, "scale")?.unwrap_or(vec![1., 1., 1.]);
    Ok(compose_trs(
        [t[0], t[1], t[2]],
        [r[0], r[1], r[2], r[3]],
        [s[0], s[1], s[2]],
    ))
}

/// World transform of every node, by node index. A node glTF never reaches keeps the identity, and
/// nothing reads it: only the nodes a scene names carry a mesh the compiler selected.
pub(super) fn world_matrices(g: &Value) -> Result<Vec<Mat4>> {
    let nodes = values(g, "nodes")?;
    let mut world = vec![IDENTITY; nodes.len()];
    let mut is_child = vec![false; nodes.len()];
    for id in 0..nodes.len() {
        for child in crate::compiler_nodes::children_of(nodes, id)? {
            if is_child[child] {
                return Err(invalid("A node is the child of two parents"));
            }
            is_child[child] = true;
        }
    }
    let mut stack: Vec<(usize, Mat4, usize)> = (0..nodes.len())
        .filter(|id| !is_child[*id])
        .map(|id| (id, IDENTITY, 0usize))
        .collect();
    while let Some((id, parent, depth)) = stack.pop() {
        if depth > MAX_DEPTH {
            return Err(invalid("Node hierarchy is deeper than the supported limit"));
        }
        let matrix = multiply_matrix4_from_zero(&parent, &local_matrix(&nodes[id])?);
        world[id] = matrix;
        for child in crate::compiler_nodes::children_of(nodes, id)? {
            stack.push((child, matrix, depth + 1));
        }
    }
    Ok(world)
}
