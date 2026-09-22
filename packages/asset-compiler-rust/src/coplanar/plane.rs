/// A plane carried by a cluster, in the local frame of its primitive. `area` is the summed triangle
/// area of the cluster, used to decide which of two coplanar surfaces is the thinner overlay.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClusterPlane {
    pub normal: [f64; 3],
    pub offset: f64,
    pub area: f64,
}

use crate::shared_math::{cross, scale};
pub use crate::shared_math::{dot, length};

/// One orientation per plane, whichever way its triangles wind: a surface and the surface facing it
/// hash to the same bucket, which is exactly the pair that fights over a pixel.
pub fn canonical(normal: [f64; 3], offset: f64) -> ([f64; 3], f64) {
    for axis in 0..3 {
        if normal[axis] > SIGN_EPSILON {
            return (normal, offset);
        }
        if normal[axis] < -SIGN_EPSILON {
            return (scale(normal, -1.0), -offset);
        }
    }
    (normal, offset)
}
/// A normal component below this is treated as zero when the canonical sign is picked, so a normal
/// and its opposite never straddle the test because of a rounding bit.
const SIGN_EPSILON: f64 = 1e-9;

/// The plane a set of triangles lies in, or `None` when they do not share one. Every vertex must sit
/// within `tolerance` of the plane and every triangle normal must be parallel to it: a cluster that
/// merely looks flat from far away is not a coplanar surface.
pub fn plane_of_triangles(
    indices: &[u32],
    positions: &[f32],
    tolerance_ratio: f64,
) -> Option<ClusterPlane> {
    let corner = |id: u32| -> Option<[f64; 3]> {
        let base = id as usize * 3;
        positions.get(base + 2).map(|_| {
            [
                positions[base] as f64,
                positions[base + 1] as f64,
                positions[base + 2] as f64,
            ]
        })
    };
    // Bounding box accumulates here without using `shared_math::extend_aabb`: summation order
    // of this function decides coplanar surfaces, and nothing is moved.
    let mut accumulated = [0.0f64; 3];
    let mut area = 0.0f64;
    let mut low = [f64::INFINITY; 3];
    let mut high = [f64::NEG_INFINITY; 3];
    let (triangles, _) = indices.as_chunks::<3>();
    for triangle in triangles {
        let (a, b, c) = (
            corner(triangle[0])?,
            corner(triangle[1])?,
            corner(triangle[2])?,
        );
        for point in [a, b, c] {
            for axis in 0..3 {
                low[axis] = low[axis].min(point[axis]);
                high[axis] = high[axis].max(point[axis]);
            }
        }
        let normal = cross(
            [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
            [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
        );
        let double_area = length(normal);
        if double_area <= 0.0 {
            continue;
        }
        area += double_area * 0.5;
        accumulated = [
            accumulated[0] + normal[0],
            accumulated[1] + normal[1],
            accumulated[2] + normal[2],
        ];
    }
    if area <= 0.0 {
        return None;
    }
    let extent = (0..3).fold(0.0f64, |best, axis| best.max(high[axis] - low[axis]));
    let tolerance = (extent * tolerance_ratio).max(f64::MIN_POSITIVE);
    let accumulated_length = length(accumulated);
    if accumulated_length <= 0.0 {
        return None;
    }
    let normal = scale(accumulated, 1.0 / accumulated_length);
    let mut offset = 0.0f64;
    let mut weight = 0.0f64;
    for triangle in triangles {
        for id in triangle {
            let point = corner(*id)?;
            offset += dot(normal, point);
            weight += 1.0;
        }
    }
    offset /= weight;
    for triangle in triangles {
        let (a, b, c) = (
            corner(triangle[0])?,
            corner(triangle[1])?,
            corner(triangle[2])?,
        );
        for point in [a, b, c] {
            if (dot(normal, point) - offset).abs() > tolerance {
                return None;
            }
        }
        let face = cross(
            [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
            [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
        );
        let face_length = length(face);
        if face_length > 0.0 && dot(face, normal).abs() < face_length * PARALLEL_COSINE {
            return None;
        }
    }
    let (normal, offset) = canonical(normal, offset);
    Some(ClusterPlane {
        normal,
        offset,
        area,
    })
}
/// A triangle normal further from the plane normal than this is not in the plane. One part in a
/// million of the triangle's own length: tighter than float32 rounding on a real surface, looser
/// than the bit noise of the cross product.
const PARALLEL_COSINE: f64 = 1.0 - 1e-6;

/// Two axes of the plane, derived from its normal alone, so every surface of one plane is measured
/// in the same frame whatever order they were read in.
pub fn plane_frame(normal: [f64; 3]) -> ([f64; 3], [f64; 3]) {
    let axis = if normal[0].abs() <= normal[1].abs() && normal[0].abs() <= normal[2].abs() {
        [1.0, 0.0, 0.0]
    } else if normal[1].abs() <= normal[2].abs() {
        [0.0, 1.0, 0.0]
    } else {
        [0.0, 0.0, 1.0]
    };
    let mut u = cross(normal, axis);
    let u_length = length(u);
    if u_length <= 0.0 {
        return ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]);
    }
    u = scale(u, 1.0 / u_length);
    (u, cross(normal, u))
}

/// Hash bucket of a world plane. The normal is quantised in fixed steps and the distance in steps of
/// the scene's own size, so the same surface always lands in the same bucket whatever produced it.
pub fn plane_key(normal: [f64; 3], offset: f64, offset_quantum: f64) -> [i64; 4] {
    let step = |value: f64, quantum: f64| (value / quantum).round() as i64;
    [
        step(normal[0], NORMAL_QUANTUM),
        step(normal[1], NORMAL_QUANTUM),
        step(normal[2], NORMAL_QUANTUM),
        step(offset, offset_quantum),
    ]
}
/// Quantisation step of a unit normal component: 2⁻¹² is finer than any angle a shared surface can
/// disagree on and coarse enough that rounding never splits one plane in two.
pub const NORMAL_QUANTUM: f64 = 1.0 / 4096.0;

/// Whether two world planes are the same plane, checked exactly once the hash brought them together.
pub fn same_plane(a: ([f64; 3], f64), b: ([f64; 3], f64), offset_quantum: f64) -> bool {
    dot(a.0, b.0).abs() >= PARALLEL_COSINE && (a.1 - b.1).abs() <= offset_quantum * 2.0
}
