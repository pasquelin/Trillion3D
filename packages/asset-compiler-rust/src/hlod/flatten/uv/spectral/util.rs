//! The small numeric rules every step of the charts shares, in the library's single precision:
//! what counts as zero, the guarded square roots, triangle areas in the plane, a point's distance
//! to a segment, a face's canonical frame, and the list helpers the partition leans on. The
//! segment crossing test lives in `segment`, the signal tensor's algebra in `tensor`.
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{distance2, dot, sub};

mod segment;
mod tensor;
pub(crate) use crate::hlod::flatten::lists::push_unique;
pub(crate) use segment::segments_cross;
pub(crate) use tensor::{affine_tensor, l2_lower_bound, plane_gradients, tensor_on_face};

/// Values within this of zero are zero.
pub(crate) const ZERO: f32 = 1e-6;
/// The finer zero, for areas and determinants.
pub(crate) const ZERO2: f32 = 1e-12;

/// Whether `a` lies within `ZERO` of zero.
pub(crate) fn near_zero(a: f32) -> bool {
    (-ZERO..=ZERO).contains(&a)
}

/// Whether `a` lies within `ZERO2` of zero.
pub(crate) fn near_zero2(a: f32) -> bool {
    (-ZERO2..=ZERO2).contains(&a)
}

/// The square root of `a`, zero for a negative `a`.
pub(crate) fn root(a: f32) -> f32 {
    if a < 0.0 {
        0.0
    } else {
        a.sqrt()
    }
}

/// The double-precision `root`.
pub(crate) fn root64(a: f64) -> f64 {
    if a < 0.0 {
        0.0
    } else {
        a.sqrt()
    }
}

/// A triangle's signed area in the plane, positive counter-clockwise.
pub(crate) fn signed_area_2d(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f32 {
    ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2.0
}

/// A triangle's area in the plane, unsigned.
pub(crate) fn area_2d(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f32 {
    let area = signed_area_2d(a, b, c);
    if area < 0.0 {
        -area
    } else {
        area
    }
}

/// The squared diagonal of the box from `low` to `high`: the size the bounding boxes are compared
/// by.
pub(crate) fn box_size(low: [f32; 2], high: [f32; 2]) -> f32 {
    distance2(high, low)
}

/// The squared distance from `p` to the segment `a b`, the segment's foot clamped to its ends; a
/// segment shorter than `ZERO` is its first end.
pub(crate) fn segment_distance2(p: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    let along = sub(p, a);
    let normal = sub(b, a);
    let length2 = dot(normal, normal);
    if near_zero(length2) {
        return dot(along, along);
    }
    let t = (dot(along, normal) / length2).clamp(0.0, 1.0);
    let foot = sub([a[0] + normal[0] * t, a[1] + normal[1] * t], p);
    dot(foot, foot)
}

/// The z of the cross product of two plane vectors.
pub(crate) fn cross_z(a: [f32; 2], b: [f32; 2]) -> f32 {
    a[0] * b[1] - a[1] * b[0]
}

/// `p` turned about `center` by the angle of sine `sin` and cosine `cos`.
pub(crate) fn turn(p: [f32; 2], center: [f32; 2], sin: f32, cos: f32) -> [f32; 2] {
    let x = (p[0] - center[0]) * cos - (p[1] - center[1]) * sin;
    let y = (p[0] - center[0]) * sin + (p[1] - center[1]) * cos;
    [x + center[0], y + center[1]]
}

/// The vector of unit length along `a`, the zero vector for a zero `a`, NaN for an infinite length:
/// each axis divided by the length.
pub(crate) fn unit<const N: usize>(a: [f32; N]) -> [f32; N] {
    let length2 = dot(a, a);
    let length = length2.sqrt();
    if length2 == f32::INFINITY {
        [f32::NAN; N]
    } else if length == 0.0 {
        [0.0; N]
    } else {
        a.map(|x| x / length)
    }
}

/// A face's canonical frame: its first corner at the origin, its first edge along the x axis, the
/// third corner above it. The plane coordinates of the three corners and the frame's x and y axes
/// in space; a face whose second and third corners coincide keeps its third corner on the axis.
pub(crate) fn canonical_frame(p: [[f32; 3]; 3]) -> ([[f32; 2]; 3], [[f32; 3]; 2]) {
    let edge1 = sub(p[1], p[0]);
    let edge2 = sub(p[2], p[0]);
    let z = unit(cross(edge1, edge2));
    let x = unit(edge1);
    let y = unit(cross(z, x));
    let third = sub(p[2], p[0]);
    let mut corner2 = [dot(third, x), dot(third, y)];
    if p[1] == p[2] {
        corner2[1] = 0.0;
    }
    ([[0.0, 0.0], [dot(edge1, x), 0.0], corner2], [x, y])
}

/// `uv` through the 2×2 matrix `m`, row by row.
pub(crate) fn transform(uv: [f32; 2], m: &[f32; 4]) -> [f32; 2] {
    [m[0] * uv[0] + m[1] * uv[1], m[2] * uv[0] + m[3] * uv[1]]
}

/// `list` with the entries at `a` and `b` moved to its first two places, when it holds at least
/// three: each moved by one swap, in the order that keeps one already in front.
pub(crate) fn move_two_to_front(list: &mut [u32], a: usize, b: usize) {
    if list.len() < 3 || ((a == 0 || b == 0) && (a == 1 || b == 1)) {
        return;
    }
    if a == 0 {
        list.swap(1, b);
    } else if b == 0 {
        list.swap(1, a);
    } else if a == 1 {
        list.swap(0, b);
    } else if b == 1 {
        list.swap(0, a);
    } else {
        list.swap(0, a);
        list.swap(1, b);
    }
}

/// Every `item` taken out of `list`, the rest in order.
pub(crate) fn remove_all(list: &mut Vec<u32>, item: u32) {
    list.retain(|&x| x != item);
}
