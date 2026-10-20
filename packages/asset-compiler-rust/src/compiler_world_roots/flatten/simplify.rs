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
use super::first_seen::first_seen;
use super::heap::Heap;
use super::quadric::{adjugate, outer, times, Plane, Volume};
use super::tree::Tree;
use trillion3d_math::aabb::{aabb_of_f32, centre};
use trillion3d_math::triangle::{edge_key, facing};
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{add, distance2, dot, scale, sub};
use trillion3d_page_codec::encode::vertices::first_use;

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

impl Mesh {
    /// The mesh of `indices` over `points`: degenerate, non-manifold and duplicate triangles
    /// dropped. Every corner's edge is first numbered side by side by its key (`first_seen`), so
    /// the pass that keeps the triangles in order finds an edge by its number in constant time.
    fn new(points: Vec<V3>, indices: &[u32]) -> Self {
        use rayon::prelude::*;
        let count = points.len();
        let tris = indices.as_chunks::<3>().0;
        let named: Vec<u64> = (tris.par_iter())
            .flat_map_iter(|t| (0..3).map(move |k| edge_key(t[k], t[(k + 1) % 3])))
            .collect();
        let (keys, ranks) = first_seen(named);
        // Per numbered key, the mesh's edge once a kept triangle made it.
        let mut made = vec![NONE; keys.len()];
        drop(keys);
        let mut mesh = Mesh {
            positions: points,
            vertex_edges: vec![VertexEdges::new(); count],
            vertex_alive: vec![true; count],
            triangles: Vec::new(),
            triangle_alive: Vec::new(),
            edges: Vec::new(),
            edge_alive: Vec::new(),
            triangle_count: 0,
        };
        for (at, &tv) in tris.iter().enumerate() {
            if tv[0] == tv[1] || tv[0] == tv[2] || tv[1] == tv[2] {
                continue;
            }
            let rank = |k: usize| ranks[3 * at + k] as usize;
            let found = [0, 1, 2].map(|k| Some(made[rank(k)]).filter(|&e| e != NONE));
            if found
                .iter()
                .any(|e| e.is_some_and(|e| mesh.edges[e as usize].1[1] != NONE))
            {
                continue;
            }
            if let [Some(e0), Some(_), Some(_)] = found {
                let ti = mesh.edges[e0 as usize].1[0] as usize;
                if mesh.triangles[ti].contains(&tv[2]) {
                    continue;
                }
            }
            let tid = mesh.triangles.len() as u32;
            mesh.triangles.push(tv);
            mesh.triangle_alive.push(true);
            mesh.triangle_count += 1;
            for k in 0..3 {
                let (a, b) = (tv[k], tv[(k + 1) % 3]);
                match found[k] {
                    Some(e) => mesh.edges[e as usize].1[1] = tid,
                    None => {
                        let e = mesh.edges.len() as u32;
                        made[rank(k)] = e;
                        mesh.edges.push(([a.min(b), a.max(b)], [tid, NONE]));
                        mesh.edge_alive.push(true);
                        mesh.vertex_edges[a as usize].push(e);
                        mesh.vertex_edges[b as usize].push(e);
                    }
                }
            }
        }
        // Vertices no triangle uses are not the mesh's.
        for v in 0..count {
            if mesh.vertex_edges[v].is_empty() {
                mesh.vertex_alive[v] = false;
            }
        }
        mesh
    }

    fn other(&self, e: u32, v: u32) -> u32 {
        let [a, b] = self.edges[e as usize].0;
        if a == v {
            b
        } else {
            a
        }
    }

    fn find_edge(&self, a: u32, b: u32) -> Option<u32> {
        (self.vertex_edges[a as usize].iter().copied()).find(|&e| self.other(e, a) == b)
    }

    fn boundary_edge(&self, e: u32) -> bool {
        self.edges[e as usize].1[1] == NONE
    }

