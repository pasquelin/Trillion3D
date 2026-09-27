//! The Voronoi cut of a convex solid: each seed's cell, the points nearer it than any other seed,
//! inside the solid its closed mesh's face planes bound. The cells of seeds inside a convex solid
//! tile it: their union is the solid and no two share more than a face. Each cell is a box clipped
//! half-space by half-space, by its bisectors then by the solid's planes; a point where an edge
//! crosses a plane is computed from the edge's two ends in one order, so the two faces sharing the
//! edge meet at the same bits, and each cut is capped along the edges no touched face walks back:
//! every cell comes out a closed mesh.
use crate::shared_math::{cross, divide, dot, length, point, scale, sub};
use rayon::prelude::*;
use std::collections::{BTreeMap, HashMap, HashSet};

type Point = [f64; 3];
/// A convex polytope: its faces, each a polygon wound as the solid's faces are.
type Faces = Vec<Vec<Point>>;
/// A half-space `dot(normal, p) <= offset`, its normal of unit length.
pub(super) type Plane = (Point, f64);

fn key(p: &Point) -> [u64; 3] {
    p.map(f64::to_bits)
}

/// Where edge `ab` crosses the plane at signed distances `da`, `db`: from the lower end by bits,
/// whichever face walks the edge.
fn crossing(a: Point, b: Point, da: f64, db: f64) -> Point {
    let ((p, dp), (q, dq)) = if key(&a) < key(&b) {
        ((a, da), (b, db))
    } else {
        ((b, db), (a, da))
    };
    let t = dp / (dp - dq);
    [0, 1, 2].map(|k| p[k] + (q[k] - p[k]) * t)
}

/// `faces` less what lies beyond `plane`, closed by a cap on it. A corner within `eps` of the
/// plane is on it: kept, never crossed. A face wholly inside is moved as it is; one the plane
/// touches keeps its part inside unless that part lies on the plane; the cap runs back along
/// every edge on the plane that no touched face walks back.
pub(super) fn clip(faces: Faces, (normal, offset): Plane, eps: f64) -> Faces {
    let distance = |p: &Point| dot(normal, *p) - offset;
    let side = |p: &Point| (distance(p) > eps) as i8 - (distance(p) < -eps) as i8;
    if !faces.iter().flatten().any(|p| side(p) > 0) {
        return faces;
    }
    if !faces.iter().flatten().any(|p| side(p) < 0) {
        return Vec::new();
    }
    let (mut kept, mut touched) = (Vec::with_capacity(faces.len() + 1), Vec::new());
    for face in faces {
        if face.iter().all(|p| side(p) < 0) {
            kept.push(face);
            continue;
        }
        let (mut polygon, mut on) = (Vec::new(), Vec::new());
        for (k, &a) in face.iter().enumerate() {
            let b = face[(k + 1) % face.len()];
            if side(&a) <= 0 {
                polygon.push(a);
                on.push(side(&a) == 0);
            }
            if side(&a) * side(&b) < 0 {
                polygon.push(crossing(a, b, distance(&a), distance(&b)));
                on.push(true);
            }
        }
        if polygon.len() >= 3 && on.contains(&false) {
            touched.push((polygon, on));
        }
    }
    let rims = || {
        touched.iter().flat_map(|(f, on)| {
            let n = f.len();
            (0..n)
                .filter(move |&k| on[k] && on[(k + 1) % n])
                .map(move |k| (f[k], f[(k + 1) % n]))
        })
    };
    let walked: HashSet<_> = rims().map(|(a, b)| (key(&a), key(&b))).collect();
    let cap: BTreeMap<_, _> = rims()
        .filter(|(a, b)| !walked.contains(&(key(b), key(a))))
        .map(|(a, b)| (key(&b), a))
        .collect();
    kept.extend(touched.into_iter().map(|(polygon, _)| polygon));
    if let Some(&first) = cap.values().next() {
        let mut ring = vec![first];
        while let Some(&next) = cap.get(&key(ring.last().unwrap())) {
            if key(&next) == key(&first) || ring.len() > cap.len() {
                break;
            }
            ring.push(next);
        }
        if ring.len() >= 3 {
            kept.push(ring);
        }
    }
    kept
}

