use super::*;

/// A glTF node transform, column-major like the format itself.
pub(super) type Mat4 = [f64; 16];
pub(super) const IDENTITY: Mat4 = [
    1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
];
/// A scene graph deeper than this is refused rather than followed: a cycle would never end.
const MAX_DEPTH: usize = 256;

/// `a · b`, l'opération `b` s'appliquant au point avant `a`. Partagée avec les pilotes de scène
/// qui composent eux-mêmes leurs matrices.
pub(super) fn multiply(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [0.0f64; 16];
    for column in 0..4 {
        for row in 0..4 {
            let mut sum = 0.0;
            for k in 0..4 {
                sum += a[k * 4 + row] * b[column * 4 + k];
            }
            out[column * 4 + row] = sum;
        }
    }
    out
}

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

/// The rotation of a glTF unit quaternion `(x, y, z, w)`, column by column. Shared with the scene
/// plugins that compose their own matrices.
pub(super) fn rotation_matrix([x, y, z, w]: [f64; 4]) -> Mat4 {
    [
        1. - 2. * (y * y + z * z),
        2. * (x * y + z * w),
        2. * (x * z - y * w),
        0.,
        2. * (x * y - z * w),
        1. - 2. * (x * x + z * z),
        2. * (y * z + x * w),
        0.,
        2. * (x * z + y * w),
        2. * (y * z - x * w),
        1. - 2. * (x * x + y * y),
        0.,
        0.,
        0.,
        0.,
        1.,
    ]
}

/// `matrix` when the node carries one, otherwise translation · rotation · scale, as glTF defines it.
fn local_matrix(node: &Value) -> Result<Mat4> {
    if let Some(values) = numbers(node.get("matrix"), 16, "matrix")? {
        let mut matrix = IDENTITY;
        matrix.copy_from_slice(&values);
        return Ok(matrix);
    }
    let t = numbers(node.get("translation"), 3, "translation")?.unwrap_or(vec![0., 0., 0.]);
    let r = numbers(node.get("rotation"), 4, "rotation")?.unwrap_or(vec![0., 0., 0., 1.]);
    let s = numbers(node.get("scale"), 3, "scale")?.unwrap_or(vec![1., 1., 1.]);
    let mut matrix = rotation_matrix([r[0], r[1], r[2], r[3]]);
    for column in 0..3 {
        for row in 0..3 {
            matrix[column * 4 + row] *= s[column];
        }
    }
    matrix[12] = t[0];
    matrix[13] = t[1];
    matrix[14] = t[2];
    Ok(matrix)
}

/// World transform of every node, by node index. A node glTF never reaches keeps the identity, and
/// nothing reads it: only the nodes a scene names carry a mesh the compiler selected.
pub(super) fn world_matrices(g: &Value) -> Result<Vec<Mat4>> {
    let nodes = values(g, "nodes")?;
    let mut world = vec![IDENTITY; nodes.len()];
    let mut is_child = vec![false; nodes.len()];
    for node in nodes {
        for child in node
            .get("children")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            let id = required_index(Some(child), "node.children")?;
            if id >= nodes.len() {
                return Err(invalid("node.children index is out of bounds"));
            }
            if is_child[id] {
                return Err(invalid("A node is the child of two parents"));
            }
            is_child[id] = true;
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
        let matrix = multiply(&parent, &local_matrix(&nodes[id])?);
        world[id] = matrix;
        for child in nodes[id]
            .get("children")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            stack.push((
                required_index(Some(child), "node.children")?,
                matrix,
                depth + 1,
            ));
        }
    }
    Ok(world)
}

/// Cofactor of the linear part applied to a direction: `cof(A)·n` is `det(A) · A⁻ᵀn`, so it points
/// the transformed plane normal without ever dividing, and its length is the factor an area of that
/// plane is multiplied by.
pub(super) fn cofactor_direction(matrix: &Mat4, normal: [f64; 3]) -> [f64; 3] {
    let column = |c: usize| [matrix[c * 4], matrix[c * 4 + 1], matrix[c * 4 + 2]];
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let (a0, a1, a2) = (column(0), column(1), column(2));
    let (c0, c1, c2) = (cross(a1, a2), cross(a2, a0), cross(a0, a1));
    [
        normal[0] * c0[0] + normal[1] * c1[0] + normal[2] * c2[0],
        normal[0] * c0[1] + normal[1] * c1[1] + normal[2] * c2[1],
        normal[0] * c0[2] + normal[1] * c1[2] + normal[2] * c2[2],
    ]
}

pub(super) fn transform_point(matrix: &Mat4, point: [f64; 3]) -> [f64; 3] {
    let mut out = [0.0f64; 3];
    for row in 0..3 {
        out[row] = matrix[row] * point[0]
            + matrix[4 + row] * point[1]
            + matrix[8 + row] * point[2]
            + matrix[12 + row];
    }
    out
}