    /// Each triangle about `v` once: it holds two of `v`'s edges and is taken from the one that
    /// leads to the corner after `v` in its winding.
    fn vertex_triangles(&self, v: u32) -> impl Iterator<Item = u32> + '_ {
        self.vertex_edges[v as usize].iter().flat_map(move |&e| {
            let w = self.other(e, v);
            self.edges[e as usize].1.into_iter().filter(move |&t| {
                t != NONE && {
                    let tri = self.triangles[t as usize];
                    let k = (0..3).find(|&k| tri[k] == v).unwrap_or(0);
                    tri[(k + 1) % 3] == w
                }
            })
        })
    }

    fn other_vertex(&self, t: u32, a: u32, b: u32) -> u32 {
        *self.triangles[t as usize]
            .iter()
            .find(|&&v| v != a && v != b)
            .unwrap_or(&NONE)
    }

    /// Triangle `t`'s unit normal, the area, the centroid.
    fn triangle_info(&self, t: u32) -> (V3, f64, V3) {
        let [a, b, c] = self.triangles[t as usize].map(|v| self.positions[v as usize]);
        let n = cross(sub(b, a), sub(c, a));
        let length = dot(n, n).sqrt();
        let unit = if length > f64::EPSILON {
            scale(n, 1.0 / length)
        } else {
            [0.0; 3]
        };
        let centroid = scale(add(add(a, b), c), 1.0 / 3.0);
        (unit, 0.5 * length, centroid)
    }

    fn replace_edge_triangle(&mut self, e: u32, old: u32, new: u32) {
        let tris = &mut self.edges[e as usize].1;
        if tris[0] == old {
            if new == NONE {
                tris[0] = tris[1];
                tris[1] = NONE;
            } else {
                tris[0] = new;
            }
        } else if tris[1] == old {
            tris[1] = new;
        }
    }

    fn remove_from(&mut self, v: u32, e: u32) {
        let list = &mut self.vertex_edges[v as usize];
        if let Some(at) = list.iter().position(|&x| x == e) {
            list.remove(at);
        }
    }

    /// `remove` collapsed into `keep`, refused unless the result stays a manifold: the link
    /// condition, no tetrahedron, no last triangle, no interior edge between two boundary
    /// vertices.
    fn collapse(&mut self, keep: u32, remove: u32) -> Result<Collapsed, Refused> {
        let (b, a) = (keep, remove);
        let eab = self.find_edge(a, b).ok_or(Refused::Other)?;
        let (_, [t0, t1]) = self.edges[eab as usize];
        let c = self.other_vertex(t0, a, b);
        let boundary = t1 == NONE;
        let d = if boundary {
            NONE
        } else {
            self.other_vertex(t1, a, b)
        };
        if c == d {
            return Err(Refused::Other);
        }
        let (mut eac, mut ead) = (NONE, NONE);
        for &e in &self.vertex_edges[a as usize] {
            let x = self.other(e, a);
            if x == c {
                eac = e;
            } else if x == d {
                ead = e;
            } else if x != b && self.find_edge(b, x).is_some() {
                return Err(Refused::Other);
            }
        }
        let edges_a = self.vertex_edges[a as usize].len();
        if edges_a == 3 && !boundary {
            if let Some(edc) = self.find_edge(d, c) {
                let (_, [s, u]) = self.edges[edc as usize];
                if u != NONE {
                    let has = |t: u32, v: u32| self.triangles[t as usize].contains(&v);
                    if (has(s, a) && has(u, b)) || (has(s, b) && has(u, a)) {
                        return Err(Refused::Other);
                    }
                }
            }
        } else if boundary && self.boundary_edge(eac) {
            let ebc = self.find_edge(b, c).ok_or(Refused::Other)?;
            if self.boundary_edge(ebc) {
                return Err(Refused::Triangle);
            }
        }
        let boundary_vertex =
            |v: u32| (self.vertex_edges[v as usize].iter()).any(|&e| self.boundary_edge(e));
        if !boundary && boundary_vertex(a) && boundary_vertex(b) {
            return Err(Refused::Other);
        }
        // Edges of `a` handed to `b`, triangles of `a` renamed.
        let mut tac = NONE;
        let mut tad = NONE;
        let edges_of_a = std::mem::take(&mut self.vertex_edges[a as usize]);
        for &e in &edges_of_a {
            let o = self.other(e, a);
            if o == b {
                self.remove_from(b, e);
            } else if o == c {
                self.remove_from(c, e);
                let [s, u] = self.edges[e as usize].1;
                tac = if s == t0 { u } else { s };
            } else if o == d {
                self.remove_from(d, e);
                let [s, u] = self.edges[e as usize].1;
                tad = if s == t1 { u } else { s };
            } else {
                self.edges[e as usize].0 = [o.min(b), o.max(b)];
                self.vertex_edges[b as usize].push(e);
            }
            for tj in self.edges[e as usize].1 {
                if tj != NONE && tj != t0 && tj != t1 {
                    for v in self.triangles[tj as usize].iter_mut() {
                        if *v == a {
                            *v = b;
                        }
                    }
                }
            }
        }
        let ebc = self.find_edge(b, c).ok_or(Refused::Other)?;
        self.replace_edge_triangle(ebc, t0, tac);
        self.edge_alive[eab as usize] = false;
        self.edge_alive[eac as usize] = false;
        self.triangle_alive[t0 as usize] = false;
        self.triangle_count -= 1;
        if !boundary {
            let ebd = self.find_edge(b, d).ok_or(Refused::Other)?;
            self.replace_edge_triangle(ebd, t1, tad);
            self.edge_alive[ead as usize] = false;
            self.triangle_alive[t1 as usize] = false;
            self.triangle_count -= 1;
        }
        self.vertex_alive[a as usize] = false;
        Ok(Collapsed {
            removed_tris: [t0, t1],
            opposing: [c, d],
        })
    }

    /// Triangle `t` removed, its orphaned edges and vertices with it.
    fn remove_triangle(&mut self, t: u32) {
        let tv = self.triangles[t as usize];
        self.triangle_alive[t as usize] = false;
        self.triangle_count -= 1;
        for k in 0..3 {
            let (a, b) = (tv[k], tv[(k + 1) % 3]);
            if let Some(e) = self.find_edge(a, b) {
                self.replace_edge_triangle(e, t, NONE);
                if self.edges[e as usize].1[0] == NONE {
                    self.edge_alive[e as usize] = false;
                    self.remove_from(a, e);
                    self.remove_from(b, e);
                }
            }
        }
        for v in tv {
            if self.vertex_edges[v as usize].is_empty() {
                self.vertex_alive[v as usize] = false;
            }
        }
    }
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