/// The box from `low` to `high`, its faces wound outward.
fn cuboid(low: Point, high: Point) -> Faces {
    let corner = |c: usize| [0, 1, 2].map(|a| if c >> a & 1 == 1 { high[a] } else { low[a] });
    [
        [0, 2, 3, 1],
        [4, 5, 7, 6],
        [0, 1, 5, 4],
        [2, 6, 7, 3],
        [0, 4, 6, 2],
        [1, 3, 7, 5],
    ]
    .iter()
    .map(|f| f.iter().map(|&c| corner(c)).collect())
    .collect()
}

/// `faces` as one closed mesh: positions welded by bits, each polygon a fan.
pub(super) fn welded(faces: &[Vec<Point>]) -> (Vec<f32>, Vec<u32>) {
    let (mut index, mut pos, mut triangles) = (HashMap::new(), Vec::new(), Vec::new());
    for face in faces {
        let ids: Vec<u32> = face
            .iter()
            .map(|p| {
                *index.entry(key(p)).or_insert_with(|| {
                    pos.extend(p.map(|v| v as f32));
                    (pos.len() / 3 - 1) as u32
                })
            })
            .collect();
        for k in 1..ids.len() - 1 {
            triangles.extend([ids[0], ids[k], ids[k + 1]]);
        }
    }
    (pos, triangles)
}

/// The half-space of seed `own` against `other`: the points nearer `own`.
fn bisector(own: Point, other: Point) -> Option<Plane> {
    let d = sub(other, own);
    let n = length(d);
    (n > 0.0).then(|| {
        let normal = divide(d, n);
        let middle = [0, 1, 2].map(|k| (own[k] + other[k]) / 2.0);
        (normal, dot(normal, middle))
    })
}

/// The cell of each of `seeds` in the solid `planes` bound inside `bounds`: the box cut by the
/// seed's bisectors first, so each face plane meets a cell a twelfth of the solid, not all of it.
pub(super) fn cells(seeds: &[Point], bounds: (Point, Point), planes: &[Plane]) -> Vec<Faces> {
    let eps = length(sub(bounds.1, bounds.0)) * 1e-7;
    seeds
        .par_iter()
        .map(|&own| {
            let walls = seeds.iter().filter_map(|&other| bisector(own, other));
            (walls.chain(planes.iter().copied()))
                .fold(cuboid(bounds.0, bounds.1), |faces, plane| {
                    clip(faces, plane, eps)
                })
        })
        .collect()
}

/// The outward face planes of the closed mesh `triangles` over `pos`, wound either way.
pub(super) fn face_planes(pos: &[f32], triangles: &[u32]) -> Vec<Plane> {
    let corners: Vec<[Point; 3]> = triangles
        .as_chunks::<3>()
        .0
        .iter()
        .map(|t| t.map(|i| point(pos, i)))
        .collect();
    let signed: f64 = corners.iter().map(|[a, b, c]| dot(*a, cross(*b, *c))).sum();
    let planes = corners.iter().filter_map(|[a, b, c]| {
        let n = scale(cross(sub(*b, *a), sub(*c, *a)), signed.signum());
        let size = length(n);
        (size > 0.0)
            .then(|| divide(n, size))
            .map(|normal| (normal, dot(normal, *a)))
    });
    planes.collect()
}

/// The `planes` of the closed mesh `triangles` over `pos` that no corner of it lies more than
/// `eps` beyond. A sliver's corners, rounded to 32 bits, tilt its plane into the solid it bounds:
/// that plane would cut the solid, while the faces around the sliver bound it already.
pub(super) fn supporting(
    planes: Vec<Plane>,
    pos: &[f32],
    triangles: &[u32],
    eps: f64,
) -> Vec<Plane> {
    let mut used = triangles.to_vec();
    used.sort_unstable();
    used.dedup();
    let corners: Vec<Point> = used.into_iter().map(|i| point(pos, i)).collect();
    planes
        .into_par_iter()
        .filter(|&(n, c)| corners.iter().all(|&p| dot(n, p) - c <= eps))
        .collect()
}
