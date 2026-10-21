use super::*;

/// The world plane of a local one, and the factor its areas are multiplied by.
pub fn world_plane(
    matrix: &crate::compiler::source::node_transform::Mat4,
    plane: &plane::ClusterPlane,
) -> Option<([f64; 3], f64, f64)> {
    let direction = trillion3d_math::matrix::linear::cofactor_direction(matrix, plane.normal);
    let scale = trillion3d_math::vector::vecn::length(direction);
    if !matches!(scale.partial_cmp(&0.0), Some(std::cmp::Ordering::Greater)) {
        return None;
    }
    let unit = [
        direction[0] / scale,
        direction[1] / scale,
        direction[2] / scale,
    ];
    let point = trillion3d_math::matrix::transform_point(
        matrix,
        [
            plane.normal[0] * plane.offset,
            plane.normal[1] * plane.offset,
            plane.normal[2] * plane.offset,
        ],
    );
    let (normal, offset) = plane::canonical(unit, trillion3d_math::vector::vecn::dot(unit, point));
    Some((normal, offset, scale))
}

/// World box of one cluster: its local box carried through the instance (`box_transform`).
pub fn extend_box(
    surface: &mut Surface,
    page: &Value,
    matrix: &crate::compiler::source::node_transform::Mat4,
) {
    let side = |field: &str| [0, 1, 2].map(|axis| page[field][axis].as_f64());
    let ([Some(x0), Some(y0), Some(z0)], [Some(x1), Some(y1), Some(z1)]) =
        (side("min"), side("max"))
    else {
        return;
    };
    let mut placed = [0.0f64; trillion3d_math::geometry::box_transform::BOX_VALUES];
    trillion3d_math::geometry::box_transform::box_transform(
        &mut placed,
        &[x0, y0, z0, x1, y1, z1],
        matrix,
    );
    let (low, high) = (
        [placed[0], placed[1], placed[2]],
        [placed[3], placed[4], placed[5]],
    );
    trillion3d_math::geometry::aabb::merge_aabb(&mut surface.low, &mut surface.high, low, high);
}
