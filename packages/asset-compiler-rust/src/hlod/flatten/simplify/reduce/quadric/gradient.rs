//! A value's linear gradient across a triangle: the `g` and `d` with `g · pᵢ + d = aᵢ` at the three
//! corners and `g · n = 0` along the normal, the 4×4 system `[p₀ 1; p₁ 1; p₂ 1; n 0]` solved by
//! cofactors. `matrix` inverts the system once for the triangle, `apply` reads one value's
//! gradient off it; the minors are named by their rows (`p0`, `p1`, `p2`, `n`) and their columns
//! (`x`, `y`, `z`, and `w`, one for a corner and zero for the normal).
use super::SINGULAR;

type V3 = [f64; 3];

/// The cofactors of the triangle's system over its determinant, column by column of the corners
/// they weigh; `None` when the determinant is under `SINGULAR`.
pub(super) fn matrix([p0, p1, p2]: [V3; 3], n: V3) -> Option<[f64; 12]> {
    // The 2×2 minors of the first two corners' rows.
    let p01_xy = p0[0] * p1[1] - p0[1] * p1[0];
    let p01_xz = p0[0] * p1[2] - p0[2] * p1[0];
    let p01_xw = p0[0] - p1[0];
    let p01_yz = p0[1] * p1[2] - p0[2] * p1[1];
    let p01_yw = p0[1] - p1[1];
    let p01_zw = p0[2] - p1[2];

    // The 3×3 minors of the three corners' rows, and the determinant along the normal's row.
    let p201_xyw = p2[0] * p01_yw - p2[1] * p01_xw + p01_xy;
    let p201_xzw = p2[0] * p01_zw - p2[2] * p01_xw + p01_xz;
    let p201_yzw = p2[1] * p01_zw - p2[2] * p01_yw + p01_yz;
    let det = -p201_yzw * n[0] + p201_xzw * n[1] - p201_xyw * n[2];
    if det.abs() < SINGULAR {
        return None;
    }
    let inverse = 1.0 / det;

    // The 2×2 minors of one corner's row and the normal's; the normal's `w` is zero, so a minor
    // over a `w` column is the normal's other entry, negated.
    let p0n_xy = p0[0] * n[1] - p0[1] * n[0];
    let p0n_xz = p0[0] * n[2] - p0[2] * n[0];
    let p0n_yz = p0[1] * n[2] - p0[2] * n[1];
    let p1n_xy = p1[0] * n[1] - p1[1] * n[0];
    let p1n_xz = p1[0] * n[2] - p1[2] * n[0];
    let p1n_yz = p1[1] * n[2] - p1[2] * n[1];
    let [n_xw, n_yw, n_zw] = n.map(|x| -x);

    // The 3×3 minors with the third corner's row, and those of the normal with the first two.
    let p20n_xyz = p2[0] * p0n_yz - p2[1] * p0n_xz + p2[2] * p0n_xy;
    let p20n_xyw = p2[0] * n_yw - p2[1] * n_xw + p0n_xy;
    let p20n_xzw = p2[0] * n_zw - p2[2] * n_xw + p0n_xz;
    let p20n_yzw = p2[1] * n_zw - p2[2] * n_yw + p0n_yz;
    let p21n_xyz = p2[0] * p1n_yz - p2[1] * p1n_xz + p2[2] * p1n_xy;
    let p21n_xyw = p2[0] * n_yw - p2[1] * n_xw + p1n_xy;
    let p21n_xzw = p2[0] * n_zw - p2[2] * n_xw + p1n_xz;
    let p21n_yzw = p2[1] * n_zw - p2[2] * n_yw + p1n_yz;
    let np01_xyz = n[0] * p01_yz - n[1] * p01_xz + n[2] * p01_xy;
    let np01_xyw = n[0] * p01_yw - n[1] * p01_xw;
    let np01_xzw = n[0] * p01_zw - n[2] * p01_xw;
    let np01_yzw = n[1] * p01_zw - n[2] * p01_yw;

    let minors = [
        p21n_yzw, p21n_xzw, p21n_xyw, p21n_xyz, // the first corner's value
        p20n_yzw, p20n_xzw, p20n_xyw, p20n_xyz, // the second's
        np01_yzw, np01_xzw, np01_xyw, np01_xyz, // the third's
    ];
    Some(minors.map(|minor| minor * inverse))
}

/// The gradient `[gx, gy, gz]` and offset `d` of the values `a` at the corners, read off `m`.
pub(super) fn apply(m: &[f64; 12], a: [f32; 3]) -> [f64; 4] {
    let [a0, a1, a2] = a.map(f64::from);
    [
        -m[0] * a0 + m[4] * a1 + m[8] * a2,
        m[1] * a0 - m[5] * a1 - m[9] * a2,
        -m[2] * a0 + m[6] * a1 + m[10] * a2,
        m[3] * a0 - m[7] * a1 - m[11] * a2,
    ]
}
