use super::*;

/// The world plane of a local one, and the factor its areas are multiplied by.
pub fn world_plane(
    matrix: &crate::compiler_world::Mat4,
    plane: &plane::ClusterPlane,
) -> Option<([f64; 3], f64, f64)> {
    let direction = crate::compiler_world::cofactor_direction(matrix, plane.normal);
    let scale = plane::length(direction);
    if !matches!(scale.partial_cmp(&0.0), Some(std::cmp::Ordering::Greater)) {
        return None;
    }
    let unit = [
        direction[0] / scale,
        direction[1] / scale,
        direction[2] / scale,
    ];
    let point = crate::compiler_world::transform_point(
        matrix,
        [
            plane.normal[0] * plane.offset,
            plane.normal[1] * plane.offset,
            plane.normal[2] * plane.offset,
        ],
    );
    let (normal, offset) = plane::canonical(unit, plane::dot(unit, point));
    Some((normal, offset, scale))
}

/// World box of one cluster: the eight corners of its local box carried through the instance.
pub fn extend_box(surface: &mut Surface, page: &Value, matrix: &crate::compiler_world::Mat4) {
    for corner in 0..8 {
        let mut point = [0.0f64; 3];
        for axis in 0..3 {
            let field = if corner & (1 << axis) == 0 {
                "min"
            } else {
                "max"
            };
            match page[field][axis].as_f64() {
                Some(value) => point[axis] = value,
                None => return,
            }
        }
        let placed = crate::compiler_world::transform_point(matrix, point);
        crate::shared_math::extend_aabb(&mut surface.low, &mut surface.high, placed);
    }
}
