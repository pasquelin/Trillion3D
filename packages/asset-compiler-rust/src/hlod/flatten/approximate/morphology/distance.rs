//! Point–segment and point–triangle distances, orientation, the 26 offsets.
use trillion3d_math::vector::vecn::{length, sub};

/// The distance from `x0` to the segment `x1, x2`.
fn point_segment_distance(x0: [f64; 3], x1: [f64; 3], x2: [f64; 3]) -> f64 {
    let dx = sub(x2, x1);
    let m2 = trillion3d_math::vector::vecn::dot(dx, dx);
    let s12 = (trillion3d_math::vector::vecn::dot(dx, sub(x2, x0)) / m2).clamp(0.0, 1.0);
    let closest: [f64; 3] = std::array::from_fn(|k| s12 * x1[k] + (1.0 - s12) * x2[k]);
    length(sub(x0, closest))
}

/// The distance from `x0` to the triangle `x1, x2, x3`: to its plane's foot inside it, else to
/// the nearer of the two edges the barycentric weights point at.
pub(super) fn point_triangle_distance(
    x0: [f64; 3],
    x1: [f64; 3],
    x2: [f64; 3],
    x3: [f64; 3],
) -> f64 {
    use trillion3d_math::vector::vecn::dot;
    let (x13, x23, x03) = (sub(x1, x3), sub(x2, x3), sub(x0, x3));
    let (m13, m23, d) = (dot(x13, x13), dot(x23, x23), dot(x13, x23));
    let invdet = 1.0 / (m13 * m23 - d * d).max(1e-30);
    let (a, b) = (dot(x13, x03), dot(x23, x03));
    let w23 = invdet * (m23 * a - d * b);
    let w31 = invdet * (m13 * b - d * a);
    let w12 = 1.0 - w23 - w31;
    if w23 >= 0.0 && w31 >= 0.0 && w12 >= 0.0 {
        let p: [f64; 3] = std::array::from_fn(|k| w23 * x1[k] + w31 * x2[k] + w12 * x3[k]);
        length(sub(x0, p))
    } else if w23 > 0.0 {
        point_segment_distance(x0, x1, x2).min(point_segment_distance(x0, x1, x3))
    } else if w31 > 0.0 {
        point_segment_distance(x0, x1, x2).min(point_segment_distance(x0, x2, x3))
    } else {
        point_segment_distance(x0, x1, x3).min(point_segment_distance(x0, x2, x3))
    }
}

/// The sign of twice the signed area of
/// `(0,0), (x1,y1), (x2,y2)`, ties broken by simulation of simplicity, and the area.
fn orientation(x1: f64, y1: f64, x2: f64, y2: f64) -> (i32, f64) {
    let area = y1 * x2 - x1 * y2;
    let sign = if area > 0.0 {
        1
    } else if area < 0.0 {
        -1
    } else if y2 > y1 {
        1
    } else if y2 < y1 {
        -1
    } else if x1 > x2 {
        1
    } else if x1 < x2 {
        -1
    } else {
        0
    };
    (sign, area)
}

/// Whether `(x0, y0)` lies in the triangle, and its barycentric weights: the three orientations
/// agree, so a point on a shared edge counts in exactly one of its triangles.
pub(super) fn point_in_triangle_2d(x0: f64, y0: f64, t: [[f64; 2]; 3]) -> Option<[f64; 3]> {
    let [[x1, y1], [x2, y2], [x3, y3]] = t.map(|[x, y]| [x - x0, y - y0]);
    let (sa, a) = orientation(x2, y2, x3, y3);
    if sa == 0 {
        return None;
    }
    let (sb, b) = orientation(x3, y3, x1, y1);
    if sb != sa {
        return None;
    }
    let (sc, c) = orientation(x1, y1, x2, y2);
    if sc != sa {
        return None;
    }
    let sum = a + b + c;
    Some([a / sum, b / sum, c / sum])
}

/// The 26 neighbours of a node, `x` fastest, then `y`, then `z`, the node itself left out.
pub(super) const OFFSETS26: [[i32; 3]; 26] = {
    let mut out = [[0; 3]; 26];
    let (mut n, mut at) = (0, 0);
    while n < 27 {
        if n != 13 {
            out[at] = [n % 3 - 1, n / 3 % 3 - 1, n / 9 - 1];
            at += 1;
        }
        n += 1;
    }
    out
};