impl Simplifier {
    /// The boundary vertices.
    fn precompute(&mut self) {
        self.have_boundary = false;
        self.boundary = vec![false; self.mesh.positions.len()];
        for e in 0..self.mesh.edges.len() {
            if self.mesh.edge_alive[e] && self.mesh.boundary_edge(e as u32) {
                let [a, b] = self.mesh.edges[e].0;
                self.boundary[a as usize] = true;
                self.boundary[b as usize] = true;
                self.have_boundary = true;
            }
        }
    }

    fn face_quadric(&self, t: u32) -> (Quadric, f64) {
        let (n, area, centroid) = self.mesh.triangle_info(t);
        (Quadric::plane(n, centroid), area)
    }

    /// The area-weighted sum of the quadrics of the triangles about `v`.
    fn vertex_quadric(&self, v: u32) -> Quadric {
        let mut q = Quadric::default();
        for t in self.mesh.vertex_triangles(v) {
            q.add(self.tri_areas[t as usize], &self.tri_quadrics[t as usize]);
        }
        q
    }

    /// The edge's quadric: the two vertex quadrics, the edge's triangles counted once.
    fn edge_quadric(&self, e: u32) -> Quadric {
        let ([a, b], tris) = self.mesh.edges[e as usize];
        let mut q = self.vertex_quadrics[a as usize];
        q.add(1.0, &self.vertex_quadrics[b as usize]);
        for t in tris {
            if t != NONE {
                q.add(-self.tri_areas[t as usize], &self.tri_quadrics[t as usize]);
            }
        }
        q
    }

