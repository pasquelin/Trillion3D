//! The plane fitted to a chart's corners, its frame:
//!
//! 1. the least-squares normal (Emil Ernerfeldt's plane from points): the covariance of the points
//!    about their centroid, and the axis whose cofactor determinant is largest solved for the
//!    other two; no plane when that determinant is not positive, the direction shorter than
//!    `EPSILON`, or the normal not of unit length; the frame then `Frame::around` it;
//! 2. failing that, the covariance's eigenvectors (Householder reduction to a tridiagonal matrix,
//!    then the QL algorithm with implicit shifts, at most 32 sweeps per eigenvalue), sorted by
//!    decreasing eigenvalue: tangent, bitangent, normal. No frame when the covariance's diagonal is
//!    zero or the sweeps do not converge.
//!
//! The builder always fits at least two faces' corners, six points.
use super::vector::{is_unit, most, unit, Frame, Vec3, EPSILON};
use trillion3d_math::vector::vecn::{add, length, scale, sub};

pub(super) fn fit_frame(points: &[Vec3]) -> Option<Frame> {
    let m = covariance(points);
    least_squares_normal(m)
        .map(Frame::around)
        .or_else(|| eigen_frame(m))
}

/// The points' centroid, their sum times the reciprocal of their count.
fn centroid(points: &[Vec3]) -> Vec3 {
    let sum = points.iter().fold([0.0f32; 3], |sum, &p| add(sum, p));
    scale(sum, 1.0 / points.len() as f32)
}

/// The covariance `xx, xy, xz, yy, yz, zz` of the points about their centroid, unscaled.
fn covariance(points: &[Vec3]) -> [f32; 6] {
    let centre = centroid(points);
    let mut sums = [0.0f32; 6];
    for &p in points {
        let r = sub(p, centre);
        sums[0] += r[0] * r[0];
        sums[1] += r[0] * r[1];
        sums[2] += r[0] * r[2];
        sums[3] += r[1] * r[1];
        sums[4] += r[1] * r[2];
        sums[5] += r[2] * r[2];
    }
    sums
}

fn least_squares_normal([xx, xy, xz, yy, yz, zz]: [f32; 6]) -> Option<Vec3> {
    let det_x = yy * zz - yz * yz;
    let det_y = xx * zz - xz * xz;
    let det_z = xx * yy - xy * xy;
    let det_max = most(det_x, most(det_y, det_z));
    if det_max <= 0.0 {
        return None;
    }
    let direction = if det_max == det_x {
        [det_x, xz * yz - xy * zz, xy * yz - xz * yy]
    } else if det_max == det_y {
        [xz * yz - xy * zz, det_y, xy * xz - yz * xx]
    } else if det_max == det_z {
        [xy * yz - xz * yy, xy * xz - yz * xx, det_z]
    } else {
        [0.0; 3]
    };
    let len = length(direction);
    if len.abs() <= EPSILON {
        return None;
    }
    let normal = scale(direction, 1.0 / len);
    is_unit(normal).then_some(normal)
}

fn eigen_frame(m: [f32; 6]) -> Option<Frame> {
    if m[0] == 0.0 && m[3] == 0.0 && m[5] == 0.0 {
        return None;
    }
    let mut work = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]];
    let mut diagonal = [0.0f32; 3];
    let mut off = [0.0f32; 3];
    tridiagonal(&mut work, &mut diagonal, &mut off);
    if !ql(&mut work, &mut diagonal, &mut off) {
        return None;
    }
    let mut values = diagonal;
    let mut vectors: [Vec3; 3] = std::array::from_fn(|j| [work[0][j], work[1][j], work[2][j]]);
    if values[2] > values[0] && values[2] > values[1] {
        values.swap(0, 2);
        vectors.swap(0, 2);
    }
    if values[1] > values[0] {
        values.swap(0, 1);
        vectors.swap(0, 1);
    }
    if values[2] > values[1] {
        values.swap(1, 2);
        vectors.swap(1, 2);
    }
    Some(Frame {
        normal: unit(vectors[2]),
        tangent: unit(vectors[0]),
        bitangent: unit(vectors[1]),
    })
}

/// Householder's reduction of the symmetric `mat` to the tridiagonal `diagonal`, `off` (`off[0]`
/// and `off[1]` below the diagonal), `mat` left holding the orthogonal transform.
fn tridiagonal(mat: &mut [[f32; 3]; 3], diagonal: &mut [f32; 3], off: &mut [f32; 3]) {
    let (a, mut b, mut c) = (mat[0][0], mat[0][1], mat[0][2]);
    let (d, e, f) = (mat[1][1], mat[1][2], mat[2][2]);
    diagonal[0] = a;
    off[2] = 0.0;
    if c.abs() >= 1e-08 {
        let ell = (b * b + c * c).sqrt();
        b /= ell;
        c /= ell;
        let q = 2.0 * b * e + c * (f - d);
        diagonal[1] = d + c * q;
        diagonal[2] = f - c * q;
        off[0] = ell;
        off[1] = e - b * q;
        *mat = [[1.0, 0.0, 0.0], [0.0, b, c], [0.0, c, -b]];
    } else {
        diagonal[1] = d;
        diagonal[2] = f;
        off[0] = b;
        off[1] = e;
        *mat = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    }
}

/// The QL algorithm with implicit shifts on the tridiagonal `diagonal`, `off`, accumulating the
/// rotations into `mat`; `false` when an eigenvalue takes more than 32 sweeps.
fn ql(mat: &mut [[f32; 3]; 3], diagonal: &mut [f32; 3], off: &mut [f32; 3]) -> bool {
    const SWEEPS: usize = 32;
    for ell in 0..3 {
        let mut sweep = 0;
        while sweep < SWEEPS {
            let mut m = ell;
            while m <= 1 {
                let dd = diagonal[m].abs() + diagonal[m + 1].abs();
                if off[m].abs() + dd == dd {
                    break;
                }
                m += 1;
            }
            if m == ell {
                break;
            }
            let mut g = (diagonal[ell + 1] - diagonal[ell]) / (2.0 * off[ell]);
            let mut r = (g * g + 1.0).sqrt();
            g = if g < 0.0 {
                diagonal[m] - diagonal[ell] + off[ell] / (g - r)
            } else {
                diagonal[m] - diagonal[ell] + off[ell] / (g + r)
            };
            let (mut s, mut c, mut p) = (1.0f32, 1.0f32, 0.0f32);
            for i in (ell..m).rev() {
                let mut f = s * off[i];
                let b = c * off[i];
                if f.abs() >= g.abs() {
                    c = g / f;
                    r = (c * c + 1.0).sqrt();
                    off[i + 1] = f * r;
                    s = 1.0 / r;
                    c *= s;
                } else {
                    s = f / g;
                    r = (s * s + 1.0).sqrt();
                    off[i + 1] = g * r;
                    c = 1.0 / r;
                    s *= c;
                }
                g = diagonal[i + 1] - p;
                r = (diagonal[i] - g) * s + 2.0 * b * c;
                p = s * r;
                diagonal[i + 1] = g + p;
                g = c * r - b;
                for row in mat.iter_mut() {
                    f = row[i + 1];
                    row[i + 1] = s * row[i] + c * f;
                    row[i] = c * row[i] - s * f;
                }
            }
            diagonal[ell] -= p;
            off[ell] = g;
            off[m] = 0.0;
            sweep += 1;
        }
        if sweep == SWEEPS {
            return false;
        }
    }
    true
}
