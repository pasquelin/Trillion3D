//! The approximated shell's simplification by edge collapse on quadric error (Garland & Heckbert
//! 1997), memoryless and volume-preserving (Lindstrom & Turk 1998): each collapse moves its vertex
//! to the point of least quadric error, the quadrics are recomputed from the current triangles
//! rather than accumulated, and the point is pulled onto the plane that keeps the enclosed volume.
//! The boundary is kept, nothing is projected, and there is no seam to respect (the mesh carries no
//! attribute while it simplifies).
//!
//! The mesh is held in centimetres about its bounds' centre: the fixed thresholds — the
//! determinant's `1000 · ε`, the volume constraint's `10⁵` — are set for that scale, and centring
//! keeps the quadrics' constant terms small.
//! The mesh's topology lives in `topology`, its collapses in `collapse`, the quadrics in `quadrics`, the
//! loop in `run`.
use super::heap::Heap;
use super::quadric::{adjugate, outer, times, Plane, Volume};
use super::tree::Tree;
use trillion3d_math::aabb::{aabb_of_f32, centre};
use trillion3d_math::vecn::{add, distance2, dot, scale, sub};
mod collapse;
mod quadrics;
mod run;
mod topology;

const NONE: u32 = u32::MAX;
/// The determinant under which a quadric's system counts as singular: `1000 · ε`.
const SOLVE_THRESHOLD: f64 = 1000.0 * f64::EPSILON;
/// Metres to centimetres, the scale the thresholds are set for.
const CM: f64 = 100.0;

type V3 = [f64; 3];

/// A volume-preserving quadric: the planes (`quadric::Plane`) and the summed normal and distance
/// the volume constraint reads (`quadric::Volume`), both at the weight `add` gives them.
#[derive(Clone, Copy, Default)]
struct Quadric {
    plane: Plane,
    volume: Volume,
}

impl Quadric {
    /// The plane of `normal` through `point`.
    fn plane(n: V3, p: V3) -> Self {
        let a = outer(n, n);
        let v = times(&a, p);
        Quadric {
            plane: Plane {
                a,
                b: scale(v, -1.0),
                c: dot(p, v),
            },
            volume: Volume { n, d: -dot(n, p) },
        }
    }

    /// `o` added at weight `w`: the quadric and the plane data both weighted.
    fn add(&mut self, w: f64, o: &Quadric) {
        self.plane.add_scaled(w, &o.plane);
        self.volume.add_scaled(w, &o.volume);
    }

    fn evaluate(&self, p: V3) -> f64 {
        self.plane.evaluate(p)
    }

    /// `A x = r` by the cofactor inverse, when the determinant passes the threshold.
    fn solve(&self, r: V3) -> Option<V3> {
        let (adj, det) = adjugate(&self.plane.a);
        if det.abs() <= SOLVE_THRESHOLD {
            return None;
        }
        let i = 1.0 / det;
        Some(times(&adj.map(|x| x * i), r))
    }

    /// The unconstrained optimum, moved onto the volume
    /// constraint unless its multiplier passes `10⁵`.
    fn optimal(&self) -> Option<V3> {
        let mut x = self.solve(scale(self.plane.b, -1.0))?;
        let (gn, gd) = (scale(self.volume.n, 1.0 / 3.0), self.volume.d / 3.0);
        if let Some(ag) = self.solve(gn) {
            let lambda = (gd + dot(gn, x)) / dot(gn, ag);
            if lambda.abs() > 1e5 || lambda.is_nan() {
                return Some(x);
            }
            x = sub(x, scale(ag, lambda));
        }
        Some(x)
    }
}

/// A vertex's edges, held in place up to eight — a closed surface's vertex has six on average —,
/// on the heap past them: no allocation of its own for almost every vertex.
type VertexEdges = smallvec::SmallVec<[u32; 8]>;

/// The mesh's topology: vertices with their edges, triangles, edges with their vertices
/// (lower first) and their one or two triangles.
struct Mesh {
    positions: Vec<V3>,
    vertex_edges: Vec<VertexEdges>,
    vertex_alive: Vec<bool>,
    triangles: Vec<[u32; 3]>,
    triangle_alive: Vec<bool>,
    edges: Vec<([u32; 2], [u32; 2])>,
    edge_alive: Vec<bool>,
    triangle_count: usize,
}

/// What a collapse did: the triangles removed and the vertices opposite the edge.
struct Collapsed {
    removed_tris: [u32; 2],
    opposing: [u32; 2],
}

