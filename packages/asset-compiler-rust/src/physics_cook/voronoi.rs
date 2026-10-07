//! The Voronoi cut of a convex solid: each seed's cell, the points nearer it than any other seed,
//! inside the face planes of the solid's closed mesh; cells of seeds inside it tile it. Each cell
//! is a box clipped by its bisectors then the solid's planes; an edge's crossing is computed from
//! its two ends in one order, so neighbouring faces meet to the bit, and each cut is capped along
//! the edges no touched face walks back: every cell comes out a closed mesh.
use crate::shared_math::unit;
use rayon::prelude::*;
use std::collections::{BTreeMap, HashMap, HashSet};
use trillion3d_math::vec3::{cross, dot, point, scale, sub};

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
    let (p, q, dp, dq) = if key(&a) < key(&b) {
        (a, b, da, db)
    } else {
        (b, a, db, da)
    };
    let t = dp / (dp - dq);
    [0, 1, 2].map(|k| p[k] + (q[k] - p[k]) * t)
}

/// `faces` less what lies beyond `plane`, closed by a cap on it. A corner within `eps` of the
/// plane is on it: kept, never crossed. A face wholly inside is moved as it is; one the plane
/// touches keeps its part inside unless that part lies on the plane; the cap runs back along
/// every edge on the plane that no touched face walks back.
pub(super) fn clip(faces: Faces, (normal, offset): Plane, eps: f64) -> Faces {
    let side = |d: f64| (d > eps) as i8 - (d < -eps) as i8;
    let distances: Vec<Vec<f64>> = (faces.iter())
        .map(|face| face.iter().map(|p| dot(normal, *p) - offset).collect())
        .collect();
    let sides = || distances.iter().flatten().map(|&d| side(d));
    if !sides().any(|s| s > 0) {
        return faces;
    }
    if !sides().any(|s| s < 0) {
        return Vec::new();
    }
    let (mut kept, mut touched) = (Vec::with_capacity(faces.len() + 1), Vec::new());
    for (face, d) in faces.into_iter().zip(&distances) {
        if d.iter().all(|&d| side(d) < 0) {
            kept.push(face);
            continue;
        }
        let (mut polygon, mut on) = (Vec::new(), Vec::new());
        for (k, &a) in face.iter().enumerate() {
            let next = (k + 1) % face.len();
            let (sa, sb) = (side(d[k]), side(d[next]));
            if sa <= 0 {
                polygon.push(a);
                on.push(sa == 0);
            }
            if sa * sb < 0 {
                polygon.push(crossing(a, face[next], d[k], d[next]));
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

/// The four corners of each face of a box, wound outward; corner bit `a` set at its high end on `a`.
const BOX: [usize; 24] = [
    0, 2, 3, 1, 4, 5, 7, 6, 0, 1, 5, 4, 2, 6, 7, 3, 0, 4, 6, 2, 1, 3, 7, 5,
];

/// The box from `low` to `high`, its faces wound outward.
fn cuboid(low: Point, high: Point) -> Faces {
    let corner = |c: usize| [0, 1, 2].map(|a| if c >> a & 1 == 1 { high[a] } else { low[a] });
    let faces = BOX.as_chunks::<4>().0;
    faces.iter().map(|f| f.map(corner).to_vec()).collect()
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

/// The half-space of seed `own` against `other`: the points nearer `own`, bounded at their
/// midpoint, so the two seeds' planes are each other's negation to the bit.
fn bisector(own: Point, other: Point) -> Option<Plane> {
    let normal = unit(sub(other, own))?;
    Some((
        normal,
        dot(normal, [0, 1, 2].map(|k| (own[k] + other[k]) / 2.0)),
    ))
}

/// The cell of each of `seeds` in the solid `planes` bound inside `bounds`, a corner within `eps`
/// of a plane on it: the box cut by the seed's bisectors first, so each face plane meets a cell a
/// twelfth of the solid, not all of it.
pub(super) fn cells(
    seeds: &[Point],
    bounds: (Point, Point),
    planes: &[Plane],
    eps: f64,
) -> Vec<Faces> {
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

/// The outward face planes of the closed mesh `triangles` over `pos`, wound either way, but those
/// one of its `corners` lies more than `eps` beyond: a sliver's corners, rounded to 32 bits, tilt
/// its plane into the solid, which the faces around it bound already. A plane repeating the one
/// before within `eps` (a quad's two triangles) is kept once.
pub(super) fn face_planes(mesh: (&[f32], &[u32]), corners: &[Point], eps: f64) -> Vec<Plane> {
    let (pos, triangles) = mesh;
    let at = |t: &[u32; 3]| t.map(|i| point(pos, i));
    let faces = triangles.as_chunks::<3>().0;
    let volume = |[a, b, c]: [Point; 3]| dot(a, cross(b, c));
    let signed: f64 = faces.iter().map(at).map(volume).sum();
    let planes = faces.par_iter().map(at).filter_map(|[a, b, c]| {
        let normal = unit(scale(cross(sub(b, a), sub(c, a)), signed.signum()))?;
        Some((normal, dot(normal, a)))
    });
    let supporting = |&(n, c): &Plane| corners.iter().all(|&p| dot(n, p) - c <= eps);
    let mut planes: Vec<Plane> = planes.filter(supporting).collect();
    planes.dedup_by(|(n, c), (m, d)| dot(*n, *m) >= 1.0 - 1e-12 && (*c - *d).abs() <= eps);
    planes
}
