//! The frames an exponential map is drawn in, each an origin and a turn — a unit quaternion
//! `(x, y, z, w)` — its axes read off the turn, built and turned by the map's rules:
//!
//! - a vertex's own frame (`Frame::along`): the least turn of `+z` onto its normal;
//! - a seed's frame (`Frame::at_vertex`): its normal, the edge it met first laid across it, the
//!   turn taken from those three axes as they stand (`from_columns`), then, on an island mapped off
//!   its boundary, turned about its normal so that the axis nearest the world's first horizontal
//!   axis lies along it — or along the second, where the normal leans within `ALIGN_TOLERANCE` of
//!   the first (`Frame::aligned`). The map is drawn in a `z`-up mesh's axes (`Submesh::point`),
//!   so the world's horizontal axes are its `x` and `y` — the scene's `x` and `z`;
//! - the propagation (`propagate`): a point placed in a neighbour's frame, turned by the angle
//!   between that frame's first axis and the seed frame's turned onto the neighbour's normal.
use crate::hlod::flatten::mesh::plane_angle;
use trillion3d_math::vector::vec3::{cross, unit_or_itself, unit_where};
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// A unit quaternion `(x, y, z, w)`.
type Turn = [f64; 4];

/// The world's horizontal axes a seed's frame is aligned to: the first, and the one taken where the
/// normal leans within `ALIGN_TOLERANCE` of it.
const HORIZONTAL: [f64; 3] = [1.0, 0.0, 0.0];
const FALLBACK: [f64; 3] = [0.0, 1.0, 0.0];

/// The cosine past which a normal leans too close to `HORIZONTAL` to align a frame to it.
const ALIGN_TOLERANCE: f64 = 0.95;

/// The length under which a sum of two unit vectors has no direction.
const TOLERANCE: f64 = 1e-8;

/// `q` made unit — each part times the inverse of its length —, none when it has no length.
fn unit_turn(q: Turn) -> Option<Turn> {
    let length = dot(q, q).sqrt();
    (length > 0.0).then(|| {
        let inverse = 1.0 / length;
        q.map(|part| part * inverse)
    })
}

