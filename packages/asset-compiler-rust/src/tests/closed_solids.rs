//! Closed solids the generated scenes are built of: a box, four vertices a face with the face's
//! normal, as an exporter writes them, and an octagonal log with smooth sides and flat caps. Built
//! with additions, multiplications, divisions and square roots alone, the same bytes on every
//! platform.
use super::scene_document::Surface;

type Point = [f64; 3];

/// The point whose coordinate on axis `a` is `coordinate(a)`.
fn point(coordinate: impl Fn(usize) -> f64) -> Point {
    std::array::from_fn(coordinate)
}

/// A rotation about x by the angle whose cosine and sine are `(cos, sin)`.
fn turn_x([x, y, z]: Point, (cos, sin): (f64, f64)) -> Point {
    [x, y * cos - z * sin, y * sin + z * cos]
}

/// The closed box of `size` turned about x by `(cos, sin)`, then centred on `centre`: four
/// vertices a face, each with the face's normal.
pub(crate) fn block(size: Point, centre: Point, turn: (f64, f64)) -> Surface {
    let mut out = Surface::default();
    for axis in 0..3 {
        let u = (axis + 1) % 3;
        for sign in [1.0, -1.0] {
            // (u, v) turns counter-clockwise seen from +axis; the face on -axis runs it backward.
            let mut corners = [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)];
            if sign < 0.0 {
                corners.reverse();
            }
            let normal = turn_x(point(|a| if a == axis { sign } else { 0.0 }), turn);
            out.quad(corners.map(|(cu, cv)| {
                let local = point(|a| {
                    let along = if a == axis {
                        sign
                    } else if a == u {
                        cu
                    } else {
                        cv
                    };
                    along * size[a] / 2.0
                });
                let turned = turn_x(local, turn);
                (point(|a| centre[a] + turned[a]), normal)
            }));
        }
    }
    out
}

/// The closed box from `min` to `max`.
pub(crate) fn slab(min: Point, max: Point) -> Surface {
    block(
        point(|a| max[a] - min[a]),
        point(|a| (min[a] + max[a]) / 2.0),
        (1.0, 0.0),
    )
}

/// A closed octagonal log along `axis` from `start` over `length`, `radius` wide and `segments`
/// quads long: smooth sides, flat caps.
pub(crate) fn log(axis: usize, start: Point, length: f64, radius: f64, segments: usize) -> Surface {
    let s = std::f64::consts::FRAC_1_SQRT_2;
    // Turning from u toward v: counter-clockwise seen from the axis's positive end.
    let ring = [
        (1.0, 0.0),
        (s, s),
        (0.0, 1.0),
        (-s, s),
        (-1.0, 0.0),
        (-s, -s),
        (0.0, -1.0),
        (s, -s),
    ];
    let [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
    let radial = |(cu, cv): (f64, f64)| {
        point(|a| {
            if a == u {
                cu
            } else if a == v {
                cv
            } else {
                0.0
            }
        })
    };
    let at = |along: f64, r: (f64, f64)| {
        let normal = radial(r);
        point(|a| start[a] + if a == axis { along } else { normal[a] * radius })
    };
    let mut out = Surface::default();
    let step = length / segments as f64;
    for segment in 0..segments {
        let (t0, t1) = (segment as f64 * step, (segment + 1) as f64 * step);
        for k in 0..ring.len() {
            let (r0, r1) = (ring[k], ring[(k + 1) % ring.len()]);
            let side = |t: f64, r: (f64, f64)| (at(t, r), radial(r));
            out.quad([side(t0, r0), side(t0, r1), side(t1, r1), side(t1, r0)]);
        }
    }
    // Each cap, a fan of three quads, turned to face out of its end.
    for (along, sign) in [(0.0, -1.0), (length, 1.0)] {
        let normal = point(|a| if a == axis { sign } else { 0.0 });
        for k in (1..ring.len() - 1).step_by(2) {
            let mut fan =
                [ring[0], ring[k], ring[k + 1], ring[k + 2]].map(|r| (at(along, r), normal));
            if sign < 0.0 {
                fan.reverse();
            }
            out.quad(fan);
        }
    }
    out
}