    /// Edge `e`'s collapse point: on a boundary edge the best of its end, its midpoint and the
    /// optimum brought onto it; an edge touching the boundary collapses onto its boundary end; any
    /// other to the optimum, else the best of its end and its midpoint.
    fn optimal_point(&self, e: u32, q: &Quadric) -> V3 {
        let [a, b] = self.mesh.edges[e as usize].0;
        let (pa, pb) = (
            self.mesh.positions[a as usize],
            self.mesh.positions[b as usize],
        );
        let mut best = (pa, q.evaluate(pa));
        let mut consider = |p: V3| {
            let err = q.evaluate(p);
            if err < best.1 {
                best = (p, err);
            }
        };
        if self.have_boundary {
            if self.mesh.boundary_edge(e) {
                consider(pb);
                consider(scale(add(pa, pb), 0.5));
                if let Some(x) = q.optimal() {
                    consider(nearest_on_segment(pa, pb, x));
                }
                return best.0;
            } else if self.boundary[a as usize] {
                return pa;
            } else if self.boundary[b as usize] {
                return pb;
            }
        }
        if let Some(x) = q.optimal() {
            return x;
        }
        consider(pb);
        consider(scale(add(pa, pb), 0.5));
        best.0
    }

    /// Edge `e`'s collapse point and its error.
    fn scored(&self, e: u32) -> (V3, f32) {
        let q = self.edge_quadric(e);
        let opt = self.optimal_point(e, &q);
        (opt, q.evaluate(opt) as f32)
    }

    fn score(&mut self, e: u32) -> f32 {
        let (opt, error) = self.scored(e);
        self.collapse_points[e as usize] = opt;
        error
    }