/// The turn `a` after `b`: their product `a · b`.
fn product([ax, ay, az, aw]: Turn, [bx, by, bz, bw]: Turn) -> Turn {
    [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by + ay * bw + az * bx - ax * bz,
        aw * bz + az * bw + ax * by - ay * bx,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

/// The least turn of `from` onto `to`, both made unit: by their bisector; half a turn about an axis
/// across `from` when they are opposite.
fn from_to(from: [f64; 3], to: [f64; 3]) -> Turn {
    let (from, to) = (unit_or_itself(from), unit_or_itself(to));
    let bisector = unit_where(add(from, to), |length| length > TOLERANCE).unwrap_or([0.0; 3]);
    let w = dot(from, bisector);
    let [x, y, z] = if w != 0.0 {
        cross(from, bisector)
    } else if from[0].abs() >= from[1].abs() {
        let inverse = 1.0 / (from[0] * from[0] + from[2] * from[2]).sqrt();
        [-from[2] * inverse, 0.0, from[0] * inverse]
    } else {
        let inverse = 1.0 / (from[1] * from[1] + from[2] * from[2]).sqrt();
        [0.0, from[2] * inverse, -from[1] * inverse]
    };
    unit_turn([x, y, z, w]).unwrap_or([0.0; 4])
}

/// The turn of `degrees` about unit `axis`.
fn about(axis: [f64; 3], degrees: f64) -> Turn {
    let half = 0.5 * degrees.to_radians();
    let sin = half.sin();
    [sin * axis[0], sin * axis[1], sin * axis[2], half.cos()]
}

/// The turn of the matrix whose columns are `columns`, unit or not, made unit: from the trace when
/// positive, else from the largest diagonal entry, the later of equals passed over.
fn from_columns(columns: [[f64; 3]; 3]) -> Turn {
    let m = |row: usize, column: usize| columns[column][row];
    let trace = m(0, 0) + m(1, 1) + m(2, 2);
    let q = if trace > 0.0 {
        let root = (trace + 1.0).sqrt();
        let inverse = 0.5 / root;
        [
            (m(2, 1) - m(1, 2)) * inverse,
            (m(0, 2) - m(2, 0)) * inverse,
            (m(1, 0) - m(0, 1)) * inverse,
            0.5 * root,
        ]
    } else {
        let mut i = usize::from(m(1, 1) > m(0, 0));
        if m(2, 2) > m(i, i) {
            i = 2;
        }
        let (j, k) = ((i + 1) % 3, (i + 2) % 3);
        let root = (m(i, i) - m(j, j) - m(k, k) + 1.0).sqrt();
        let inverse = 0.5 / root;
        let mut q = [0.0; 4];
        q[i] = 0.5 * root;
        q[3] = (m(k, j) - m(j, k)) * inverse;
        q[j] = (m(j, i) + m(i, j)) * inverse;
        q[k] = (m(k, i) + m(i, k)) * inverse;
        q
    };
    unit_turn(q).unwrap_or([0.0; 4])
}

/// A frame on the surface: its origin, its turn and the three axes it gives, `z` its normal.
#[derive(Clone, Copy)]
pub(super) struct Frame {
    pub(super) origin: [f64; 3],
    turn: Turn,
    pub(super) x: [f64; 3],
    pub(super) y: [f64; 3],
    pub(super) z: [f64; 3],
}

impl Frame {
    /// The frame at `origin` of turn `turn`, its axes the turned `+x`, `+y` and `+z`.
    fn turned_by(origin: [f64; 3], turn: Turn) -> Self {
        let [x, y, z, w] = turn;
        let [tx, ty, tz] = [2.0 * x, 2.0 * y, 2.0 * z];
        let (wx, wy, wz) = (tx * w, ty * w, tz * w);
        let (xx, xy, xz) = (tx * x, ty * x, tz * x);
        let (yy, yz, zz) = (ty * y, tz * y, tz * z);
        Self {
            origin,
            turn,
            x: [1.0 - (yy + zz), xy + wz, xz - wy],
            y: [xy - wz, 1.0 - (xx + zz), yz + wx],
            z: [xz + wy, yz - wx, 1.0 - (xx + yy)],
        }
    }

    /// The frame at `origin` along `normal`: the least turn of `+z` onto it.
    pub(super) fn along(origin: [f64; 3], normal: [f64; 3]) -> Self {
        Self::turned_by(origin, from_to([0.0, 0.0, 1.0], normal))
    }

    /// A seed's frame at `origin` of `normal` (module doc): its first axis the edge towards
    /// `towards` laid across the normal, its second the normal across that edge, neither made unit,
    /// the turn of those three axes made unit.
    pub(super) fn at_vertex(origin: [f64; 3], normal: [f64; 3], towards: [f64; 3]) -> Self {
        let normal = unit_or_itself(normal);
        let edge = unit_or_itself(sub(towards, origin));
        let second = cross(normal, edge);
        let first = cross(second, normal);
        Self::turned_by(origin, from_columns([first, second, normal]))
    }

    /// The frame turned by `turn` after its own, kept as it is when the product has no length.
    pub(super) fn turned(&self, turn: Turn) -> Self {
        unit_turn(product(turn, self.turn)).map_or(*self, |turn| Self::turned_by(self.origin, turn))
    }

    /// The frame turned about its normal so that, of its first two axes, the one nearer the world's
    /// horizontal axis — `HORIZONTAL`, or `FALLBACK` where the normal leans within
    /// `ALIGN_TOLERANCE` of it — lies along that axis or against it, whichever turns it less.
    pub(super) fn aligned(&self) -> Self {
        let normal = self.z;
        let target = match dot(normal, HORIZONTAL).abs() > ALIGN_TOLERANCE {
            true => FALLBACK,
            false => HORIZONTAL,
        };
        let dots = [dot(self.x, target), dot(self.y, target)];
        let axis = if dots[0].abs() > dots[1].abs() { 0 } else { 1 };
        let toward = if dots[axis] < 0.0 {
            scale(target, -1.0)
        } else {
            target
        };
        let degrees = plane_angle([self.x, self.y][axis], toward, normal);
        self.turned(about(normal, degrees))
    }

    /// `p` in the frame's first two axes.
    fn local(&self, p: [f64; 3]) -> [f64; 2] {
        let d = sub(p, self.origin);
        [dot(d, self.x), dot(d, self.y)]
    }
}

/// `position`'s coordinates through a neighbour of coordinates `nbr_uv` and frame `nbr`: its place
/// in that frame, turned by the angle from the frame's first axis to the seed frame's first axis
/// once the seed frame is turned onto the neighbour's normal.
pub(super) fn propagate(
    position: [f64; 3],
    nbr_uv: [f64; 2],
    nbr: &Frame,
    seed: &Frame,
) -> [f64; 2] {
    let local = nbr.local(position);
    let aligned_x = seed.turned(from_to(seed.z, nbr.z)).x;
    let cos = dot(nbr.x, aligned_x);
    let mut sin = (1.0 - cos * cos).max(0.0).sqrt();
    if dot(cross(nbr.x, aligned_x), nbr.z) < 0.0 {
        sin = -sin;
    }
    [
        nbr_uv[0] + cos * local[0] + sin * local[1],
        nbr_uv[1] - sin * local[0] + cos * local[1],
    ]
}
