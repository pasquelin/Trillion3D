//! The plane polygons the fill nests, read in floating point as they come, no exact predicate: a
//! polygon's signed area (`signed_area`) and box (`Bounds`), whether a point lies inside it by its
//! winding number (`contains`), whether it holds another — every vertex of the other inside it and
//! no side crossing, once their boxes meet (`holds`) — and whether two overlap — their boxes meet,
//! and a vertex of either lies inside the other or a side crosses (`overlaps`). Each side is a
//! segment by its centre, unit direction and half length (`Segment`): two sides cross when their
//! lines meet within both, sides parallel within `PARALLEL` when their spans along one line
//! overlap, a side of no length when it lies on the other.
// How `c` turns from `a → b` (`turn`, positive on its left) and the perpendicular dot product
// `u.x·v.y − u.y·v.x` (`perp`).
use trillion3d_math::vector::vec2::{cross as perp, double_area as turn};
use trillion3d_math::vector::vecn::{add, distance2, dot, length, scale, sub};

/// A point in the plane.
type Point = [f64; 2];

/// The cross product under which two sides' directions are parallel: double precision's epsilon.
const PARALLEL: f64 = f64::EPSILON;

/// A box: its lowest and highest corners.
#[derive(Clone, Copy)]
pub(super) struct Bounds {
    low: Point,
    high: Point,
}

impl Bounds {
    /// The box of `points`, grown from the empty box — lows at the largest number, highs at its
    /// negation — one point at a time.
    pub(super) fn of(points: &[Point]) -> Self {
        let mut bounds = Self {
            low: [f64::MAX; 2],
            high: [-f64::MAX; 2],
        };
        for &[x, y] in points {
            if x < bounds.low[0] {
                bounds.low[0] = x;
            }
            if x > bounds.high[0] {
                bounds.high[0] = x;
            }
            if y < bounds.low[1] {
                bounds.low[1] = y;
            }
            if y > bounds.high[1] {
                bounds.high[1] = y;
            }
        }
        bounds
    }

    /// Whether box `other` lies within this one, its two corners inside or on it.
    pub(super) fn holds(&self, other: &Bounds) -> bool {
        self.has(other.low) && self.has(other.high)
    }

    /// Whether `[x, y]` lies inside the box or on it.
    fn has(&self, [x, y]: Point) -> bool {
        self.low[0] <= x && self.low[1] <= y && self.high[0] >= x && self.high[1] >= y
    }

    /// Whether box `other` meets this one, touching counted.
    fn meets(&self, other: &Bounds) -> bool {
        !(other.high[0] < self.low[0]
            || other.low[0] > self.high[0]
            || other.high[1] < self.low[1]
            || other.low[1] > self.high[1])
    }
}

/// `polygon`'s signed area: each side's `x₁·y₂ − y₁·x₂` from its start to its end, the closing
/// side first, summed and halved — positive when it turns counterclockwise.
pub(super) fn signed_area(polygon: &[Point]) -> f64 {
    let n = polygon.len();
    let mut area = 0.0;
    for i in 0..n {
        let ([x1, y1], [x2, y2]) = (polygon[(i + n - 1) % n], polygon[i]);
        area += x1 * y2 - y1 * x2;
    }
    area * 0.5
}

/// Whether polygon `outer` holds polygon `inner` (module doc).
pub(super) fn holds(outer: &[Point], inner: &[Point]) -> bool {
    inner.iter().all(|&p| contains(outer, p))
        && !(Bounds::of(outer).meets(&Bounds::of(inner)) && sides_cross(outer, inner))
}

/// Whether polygons `a` and `b` overlap (module doc).
pub(super) fn overlaps(a: &[Point], b: &[Point]) -> bool {
    Bounds::of(a).meets(&Bounds::of(b))
        && (b.iter().any(|&p| contains(a, p))
            || a.iter().any(|&p| contains(b, p))
            || sides_cross(a, b))
}

/// Whether `q` lies inside `polygon`: its winding number about `q` — a side rising across `q`'s
/// height with `q` on its left counted up, one falling across it with `q` on its right counted
/// down — not zero.
fn contains(polygon: &[Point], q: Point) -> bool {
    let mut winding = 0i32;
    let mut a = polygon[polygon.len() - 1];
    for &b in polygon {
        if a[1] <= q[1] {
            if b[1] > q[1] && turn(a, b, q) > 0.0 {
                winding += 1;
            }
        } else if b[1] <= q[1] && turn(a, b, q) < 0.0 {
            winding -= 1;
        }
        a = b;
    }
    winding != 0
}

/// Whether a side of `a` crosses a side of `b`, `a`'s sides in order, each against `b`'s in order.
fn sides_cross(a: &[Point], b: &[Point]) -> bool {
    let others: Vec<Segment> = sides(b).collect();
    sides(a).any(|side| others.iter().any(|other| side.meets(other)))
}

/// `polygon`'s sides, each from a vertex to the next, the last back to the first.
fn sides(polygon: &[Point]) -> impl Iterator<Item = Segment> + '_ {
    let n = polygon.len();
    (0..n).map(move |i| Segment::new(polygon[i], polygon[(i + 1) % n]))
}

/// `v` made unit — times the inverse of its length — and that length; zero and zero when it has
/// none.
fn unit(v: Point) -> (Point, f64) {
    let norm = length(v);
    match norm > 0.0 {
        true => (scale(v, 1.0 / norm), norm),
        false => ([0.0; 2], 0.0),
    }
}

/// A side: its centre, its unit direction — zero for a side of no length — and half its length.
struct Segment {
    centre: Point,
    direction: Point,
    extent: f64,
}

impl Segment {
    /// The side from `from` to `to`.
    fn new(from: Point, to: Point) -> Self {
        let (direction, norm) = unit(sub(to, from));
        Self {
            centre: scale(add(from, to), 0.5),
            direction,
            extent: 0.5 * norm,
        }
    }

    /// The squared distance from `p` to the side: to its nearer end past either, else to the
    /// point of it `p` projects to.
    fn squared_distance(&self, p: Point) -> f64 {
        let t = dot(sub(p, self.centre), self.direction);
        if t >= self.extent {
            distance2(p, add(self.centre, scale(self.direction, self.extent)))
        } else if t <= -self.extent {
            distance2(p, sub(self.centre, scale(self.direction, self.extent)))
        } else {
            distance2(add(self.centre, scale(self.direction, t)), p)
        }
    }

    /// Whether this side and `other` cross (module doc): two points when they coincide, a point
    /// and a side when it lies on it; two sides when their lines meet within both, or, parallel,
    /// when they lie along one line and their spans along it overlap.
    fn meets(&self, other: &Segment) -> bool {
        match (self.extent == 0.0, other.extent == 0.0) {
            (true, true) => return distance2(self.centre, other.centre) <= 0.0,
            (true, false) => return other.squared_distance(self.centre) <= 0.0,
            (false, true) => return self.squared_distance(other.centre) <= 0.0,
            (false, false) => {}
        }
        let offset = sub(other.centre, self.centre);
        let across = perp(self.direction, other.direction);
        if across.abs() > PARALLEL {
            let inverse = 1.0 / across;
            let along_self = perp(offset, other.direction) * inverse;
            let along_other = perp(offset, self.direction) * inverse;
            return along_self.abs() <= self.extent && along_other.abs() <= other.extent;
        }
        if perp(unit(offset).0, other.direction).abs() <= PARALLEL {
            let t = dot(self.direction, offset);
            return !(t - other.extent > self.extent || t + other.extent < -self.extent);
        }
        false
    }
}