/// Why `Mesh::collapse` refused: the edge's last triangle, or any other reason.
#[derive(PartialEq)]
enum Refused {
    Triangle,
    Other,
}

/// The mesh the geometric tolerance is measured against, by closest point, and the tolerance.
struct Target {
    tree: Tree,
    tolerance: f64,
}

impl Target {
    fn project(&self, p: V3) -> V3 {
        self.tree.closest(p)
    }

    fn within(&self, p: V3) -> bool {
        distance2(self.project(p), p) <= self.tolerance * self.tolerance
    }
}

/// The simplifier's state.
struct Simplifier {
    mesh: Mesh,
    tri_quadrics: Vec<Quadric>,
    tri_areas: Vec<f64>,
    vertex_quadrics: Vec<Quadric>,
    /// Per edge, its collapse point; a volume-preserving quadric never vetoes a collapse, so the
    /// edge's quadric itself is not kept.
    collapse_points: Vec<V3>,
    /// Per edge, the last neighbourhood update that gathered it.
    marks: Vec<u32>,
    epoch: u32,
    /// The edges by error, an equal error's children taken left first.
    queue: Heap<false>,
    boundary: Vec<bool>,
    have_boundary: bool,
    target: Option<Target>,
}

/// What a collapse attempt came to, as the passes read it.
#[derive(PartialEq)]
enum Outcome {
    Collapsed(u32, [u32; 2], [u32; 2]),
    IsolatedTriangle,
    Ignored,
}

/// The parameter of `p`'s projection onto `a → b`, within it.
fn segment_parameter(a: V3, b: V3, p: V3) -> f64 {
    let d = sub(b, a);
    let length2 = dot(d, d);
    if length2 <= f64::EPSILON {
        return 0.0;
    }
    (dot(sub(p, a), d) / length2).clamp(0.0, 1.0)
}

/// The point of segment `a → b` nearest `p`.
fn nearest_on_segment(a: V3, b: V3, p: V3) -> V3 {
    let t = segment_parameter(a, b, p);
    add(a, scale(sub(b, a), t))
}

/// The shell simplified to a geometric tolerance, `accuracy` (the voxel accuracy, the fast
/// pre-pass's edge length) and `deviation` (the geometric deviation) in metres: past a million
/// triangles the fast collapse pass, then down to `first` triangles, then — the deviation measured
/// against a copy of that mesh — down to eight. With it, its triangles after each pass: the fast
/// one, the first and the tolerance's.
pub(super) fn simplify(
    (positions, indices): (Vec<f32>, Vec<u32>),
    first: usize,
    (accuracy, deviation): (f64, f64),
) -> ((Vec<f32>, Vec<u32>), [usize; 3]) {
    let points = positions.as_chunks::<3>().0;
    let (low, high) = aabb_of_f32(points.iter().copied());
    let centre: V3 = centre(low.map(f64::from), high.map(f64::from));
    let local: Vec<V3> = (points.iter())
        .map(|p| scale(sub(p.map(f64::from), centre), CM))
        .collect();
    drop(positions);
    let mesh = Mesh::new(local, &indices);
    // The input is held once, in the simplifier's mesh, from here on.
    drop(indices);
    let mut simplifier = Simplifier {
        mesh,
        tri_quadrics: Vec::new(),
        tri_areas: Vec::new(),
        vertex_quadrics: Vec::new(),
        collapse_points: Vec::new(),
        marks: Vec::new(),
        epoch: 0,
        queue: Heap::new(0),
        boundary: Vec::new(),
        have_boundary: false,
        target: None,
    };
    let (accuracy, deviation) = (accuracy * CM, deviation * CM);
    if simplifier.mesh.triangle_count > 1_000_000 {
        simplifier.fast_collapse(accuracy, 10, 1_000_000);
    }
    let fast = simplifier.mesh.triangle_count;
    simplifier.simplify_to(first);
    let first_pass = simplifier.mesh.triangle_count;
    let (copy, copy_indices) = simplifier.compact();
    let soup: Vec<f32> = copy_indices
        .iter()
        .flat_map(|&v| copy[v as usize].map(|x| x as f32))
        .collect();
    simplifier.target = Some(Target {
        tree: Tree::from_soup(soup),
        tolerance: deviation,
    });
    simplifier.simplify_to(8);
    let (out, out_indices) = simplifier.compact();
    let positions = out
        .iter()
        .flat_map(|&p| add(scale(p, 1.0 / CM), centre).map(|x| x as f32))
        .collect();
    let counts = [fast, first_pass, out_indices.len() / 3];
    ((positions, out_indices), counts)
}