    /// Each triangle's,
    /// each vertex's and each edge's computed side by side from what the step before made.
    fn initialize(&mut self) {
        use rayon::prelude::*;
        let triangles = self.mesh.triangles.len();
        (self.tri_quadrics, self.tri_areas) = (0..triangles)
            .into_par_iter()
            .map(|t| {
                if self.mesh.triangle_alive[t] {
                    self.face_quadric(t as u32)
                } else {
                    (Quadric::default(), 0.0)
                }
            })
            .unzip();
        self.vertex_quadrics = (0..self.mesh.positions.len())
            .into_par_iter()
            .map(|v| {
                if self.mesh.vertex_alive[v] {
                    self.vertex_quadric(v as u32)
                } else {
                    Quadric::default()
                }
            })
            .collect();
        let edges = self.mesh.edges.len();
        let scored: Vec<(V3, f32)> = (0..edges as u32)
            .into_par_iter()
            .map(|e| {
                if self.mesh.edge_alive[e as usize] {
                    self.scored(e)
                } else {
                    ([0.0; 3], 0.0)
                }
            })
            .collect();
        self.marks = vec![0; edges];
        self.epoch = 0;
        let mut errors: Vec<(f32, u32)> = (0..edges as u32)
            .filter(|&e| self.mesh.edge_alive[e as usize])
            .map(|e| (scored[e as usize].1, e))
            .collect();
        self.collapse_points = scored.into_iter().map(|(point, _)| point).collect();
        errors.par_sort_unstable_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)));
        self.queue = Heap::new(edges);
        for (error, e) in errors {
            self.queue.insert(e, error);
        }
    }

    /// After a collapse, memoryless: the quadrics of the triangles about the kept vertex and
    /// of their vertices recomputed, the removed triangles taken from the opposing vertices, then
    /// every edge of the kept vertex and of its neighbours scored again.
    fn update_neighborhood(&mut self, kept: u32, removed: [u32; 2], opposing: [u32; 2]) {
        for t in self.mesh.vertex_triangles(kept) {
            let (old_area, old) = (self.tri_areas[t as usize], self.tri_quadrics[t as usize]);
            let (new, new_area) = self.face_quadric(t);
            self.tri_areas[t as usize] = new_area;
            self.tri_quadrics[t as usize] = new;
            for v in self.mesh.triangles[t as usize] {
                if v != kept {
                    let q = &mut self.vertex_quadrics[v as usize];
                    q.add(-old_area, &old);
                    q.add(new_area, &new);
                }
            }
        }
        for k in 0..2 {
            let t = removed[k];
            if t != NONE {
                let (area, q) = (self.tri_areas[t as usize], self.tri_quadrics[t as usize]);
                self.vertex_quadrics[opposing[k] as usize].add(-area, &q);
                self.tri_quadrics[t as usize] = Quadric::default();
                self.tri_areas[t as usize] = 0.0;
            }
        }
        self.vertex_quadrics[kept as usize] = self.vertex_quadric(kept);
        // Each edge once, by a mark per edge: a vertex of a flat region gathers a wide fan.
        self.epoch += 1;
        let mut update: Vec<u32> = Vec::with_capacity(64);
        for &adjacent in &self.mesh.vertex_edges[kept as usize] {
            update.push(adjacent);
            self.marks[adjacent as usize] = self.epoch;
            let v = self.mesh.other(adjacent, kept);
            for &e in &self.mesh.vertex_edges[v as usize] {
                if self.marks[e as usize] != self.epoch {
                    self.marks[e as usize] = self.epoch;
                    update.push(e);
                }
            }
        }
        for e in update {
            let error = self.score(e);
            self.queue.set(e, error);
        }
    }

    /// Whether the collapse stays within the geometric tolerance: the new point, the new
    /// midpoints of the other edges and the new centroids of the triangles that stay, all within
    /// the tolerance of the target.
    fn within_tolerance(&self, keep: u32, remove: u32, p: V3, tc: u32, td: u32) -> bool {
        let Some(target) = &self.target else {
            return true;
        };
        if !target.within(p) {
            return false;
        }
        let collapsing = self.mesh.find_edge(keep, remove);
        for v in [keep, remove] {
            for &e in &self.mesh.vertex_edges[v as usize] {
                if Some(e) != collapsing {
                    let o = self.mesh.positions[self.mesh.other(e, v) as usize];
                    if !target.within(scale(add(o, p), 0.5)) {
                        return false;
                    }
                }
            }
        }
        for v in [keep, remove] {
            for t in self.mesh.vertex_triangles(v) {
                if t == tc || t == td {
                    continue;
                }
                let centroid = self.mesh.triangles[t as usize]
                    .iter()
                    .map(|&x| {
                        if x == keep || x == remove {
                            p
                        } else {
                            self.mesh.positions[x as usize]
                        }
                    })
                    .fold([0.0; 3], add);
                if !target.within(scale(centroid, 1.0 / 3.0)) {
                    return false;
                }
            }
        }
        true
    }

    /// Whether moving `v` to `p` turns any triangle about it over (its normal past 90°) or would
    /// join it to `other` twice.
    fn flips(&self, v: u32, other: u32, p: V3, tc: u32, td: u32) -> bool {
        for t in self.mesh.vertex_triangles(v) {
            if t == tc || t == td {
                continue;
            }
            let tri = self.mesh.triangles[t as usize];
            if tri.contains(&other) {
                return true;
            }
            let k = (0..2).find(|&k| tri[k] == v).unwrap_or(2);
            if facing(tri.map(|x| self.mesh.positions[x as usize]), k, p) <= 0.0 {
                return true;
            }
        }
        false
    }

    /// Edge `e` collapsed to `new`, unless out of tolerance, flipping or not manifold.
    fn collapse_edge(&mut self, e: u32, new: V3) -> Outcome {
        if !self.mesh.edge_alive[e as usize] {
            return Outcome::Ignored;
        }
        let ([a, b], [t0, t1]) = self.mesh.edges[e as usize];
        let mut collapse_to = NONE;
        if self.have_boundary {
            if self.boundary[b as usize] {
                collapse_to = b;
            } else if self.boundary[a as usize] {
                collapse_to = a;
            }
        }
        let (keep, remove) = if collapse_to == a { (a, b) } else { (b, a) };
        let (pkeep, premove) = (
            self.mesh.positions[keep as usize],
            self.mesh.positions[remove as usize],
        );
        let mut new = new;
        if !self.within_tolerance(keep, remove, new, t0, t1) {
            let t = segment_parameter(pkeep, premove, new);
            new = add(scale(pkeep, 1.0 - t), scale(premove, t));
            if !self.within_tolerance(keep, remove, new, t0, t1) {
                return Outcome::Ignored;
            }
        }
        if self.flips(a, b, new, t0, t1) || self.flips(b, a, new, t0, t1) {
            return Outcome::Ignored;
        }
        match self.mesh.collapse(keep, remove) {
            Ok(done) => {
                self.mesh.positions[keep as usize] = new;
                Outcome::Collapsed(keep, done.removed_tris, done.opposing)
            }
            Err(Refused::Triangle) => Outcome::IsolatedTriangle,
            Err(Refused::Other) => Outcome::Ignored,
        }
    }

    /// Collapses, least error first, down to `target` triangles.
    fn simplify_to(&mut self, target: usize) {
        if self.mesh.triangle_count == 0 {
            return;
        }
        let target = target.max(1);
        // The live mesh alone carries on: the elements earlier passes removed hold no quadric.
        if self.mesh.triangles.len() > self.mesh.triangle_count {
            let (points, indices) = self.compact();
            self.mesh = Mesh::new(Vec::new(), &[]);
            self.mesh = Mesh::new(points, &indices);
        }
        self.precompute();
        self.initialize();
        while self.mesh.triangle_count > target {
            let Some(e) = self.queue.pop() else {
                break;
            };
            if !self.mesh.edge_alive[e as usize] {
                continue;
            }
            let point = self.collapse_points[e as usize];
            match self.collapse_edge(e, point) {
                Outcome::Collapsed(kept, removed, opposing) => {
                    self.update_neighborhood(kept, removed, opposing)
                }
                Outcome::IsolatedTriangle if self.mesh.triangle_count > 2 => {
                    let t = self.mesh.edges[e as usize].1[0];
                    self.remove_isolated(t);
                }
                _ => {}
            }
        }
    }

    /// Triangle `t` removed when no other triangle touches its vertices.
    fn remove_isolated(&mut self, t: u32) {
        if t == NONE || !self.mesh.triangle_alive[t as usize] {
            return;
        }
        let isolated = (self.mesh.triangles[t as usize].iter())
            .all(|&v| self.mesh.vertex_triangles(v).all(|x| x == t));
        if isolated {
            self.mesh.remove_triangle(t);
        }
    }

    /// Interior edges
    /// shorter than the length collapsed to their midpoints, round after round.
    fn fast_collapse(&mut self, min_edge_length: f64, rounds: usize, min_triangles: usize) {
        if self.mesh.triangle_count <= min_triangles {
            return;
        }
        let min2 = min_edge_length * min_edge_length;
        self.precompute();
        let count = self.mesh.edges.len() as u32;
        for _ in 0..rounds {
            let mut collapsed = 0usize;
            for e in 0..count {
                if !self.mesh.edge_alive[e as usize] || self.mesh.boundary_edge(e) {
                    continue;
                }
                if self.mesh.triangle_count <= min_triangles {
                    break;
                }
                let [a, b] = self.mesh.edges[e as usize].0;
                let (pa, pb) = (
                    self.mesh.positions[a as usize],
                    self.mesh.positions[b as usize],
                );
                if distance2(pa, pb) > min2 {
                    continue;
                }
                if let Outcome::Collapsed(..) = self.collapse_edge(e, scale(add(pa, pb), 0.5)) {
                    collapsed += 1;
                }
            }
            if collapsed == 0 || self.mesh.triangle_count <= min_triangles {
                break;
            }
        }
    }

    /// The live triangles over the live vertices.
    fn compact(&self) -> (Vec<V3>, Vec<u32>) {
        let live: Vec<u32> = (self.mesh.triangles.iter().enumerate())
            .filter(|&(t, _)| self.mesh.triangle_alive[t])
            .flat_map(|(_, tri)| *tri)
            .collect();
        let (used, indices) = first_use(live.into_iter());
        let points = used
            .iter()
            .map(|&v| self.mesh.positions[v as usize])
            .collect();
        (points, indices)
    }
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
