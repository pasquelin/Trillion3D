//! The algebra of the per-face signal tensor: the symmetric 2×2 matrix `[m0 m1; m1 m2]`, stored
//! as its three distinct entries, that says how fast the signal changes along each direction of
//! a face's canonical frame, integrated over the face.
//!
//! - `tensor_on_face`: the tensor integrated over a face of the given area;
//! - `plane_gradients`: the partial derivatives along the plane's two axes of a quantity known at
//!   a triangle's three corners, from the triangle's plane corners and area;
//! - `affine_tensor`: a face's tensor carried from its canonical corners to new plane corners,
//!   with the geometric tensor of the map when asked;
//! - `l2_lower_bound`: the least signal stretch an affine map of a face can reach while its
//!   geometric distortion stays under a bound, and the map that reaches it.
use super::{near_zero, near_zero2, root};
use trillion3d_math::vector::vecn::dot;

/// The tensor `mt` integrated over a face of area `area`.
pub(crate) fn tensor_on_face(mt: &[f32; 3], area: f32) -> [f32; 3] {
    mt.map(|m| m * area)
}

/// The derivatives along the plane's x and y axes of the quantity `q`, known at the corners `v`
/// of a triangle of area `area`. A triangle of no area gives zero derivatives when `q` is the same
/// at its three corners, else the largest float.
pub(crate) fn plane_gradients<const N: usize>(
    area: f32,
    v: [[f32; 2]; 3],
    q: [[f32; N]; 3],
) -> ([f32; N], [f32; N]) {
    let mut ss = [0.0; N];
    let mut st = [0.0; N];
    for i in 0..N {
        let (q0, q1, q2) = (q[0][i], q[1][i], q[2][i]);
        if !near_zero2(area) {
            ss[i] =
                (q0 * (v[1][1] - v[2][1]) + q1 * (v[2][1] - v[0][1]) + q2 * (v[0][1] - v[1][1]))
                    / (area * 2.0);
            st[i] =
                (q0 * (v[2][0] - v[1][0]) + q1 * (v[0][0] - v[2][0]) + q2 * (v[1][0] - v[0][0]))
                    / (area * 2.0);
        } else if q0 == q1 && q0 == q2 {
            ss[i] = 0.0;
            st[i] = 0.0;
        } else {
            ss[i] = f32::MAX;
            st[i] = f32::MAX;
        }
    }
    (ss, st)
}

/// The tensor `old_tensor` of a face whose corners were `old_uv`, carried to the corners `new_uv`
/// of area `new_area`, and the geometric tensor of that map `[Ss·Ss, Ss·St, St·St]`. A new
/// triangle of no area gives the largest float everywhere and no geometric tensor.
pub(crate) fn affine_tensor(
    new_area: f32,
    new_uv: [[f32; 2]; 3],
    old_uv: [[f32; 2]; 3],
    old_tensor: &[f32; 3],
) -> ([f32; 3], Option<[f32; 3]>) {
    if near_zero2(new_area) {
        return ([f32::MAX; 3], None);
    }
    let (ss, st) = plane_gradients(new_area, new_uv, old_uv);
    let geometric = [dot(ss, ss), dot(ss, st), dot(st, st)];
    let m = old_tensor;
    let tensor = [
        ss[0] * ss[0] * m[0] + ss[1] * ss[1] * m[2] + 2.0 * ss[0] * ss[1] * m[1],
        ss[0] * st[0] * m[0] + ss[1] * st[1] * m[2] + (ss[0] * st[1] + ss[1] * st[0]) * m[1],
        st[0] * st[0] * m[0] + st[1] * st[1] * m[2] + 2.0 * st[0] * st[1] * m[1],
    ];
    (tensor, Some(geometric))
}

/// The least signal stretch of a face of area `area` and tensor `mt`, its geometric distortion
/// held under `max_rate`, and the 2×2 map, row by row, that reaches it from the canonical frame.
/// No tensor gives the area and the identity.
///
/// The tensor's eigenvalues `d1 ≥ d2` and eigenvectors are solved in closed form; the map scales
/// along the eigenvectors by `(d2/d1)^¼`, held at least `1/max_rate`, and its inverse is the map
/// returned. A tensor of no eigenvalue, an eigenvector of no length or a map of no determinant
/// gives no stretch and the identity.
pub(crate) fn l2_lower_bound(mt: Option<&[f32; 3]>, area: f32, max_rate: f32) -> (f32, [f32; 4]) {
    let identity = [1.0, 0.0, 0.0, 1.0];
    let Some(mt) = mt else {
        return (area, identity);
    };
    let imt = tensor_on_face(mt, area);
    let b = imt[0] + imt[2];
    let c = imt[0] * imt[2] - imt[1] * imt[1];
    let root_disc = root(b * b - 4.0 * c);
    let d1 = (b + root_disc) / 2.0;
    let d2 = (b - root_disc) / 2.0;
    if near_zero(d1) && near_zero(d2) {
        return (0.0, identity);
    }
    let eigenvector = |d: f32| {
        let (a00, a01, a10, a11) = (imt[0] - d, imt[1], imt[1], imt[2] - d);
        let delta1 = root(a01 * a01 + a00 * a00);
        let delta2 = root(a11 * a11 + a10 * a10);
        if near_zero2(delta1) && near_zero2(delta2) {
            None
        } else if delta1 >= delta2 {
            Some([a01 / delta1, -a00 / delta1])
        } else {
            Some([a11 / delta2, -a10 / delta2])
        }
    };
    let Some(v1) = eigenvector(d1) else {
        return (0.0, identity);
    };
    let Some(v2) = eigenvector(d2) else {
        return (0.0, identity);
    };
    let m0 = v1[0] * v1[0] * d1 + v2[0] * v2[0] * d2;
    let m1 = v1[0] * v1[1] * d1 + v2[0] * v2[1] * d2;
    let m2 = v1[1] * v1[1] * d1 + v2[1] * v2[1] * d2;
    let mut d = root(root(d2 / d1));
    if d < 1.0 / max_rate {
        d = 1.0 / max_rate;
    }
    let a0 = v1[0] * v1[0] * d + v2[0] * v2[0] / d;
    let a3 = v1[1] * v1[1] * d + v2[1] * v2[1] / d;
    let a1 = v1[0] * v1[1] * d + v2[0] * v2[1] / d;
    let a2 = a1;
    let delta = a3 * a0 - a1 * a2;
    if near_zero2(delta) {
        return (0.0, identity);
    }
    let map = [a3 / delta, -a1 / delta, -a2 / delta, a0 / delta];
    let stretch =
        ((a0 * a0 + a2 * a2) * m0 + 2.0 * (a0 * a1 + a2 * a3) * m1 + (a1 * a1 + a3 * a3) * m2)
            / 2.0;
    (stretch, map)
}
