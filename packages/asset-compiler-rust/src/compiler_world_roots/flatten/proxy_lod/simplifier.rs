//! The quadric edge collapse simplifier (Garland & Heckbert 1997) on a vertex holding a position
//! and a normal (three attributes): area weighted quadrics with attribute gradients (Hoppe 1999)
//! and a volume constraint (Lindstrom & Turk 1998), boundary edge quadrics of weight 256, a degree
//! penalty past 24 and a fold penalty of 1e7, the edges in a binary heap keyed by cost, vertices
//! and edges sharing a position grouped so a seam collapses as one. Elements are indices into flat
//! arrays, and the order every list is walked in is fixed, so the result is deterministic.
use super::super::heap::Heap;
use super::super::quadric::{adjugate, outer, times, Plane, Sym3, Volume};
use trillion3d_math::triangle::{edge_key, facing};
use trillion3d_math::vec3::{cross, unit_where, unit_where_squared};
use trillion3d_math::vecn::{dot, length, scale, squared_length, sub};
use trillion3d_page_codec::hash::{word_map, WordMap};

pub(super) const REMOVED: u32 = 1 << 0;
const MARK1: u32 = 1 << 1;
const MARK2: u32 = 1 << 2;
pub(super) const LOCKED: u32 = 1 << 3;

/// A simplified vertex: a position and a normal, the normal's three components the attributes the
/// quadrics carry.
#[derive(Clone, Copy, PartialEq, Default, Debug)]
pub(super) struct Vertex {
    pub pos: [f32; 3],
    pub normal: [f32; 3],
}

impl Vertex {
    /// The exact bits two vertices compare equal by, for hashing.
    fn bits(&self) -> [u32; 6] {
        [
            self.pos[0].to_bits(),
            self.pos[1].to_bits(),
            self.pos[2].to_bits(),
            self.normal[0].to_bits(),
            self.normal[1].to_bits(),
            self.normal[2].to_bits(),
        ]
    }
}

pub(super) fn pos_bits(p: [f32; 3]) -> [u32; 3] {
    p.map(f32::to_bits)
}

/// `v` scaled to unit length when its squared length exceeds `SMALL_NUMBER`, left as is otherwise:
/// a near null vector keeps its value instead of blowing up.
pub(super) fn unit_or_kept(v: [f32; 3]) -> [f32; 3] {
    unit_where_squared(v, |square| square > SMALL_NUMBER).unwrap_or(v)
}

/// The squared length under which a vector counts as null.
const SMALL_NUMBER: f32 = 1.0e-8;

fn wide(p: [f32; 3]) -> [f64; 3] {
    p.map(f64::from)
}

const SINGULAR_QUADRIC_DET: f64 = 1e-8;

/// `v` scaled to unit length unless that length is under `SMALL_NUMBER`.
fn unit_above_small(v: [f64; 3]) -> Option<[f64; 3]> {
    unit_where(v, |norm| !(norm < f64::from(SMALL_NUMBER)))
}

/// A cost read in single precision, 0 when not finite.
fn finite_cost(q: f64) -> f32 {
    (if q.is_finite() { q } else { 0.0 }) as f32
}

/// The inverse of the system whose rows are the triangle's corners and normal: it maps an
/// attribute's three corner values to its gradient over the triangle's plane. `None` when the
/// triangle is too thin to invert (|det| under 1e-8).
fn gradient_matrix(p0: [f64; 3], p1: [f64; 3], p2: [f64; 3], n: [f64; 3]) -> Option<[f64; 12]> {
    let det2_01_01 = p0[0] * p1[1] - p0[1] * p1[0];
    let det2_01_02 = p0[0] * p1[2] - p0[2] * p1[0];
    let det2_01_03 = p0[0] - p1[0];
    let det2_01_12 = p0[1] * p1[2] - p0[2] * p1[1];
    let det2_01_13 = p0[1] - p1[1];
    let det2_01_23 = p0[2] - p1[2];
    let det3_201_013 = p2[0] * det2_01_13 - p2[1] * det2_01_03 + det2_01_01;
    let det3_201_023 = p2[0] * det2_01_23 - p2[2] * det2_01_03 + det2_01_02;
    let det3_201_123 = p2[1] * det2_01_23 - p2[2] * det2_01_13 + det2_01_12;
    let det = -det3_201_123 * n[0] + det3_201_023 * n[1] - det3_201_013 * n[2];
    if det.abs() < SINGULAR_QUADRIC_DET {
        return None;
    }
    let inv_det = 1.0 / det;
    let det2_03_01 = p0[0] * n[1] - p0[1] * n[0];
    let det2_03_02 = p0[0] * n[2] - p0[2] * n[0];
    let det2_03_12 = p0[1] * n[2] - p0[2] * n[1];
    let det2_03_03 = -n[0];
    let det2_03_13 = -n[1];
    let det2_03_23 = -n[2];
    let det2_13_01 = p1[0] * n[1] - p1[1] * n[0];
    let det2_13_02 = p1[0] * n[2] - p1[2] * n[0];
    let det2_13_12 = p1[1] * n[2] - p1[2] * n[1];
    let det2_13_03 = -n[0];
    let det2_13_13 = -n[1];
    let det2_13_23 = -n[2];
    let det3_203_012 = p2[0] * det2_03_12 - p2[1] * det2_03_02 + p2[2] * det2_03_01;
    let det3_203_013 = p2[0] * det2_03_13 - p2[1] * det2_03_03 + det2_03_01;
    let det3_203_023 = p2[0] * det2_03_23 - p2[2] * det2_03_03 + det2_03_02;
    let det3_203_123 = p2[1] * det2_03_23 - p2[2] * det2_03_13 + det2_03_12;
    let det3_213_012 = p2[0] * det2_13_12 - p2[1] * det2_13_02 + p2[2] * det2_13_01;
    let det3_213_013 = p2[0] * det2_13_13 - p2[1] * det2_13_03 + det2_13_01;
    let det3_213_023 = p2[0] * det2_13_23 - p2[2] * det2_13_03 + det2_13_02;
    let det3_213_123 = p2[1] * det2_13_23 - p2[2] * det2_13_13 + det2_13_12;
    let det3_301_012 = n[0] * det2_01_12 - n[1] * det2_01_02 + n[2] * det2_01_01;
    let det3_301_013 = n[0] * det2_01_13 - n[1] * det2_01_03;
    let det3_301_023 = n[0] * det2_01_23 - n[2] * det2_01_03;
    let det3_301_123 = n[1] * det2_01_23 - n[2] * det2_01_13;
    Some([
        det3_213_123 * inv_det,
        det3_213_023 * inv_det,
        det3_213_013 * inv_det,
        det3_213_012 * inv_det,
        det3_203_123 * inv_det,
        det3_203_023 * inv_det,
        det3_203_013 * inv_det,
        det3_203_012 * inv_det,
        det3_301_123 * inv_det,
        det3_301_023 * inv_det,
        det3_301_013 * inv_det,
        det3_301_012 * inv_det,
    ])
}

/// An attribute's gradient (x, y, z) and offset (w) over the triangle from its corner values.
fn gradient(m: &[f64; 12], a0: f32, a1: f32, a2: f32) -> [f64; 4] {
    let (a0, a1, a2) = (f64::from(a0), f64::from(a1), f64::from(a2));
    [
        -m[0] * a0 + m[4] * a1 + m[8] * a2,
        m[1] * a0 - m[5] * a1 - m[9] * a2,
        -m[2] * a0 + m[6] * a1 + m[10] * a2,
        m[3] * a0 - m[7] * a1 - m[11] * a2,
    ]
}

/// The boundary edge quadric: the plane through the edge `p0 → p1` normal to the face, weighted
/// by `edge_weight` times the edge's length; nothing when the face normal is not unit or the edge
/// runs along it.
fn edge_quadric(p0: [f64; 3], p1: [f64; 3], face_normal: [f64; 3], edge_weight: f32) -> Plane {
    if !((1.0 - squared_length(face_normal)).abs() < 0.01) {
        return Plane::default();
    }
    let a = sub(p1, p0);
    let Some(n) = unit_above_small(cross(a, face_normal)) else {
        return Plane::default();
    };
    let dist = -dot(n, p0);
    let weight = f64::from(edge_weight) * length(a);
    let wd = weight * dist;
    Plane {
        a: outer(scale(n, weight), n),
        b: scale(n, wd),
        c: wd * dist,
    }
}

const ATTRIBUTES: usize = 3;

/// The quadric with three attributes (Hoppe 1999), each triangle weighted by its area, with the
/// volume constraint terms that keep a collapse from changing the enclosed volume.
#[derive(Clone, Copy, Default)]
pub(super) struct QuadricAttr {
    plane: Plane,
    g: [[f64; 3]; ATTRIBUTES],
    d: [f64; ATTRIBUTES],
    pub area: f64,
    volume: Volume,
}

impl QuadricAttr {
    /// The triangle quadric. Where the gradient matrix is singular the attribute gradients are
    /// read as zeros.
    fn new(p: [[f64; 3]; 3], attr: [[f32; 3]; 3]) -> QuadricAttr {
        let [p0, p1, p2] = p;
        let raw = cross(sub(p2, p0), sub(p1, p0));
        let Some(n) = unit_above_small(raw) else {
            return QuadricAttr::default();
        };
        let area = 0.5 * length(raw);
        let dist = -dot(n, p0);
        let mut q = QuadricAttr {
            plane: Plane {
                a: outer(n, n),
                b: scale(n, dist),
                c: dist * dist,
            },
            volume: Volume {
                n: scale(n, area / 3.0),
                d: dist * (area / 3.0),
            },
            ..Default::default()
        };
        let matrix = gradient_matrix(p0, p1, p2, n).unwrap_or([0.0; 12]);
        let clean = |v: f32| if v.is_finite() { v } else { 0.0 };
        for i in 0..ATTRIBUTES {
            let grad = gradient(
                &matrix,
                clean(attr[0][i]),
                clean(attr[1][i]),
                clean(attr[2][i]),
            );
            let (g, d) = ([grad[0], grad[1], grad[2]], grad[3]);
            (q.g[i], q.d[i]) = (g, d);
            for (x, y) in q.plane.a.iter_mut().zip(outer(g, g)) {
                *x += y;
            }
            for k in 0..3 {
                q.plane.b[k] += d * g[k];
            }
            q.plane.c += d * d;
        }
        q.plane.a = q.plane.a.map(|v| v * area);
        q.plane.b = scale(q.plane.b, area);
        q.plane.c *= area;
        for i in 0..ATTRIBUTES {
            q.g[i] = scale(q.g[i], area);
            q.d[i] *= area;
        }
        q.area = area;
        q
    }

    fn add(&mut self, q: &QuadricAttr) {
        self.plane.add(&q.plane);
        for i in 0..ATTRIBUTES {
            for k in 0..3 {
                self.g[i][k] += q.g[i][k];
            }
            self.d[i] += q.d[i];
        }
        self.area += q.area;
        self.volume.add(&q.volume);
    }

    /// The cost of `p` carrying `attributes`: the plane distance plus the attribute error, 0 when
    /// not finite.
    fn evaluate(&self, p: [f64; 3], attributes: [f32; 3]) -> f32 {
        let [px, py, pz] = p;
        let s = attributes.map(f64::from);
        let [mut x, mut y, mut z] = times(&self.plane.a, p);
        for i in 0..ATTRIBUTES {
            x -= self.g[i][0] * s[i];
            y -= self.g[i][1] * s[i];
            z -= self.g[i][2] * s[i];
        }
        let mut vav = dot(p, [x, y, z]);
        for i in 0..ATTRIBUTES {
            vav += s[i]
                * (self.area * s[i] - self.g[i][0] * px - self.g[i][1] * py - self.g[i][2] * pz);
        }
        let mut btv = dot(p, self.plane.b);
        for i in 0..ATTRIBUTES {
            btv -= self.d[i] * s[i];
        }
        finite_cost(vav + 2.0 * btv + self.plane.c)
    }

    /// The attributes the quadric predicts at `p`.
    fn attributes(&self, p: [f64; 3]) -> [f32; 3] {
        std::array::from_fn(|i| ((dot(self.g[i], p) + self.d[i]) / self.area) as f32)
    }
}

/// The quadrics of the vertices a collapse merges, summed to be solved for the cheapest position:
/// their planes, areas and volume terms, and their gradients' products `Σ g gᵀ` and `Σ g d`.
#[derive(Default)]
struct Optimizer {
    plane: Plane,
    area: f64,
    volume: Volume,
    bbt: Sym3,
    bd: [f64; 3],
}

impl Optimizer {
    fn add_attr(&mut self, q: &QuadricAttr) {
        self.plane.add(&q.plane);
        self.area += q.area;
        self.volume.add(&q.volume);
        for i in 0..ATTRIBUTES {
            for (x, y) in self.bbt.iter_mut().zip(outer(q.g[i], q.g[i])) {
                *x += y;
            }
        }
        for i in 0..ATTRIBUTES {
            for k in 0..3 {
                self.bd[k] += q.g[i][k] * q.d[i];
            }
        }
    }

    /// The cheapest position: under the volume constraint (its Lagrange row added) when the
    /// constraint's normal is not null, unconstrained otherwise; `None` when singular.
    fn optimize(&self) -> Option<[f64; 3]> {
        let ia = 1.0 / self.area;
        let m: Sym3 = std::array::from_fn(|k| self.plane.a[k] - ia * self.bbt[k]);
        let abddn: [f64; 3] = std::array::from_fn(|k| ia * self.bd[k] - self.plane.b[k]);
        let [nvx, nvy, nvz] = self.volume.n;
        if !(nvx * nvx + nvy * nvy + nvz * nvz > 1e-8) {
            let (adj, det) = adjugate(&m);
            if det.abs() < 1e-8 {
                return None;
            }
            let inv_det = 1.0 / det;
            return Some(times(&adj, abddn).map(|x| inv_det * x));
        }
        let [mxx, mxy, mxz, myy, myz, mzz] = m;
        let [abddnx, abddny, abddnz] = abddn;
        let dv = self.volume.d;
        let det2_01_01 = mxx * myy - mxy * mxy;
        let det2_01_02 = mxx * myz - mxz * mxy;
        let det2_01_12 = mxy * myz - mxz * myy;
        let det2_01_03 = mxx * nvy - nvx * mxy;
        let det2_01_13 = mxy * nvy - nvx * myy;
        let det2_01_23 = mxz * nvy - nvx * myz;
        let inv_x = mzz * det2_01_13 - myz * det2_01_23 - nvz * det2_01_12;
        let inv_y = mxz * det2_01_23 - mzz * det2_01_03 + nvz * det2_01_02;
        let inv_z = myz * det2_01_03 - mxz * det2_01_13 - nvz * det2_01_01;
        let det = inv_x * nvx + inv_y * nvy + inv_z * nvz;
        if det.abs() < 1e-8 {
            return None;
        }
        let inv_det = 1.0 / det;
        let det2_03_02 = mxx * nvz - mxz * nvx;
        let det2_03_12 = mxy * nvz - mxz * nvy;
        let det2_13_12 = myy * nvz - myz * nvy;
        let det2_03_03 = -nvx * nvx;
        let det2_03_13 = -nvx * nvy;
        let det2_03_23 = -nvx * nvz;
        let det2_13_13 = -nvy * nvy;
        let det2_13_23 = -nvy * nvz;
        let imxx = mzz * det2_13_13 - myz * det2_13_23 - nvz * det2_13_12;
        let imxy = myz * det2_03_23 - mzz * det2_03_13 + nvz * det2_03_12;
        let imyy = mzz * det2_03_03 - mxz * det2_03_23 - nvz * det2_03_02;
        let imxz = nvy * det2_01_23 - nvz * det2_01_13;
        let imyz = nvz * det2_01_03 - nvx * det2_01_23;
        let imzz = nvx * det2_01_13 - nvy * det2_01_03;
        Some([
            inv_det * (abddnx * imxx + abddny * imxy + abddnz * imxz - inv_x * dv),
            inv_det * (abddnx * imxy + abddny * imyy + abddnz * imyz - inv_y * dv),
            inv_det * (abddnx * imxz + abddny * imyz + abddnz * imzz - inv_z * dv),
        ])
    }
}

/// A simplifier vertex: its position group ring, flags, vertex and adjacent triangles (added at
/// the end, removed by moving the last into the hole).
struct SVert {
    next: u32,
    prev: u32,
    flags: u32,
    vert: Vertex,
    adj: Vec<u32>,
}

/// A simplifier triangle: its three vertices and flags.
struct STri {
    verts: [u32; 3],
    flags: u32,
}

/// A simplifier edge: its group ring of edges joining the same two positions.
struct SEdge {
    next: u32,
    prev: u32,
    v0: u32,
    v1: u32,
    flags: u32,
}

/// When the simplification stops: under the triangle count or past the cost.
#[derive(Clone, Copy)]
pub(super) struct Terminator {
    pub min_tris: i32,
    pub max_cost: f32,
}

impl Terminator {
    fn stop(&self, tris: i32, error: f32) -> bool {
        tris < self.min_tris || error > self.max_cost
    }
}

fn add_unique(list: &mut Vec<u32>, x: u32) {
    if !list.contains(&x) {
        list.push(x);
    }
}

/// The edge collapse simplifier over one mesh.
pub(super) struct Simplifier {
    verts: Vec<SVert>,
    tris: Vec<STri>,
    edges: Vec<SEdge>,
    edge_hash: WordMap<u64, u32>,
    /// The edges by cost, an equal cost's children taken right first.
    heap: Heap<true>,
    vert_quadrics: Vec<Option<QuadricAttr>>,
    tri_quadrics: Vec<Option<QuadricAttr>>,
    edge_quadrics: Vec<Option<Plane>>,
    update_verts: Vec<u32>,
    update_tris: Vec<u32>,
    update_edges: Vec<u32>,
    num_tris: i32,
}

/// Past 24 triangles around the merged vertex a collapse pays 100 per extra one, which keeps the
/// valence even; a collapse that flips a triangle pays 1e7, so it comes last.
const DEGREE_LIMIT: usize = 24;
const DEGREE_PENALTY: f32 = 100.0;
const INVALID_PENALTY: f32 = 1.0e7;

impl Simplifier {
    /// The simplifier of a mesh: a deep copy, triangles registered with
    /// their vertices, vertices grouped by position, an edge per adjacent pair, edges grouped.
    pub(super) fn new(verts: &[Vertex], indexes: &[u32]) -> Simplifier {
        let num_tris = indexes.len() / 3;
        let mut s = Simplifier {
            verts: verts
                .iter()
                .enumerate()
                .map(|(i, &vert)| SVert {
                    next: i as u32,
                    prev: i as u32,
                    flags: 0,
                    vert,
                    adj: Vec::new(),
                })
                .collect(),
            tris: (0..num_tris)
                .map(|i| STri {
                    verts: [indexes[3 * i], indexes[3 * i + 1], indexes[3 * i + 2]],
                    flags: 0,
                })
                .collect(),
            edges: Vec::new(),
            edge_hash: WordMap::default(),
            heap: Heap::new(0),
            vert_quadrics: vec![None; verts.len()],
            tri_quadrics: vec![None; num_tris],
            edge_quadrics: vec![None; verts.len()],
            update_verts: Vec::new(),
            update_tris: Vec::new(),
            update_edges: Vec::new(),
            num_tris: num_tris as i32,
        };
        for i in 0..num_tris {
            for j in 0..3 {
                let v = s.tris[i].verts[j] as usize;
                s.verts[v].adj.push(i as u32);
            }
        }
        s.group_verts();
        for i in 0..s.verts.len() as u32 {
            for v1 in s.adjacent_verts(i) {
                if i < v1 {
                    let index = s.edges.len() as u32;
                    s.edges.push(SEdge {
                        next: index,
                        prev: index,
                        v0: i,
                        v1,
                        flags: 0,
                    });
                }
            }
        }
        s.group_edges();
        s.edge_hash = word_map(s.edges.len());
        for (i, e) in s.edges.iter().enumerate() {
            s.edge_hash.insert(edge_key(e.v0, e.v1), i as u32);
        }
        s.heap = Heap::new(s.edges.len());
        s
    }

    /// The vertices sharing a triangle with `v`, each once, in first seen order.
    fn adjacent_verts(&self, v: u32) -> Vec<u32> {
        let mut out = Vec::new();
        for &t in &self.verts[v as usize].adj {
            for &u in &self.tris[t as usize].verts {
                if u != v {
                    add_unique(&mut out, u);
                }
            }
        }
        out
    }

    fn test(&self, v: u32, f: u32) -> bool {
        self.verts[v as usize].flags & f == f
    }

    fn group(&self, v: u32) -> Vec<u32> {
        let mut out = vec![v];
        let mut u = self.verts[v as usize].next;
        while u != v {
            out.push(u);
            u = self.verts[u as usize].next;
        }
        out
    }

    fn enable_group(&mut self, v: u32, f: u32) {
        for u in self.group(v) {
            self.verts[u as usize].flags |= f;
        }
    }

    fn set_adj_vert_flags(&mut self, v: u32, f: u32, on: bool) {
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            for j in 0..3 {
                let u = self.tris[t].verts[j] as usize;
                if on {
                    self.verts[u].flags |= f;
                } else {
                    self.verts[u].flags &= !f;
                }
            }
        }
    }

    fn set_adj_tri_flags(&mut self, v: u32, f: u32, on: bool) {
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            if on {
                self.tris[t].flags |= f;
            } else {
                self.tris[t].flags &= !f;
            }
        }
    }

    fn set_adj_tri_flags_group(&mut self, v: u32, f: u32, on: bool) {
        for u in self.group(v) {
            self.set_adj_tri_flags(u, f, on);
        }
    }

    /// Groups the vertices by position: each vertex not yet grouped links the
    /// vertices at its position, in the order its hash bucket lists them (latest first).
    fn group_verts(&mut self) {
        let mut buckets: WordMap<[u32; 3], Vec<u32>> = WordMap::default();
        for (i, v) in self.verts.iter().enumerate() {
            buckets
                .entry(pos_bits(v.vert.pos))
                .or_default()
                .push(i as u32);
        }
        for i in 0..self.verts.len() as u32 {
            if self.verts[i as usize].next != i {
                continue;
            }
            let bucket = &buckets[&pos_bits(self.verts[i as usize].vert.pos)];
            for &j in bucket.iter().rev() {
                if j == i {
                    continue;
                }
                let v1 = i as usize;
                let v2 = j as usize;
                self.verts[v2].next = self.verts[v1].next;
                self.verts[v2].prev = i;
                let n = self.verts[v2].next as usize;
                self.verts[n].prev = j;
                let p = self.verts[v2].prev as usize;
                self.verts[p].next = j;
            }
        }
    }

    fn positions_match(&self, e1: u32, e2: u32) -> (bool, bool) {
        let (a, b) = (&self.edges[e1 as usize], &self.edges[e2 as usize]);
        let pos = |v: u32| self.verts[v as usize].vert.pos;
        let m1 =
            (a.v0 == b.v0 && a.v1 == b.v1) || (pos(a.v0) == pos(b.v0) && pos(a.v1) == pos(b.v1));
        let m2 =
            (a.v0 == b.v1 && a.v1 == b.v0) || (pos(a.v0) == pos(b.v1) && pos(a.v1) == pos(b.v0));
        (m1, m2)
    }

    fn edge_position_key(&self, e: u32) -> ([u32; 3], [u32; 3]) {
        let edge = &self.edges[e as usize];
        let (a, b) = (
            pos_bits(self.verts[edge.v0 as usize].vert.pos),
            pos_bits(self.verts[edge.v1 as usize].vert.pos),
        );
        (a.min(b), a.max(b))
    }

    /// Links `e2` after `e1` in `e1`'s group, turned to face the same way.
    fn link_edge(&mut self, e1: u32, e2: u32) {
        let (m1, m2) = self.positions_match(e1, e2);
        if m2 {
            let e = &mut self.edges[e2 as usize];
            std::mem::swap(&mut e.v0, &mut e.v1);
        }
        if m1 || m2 {
            self.edges[e2 as usize].next = self.edges[e1 as usize].next;
            self.edges[e2 as usize].prev = e1;
            let n = self.edges[e2 as usize].next as usize;
            self.edges[n].prev = e2;
            let p = self.edges[e2 as usize].prev as usize;
            self.edges[p].next = e2;
        }
    }

    /// Groups the edges joining the same two positions, each turned to face its group's first.
    fn group_edges(&mut self) {
        let mut buckets: WordMap<([u32; 3], [u32; 3]), Vec<u32>> = WordMap::default();
        for i in 0..self.edges.len() as u32 {
            buckets
                .entry(self.edge_position_key(i))
                .or_default()
                .push(i);
        }
        for i in 0..self.edges.len() as u32 {
            if self.edges[i as usize].next != i {
                continue;
            }
            let bucket = buckets[&self.edge_position_key(i)].clone();
            for &j in bucket.iter().rev() {
                if j != i {
                    self.link_edge(i, j);
                }
            }
        }
    }

    /// Locks the boundary: both ends of an edge one face
    /// alone touches are locked, with their groups.
    pub(super) fn set_boundary_locked(&mut self) {
        for i in 0..self.verts.len() as u32 {
            // The group's adjacent vertices: every group member walks `i`'s own triangles.
            let mut adj = Vec::new();
            for g in self.group(i) {
                for &t in &self.verts[i as usize].adj {
                    for &u in &self.tris[t as usize].verts {
                        if u != g {
                            add_unique(&mut adj, u);
                        }
                    }
                }
            }
            for v1 in adj {
                if i < v1 {
                    self.set_adj_tri_flags_group(i, MARK1, true);
                    self.set_adj_tri_flags_group(v1, MARK1, false);
                    let mut faces = 0;
                    for g in self.group(i) {
                        for &t in &self.verts[g as usize].adj {
                            faces += if self.tris[t as usize].flags & MARK1 == MARK1 {
                                0
                            } else {
                                1
                            };
                        }
                    }
                    self.set_adj_tri_flags_group(i, MARK1, false);
                    if faces == 1 {
                        self.enable_group(i, LOCKED);
                        self.enable_group(v1, LOCKED);
                    }
                }
            }
        }
    }

    /// Every edge's collapse cost pushed on the heap.
    pub(super) fn init_costs(&mut self) {
        for i in 0..self.edges.len() as u32 {
            let cost = self.collapse_cost(i);
            self.heap.insert(i, cost);
        }
    }

    fn find_edge(&self, u: u32, v: u32) -> Option<u32> {
        self.edge_hash.get(&edge_key(u, v)).copied()
    }

    fn ungroup_edge(&mut self, e: u32) {
        let (n, p) = (self.edges[e as usize].next, self.edges[e as usize].prev);
        self.edges[p as usize].next = n;
        self.edges[n as usize].prev = p;
        self.edges[e as usize].next = e;
        self.edges[e as usize].prev = e;
    }

    /// Marks `e` removed: out of the hash and the heap when it is the edge they hold, out of its
    /// group.
    fn remove_edge(&mut self, e: u32) {
        if self.edges[e as usize].flags & REMOVED != 0 {
            return;
        }
        let key = edge_key(self.edges[e as usize].v0, self.edges[e as usize].v1);
        if self.edge_hash.get(&key) == Some(&e) {
            self.edge_hash.remove(&key);
            self.heap.remove(e);
        }
        self.edges[e as usize].flags |= REMOVED;
        self.ungroup_edge(e);
    }

    /// The edge `old_v`–`other_v` moved onto `new_v` (an edge already joining `new_v` and
    /// `other_v` removed), or removed when `new_v` is `None`.
    fn replace_edge_vert(&mut self, old_v: u32, other_v: u32, new_v: Option<u32>) {
        let Some(&index) = self.edge_hash.get(&edge_key(old_v, other_v)) else {
            return;
        };
        self.edge_hash.remove(&edge_key(old_v, other_v));
        if let Some(new_v) = new_v {
            if let Some(existing) = self.find_edge(new_v, other_v) {
                self.remove_edge(existing);
            }
            self.edge_hash.insert(edge_key(new_v, other_v), index);
            let edge = &mut self.edges[index as usize];
            if edge.v0 == old_v {
                edge.v0 = new_v;
            } else {
                edge.v1 = new_v;
            }
        } else {
            self.edges[index as usize].flags |= REMOVED;
            self.ungroup_edge(index);
            self.heap.remove(index);
        }
    }

    /// The triangles, vertices and edges a collapse at `v` touches, queued for update.
    fn gather_updates(&mut self, v: u32) {
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k];
            add_unique(&mut self.update_tris, t);
        }
        let adj = self.adjacent_verts(v);
        for &a in &adj {
            add_unique(&mut self.update_verts, a);
            self.verts[a as usize].flags |= MARK2;
        }
        for &a in &adj {
            self.set_adj_vert_flags(a, MARK1, true);
            for k in 0..self.verts[a as usize].adj.len() {
                let t = self.verts[a as usize].adj[k] as usize;
                for j in 0..3 {
                    let u = self.tris[t].verts[j];
                    if self.test(u, MARK1) && !self.test(u, MARK2) {
                        if let Some(e) = self.find_edge(a, u) {
                            add_unique(&mut self.update_edges, e);
                        }
                    }
                    self.verts[u as usize].flags &= !MARK1;
                }
            }
            self.verts[a as usize].flags &= !MARK2;
        }
    }

    /// `v`'s quadric: the sum of its triangles' quadrics, each and the sum cached until a collapse
    /// touches them.
    fn quadric(&mut self, v: u32) -> QuadricAttr {
        if let Some(q) = self.vert_quadrics[v as usize] {
            return q;
        }
        let mut sum = QuadricAttr::default();
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            let q = match self.tri_quadrics[t] {
                Some(q) => q,
                None => {
                    let tri = self.tris[t].verts.map(|u| self.verts[u as usize].vert);
                    let q = QuadricAttr::new(tri.map(|u| wide(u.pos)), tri.map(|u| u.normal));
                    self.tri_quadrics[t] = Some(q);
                    q
                }
            };
            sum.add(&q);
        }
        self.vert_quadrics[v as usize] = Some(sum);
        sum
    }

    /// The unit normal of triangle `t`.
    fn tri_normal(&self, t: usize) -> [f32; 3] {
        let [a, b, c] = self.tris[t].verts.map(|u| self.verts[u as usize].vert.pos);
        unit_or_kept(cross(sub(c, a), sub(b, a)))
    }

    /// The boundary edge quadrics around `v` (its edges one face alone touches), cached.
    fn edge_quadric(&mut self, v: u32) -> Plane {
        if let Some(q) = self.edge_quadrics[v as usize] {
            return q;
        }
        let mut sum = Plane::default();
        let adj = self.adjacent_verts(v);
        self.set_adj_tri_flags(v, MARK1, true);
        for u in adj {
            let mut face = None;
            let mut count = 0;
            for &t in &self.verts[u as usize].adj {
                if self.tris[t as usize].flags & MARK1 == MARK1 {
                    face = Some(t);
                    count += 1;
                }
            }
            if count == 1 {
                let normal = self.tri_normal(face.expect("a face") as usize);
                sum.add(&edge_quadric(
                    wide(self.verts[v as usize].vert.pos),
                    wide(self.verts[u as usize].vert.pos),
                    wide(normal),
                    256.0,
                ));
            }
        }
        self.set_adj_tri_flags(v, MARK1, false);
        self.edge_quadrics[v as usize] = Some(sum);
        sum
    }

    /// The collapse of `edge`'s group: the merged vertices, their quadrics, the boundary quadric
    /// and the optimal position.
    fn new_verts_pos(&mut self, edge: u32) -> (Vec<Vertex>, Vec<QuadricAttr>, Plane, [f64; 3]) {
        let mut optimizer = Optimizer::default();
        let mut new_verts = Vec::new();
        let mut quadrics = Vec::new();
        let (v0, v1) = (self.edges[edge as usize].v0, self.edges[edge as usize].v1);
        self.enable_group(v0, MARK1);
        self.enable_group(v1, MARK1);
        let mut e = edge;
        loop {
            let (a, b) = (self.edges[e as usize].v0, self.edges[e as usize].v1);
            new_verts.push(self.verts[a as usize].vert);
            let mut q = self.quadric(a);
            q.add(&self.quadric(b));
            quadrics.push(q);
            optimizer.add_attr(&q);
            self.verts[a as usize].flags &= !MARK1;
            self.verts[b as usize].flags &= !MARK1;
            e = self.edges[e as usize].next;
            if e == edge {
                break;
            }
        }
        for start in [v0, v1] {
            for v in self.group(start) {
                if self.test(v, MARK1) {
                    new_verts.push(self.verts[v as usize].vert);
                    let q = self.quadric(v);
                    quadrics.push(q);
                    optimizer.add_attr(&q);
                    self.verts[v as usize].flags &= !MARK1;
                }
            }
        }
        let mut edge_quadric = Plane::default();
        for start in [v0, v1] {
            for v in self.group(start) {
                let q = self.edge_quadric(v);
                edge_quadric.add(&q);
            }
        }
        optimizer.plane.add(&edge_quadric);
        let pos = if self.test(v0, LOCKED) {
            wide(self.verts[v0 as usize].vert.pos)
        } else if self.test(v1, LOCKED) {
            wide(self.verts[v1 as usize].vert.pos)
        } else {
            optimizer.optimize().unwrap_or_else(|| {
                let (a, b) = (
                    self.verts[v0 as usize].vert.pos,
                    self.verts[v1 as usize].vert.pos,
                );
                [a[0] + b[0], a[1] + b[1], a[2] + b[2]].map(|c| f64::from(c) * 0.5)
            })
        };
        (new_verts, quadrics, edge_quadric, pos)
    }

    /// The collapse of `edge`'s group priced: the merged vertices at the new position, normals
    /// from their quadrics, and the cost.
    fn new_verts(&mut self, edge: u32) -> (Vec<Vertex>, f32) {
        let (mut new_verts, quadrics, edge_quadric, pos) = self.new_verts_pos(edge);
        let mut cost = 0.0f32;
        for (vert, q) in new_verts.iter_mut().zip(&quadrics) {
            vert.pos = pos.map(|c| c as f32);
            if q.area > 1e-8 {
                vert.normal = unit_or_kept(q.attributes(wide(vert.pos)));
            }
            cost += q.evaluate(wide(vert.pos), vert.normal);
        }
        cost += finite_cost(edge_quadric.evaluate(pos));
        (new_verts, cost)
    }

    /// Whether moving `old_v` to `pos` keeps the triangle facing the same side (`facing`, the
    /// triangle walked from the corner after `old_v`).
    fn replace_is_valid(&self, t: usize, old_v: u32, pos: [f32; 3]) -> bool {
        let verts = self.tris[t].verts;
        let k = (0..2).find(|&k| verts[k] == old_v).unwrap_or(2);
        let corner = |i: usize| self.verts[verts[(k + i) % 3] as usize].vert.pos;
        facing([corner(1), corner(2), corner(0)], 2, pos) > 0.0
    }

    /// The cost of collapsing `edge`: the quadric cost plus the degree and fold penalties; locked
    /// at both ends, the largest float.
    fn collapse_cost(&mut self, edge: u32) -> f32 {
        let (u, v) = (self.edges[edge as usize].v0, self.edges[edge as usize].v1);
        if self.test(u, LOCKED) && self.test(v, LOCKED) {
            return f32::MAX;
        }
        let (new_verts, cost) = self.new_verts(edge);
        let new_pos = new_verts[0].pos;
        let mut penalty = 0.0f32;
        let degree: usize = self
            .group(u)
            .iter()
            .chain(self.group(v).iter())
            .map(|&w| self.verts[w as usize].adj.len())
            .sum();
        if degree > DEGREE_LIMIT {
            penalty += DEGREE_PENALTY * (degree - DEGREE_LIMIT) as f32;
        }
        self.set_adj_tri_flags_group(v, MARK1, true);
        for (start, marked) in [(u, false), (v, true)] {
            for w in self.group(start) {
                for k in 0..self.verts[w as usize].adj.len() {
                    let t = self.verts[w as usize].adj[k] as usize;
                    if (self.tris[t].flags & MARK1 == MARK1) == marked
                        && !self.replace_is_valid(t, w, new_pos)
                    {
                        penalty += INVALID_PENALTY;
                    }
                    self.tris[t].flags &= !MARK1;
                }
            }
        }
        cost + penalty
    }

    /// Collapses `edge`: `u` moved onto `v`.
    fn collapse(&mut self, edge: u32) {
        let (u, v) = (self.edges[edge as usize].v0, self.edges[edge as usize].v1);
        if self.test(u, LOCKED) {
            self.verts[v as usize].flags |= LOCKED;
        }
        self.set_adj_vert_flags(u, MARK1, true);
        self.set_adj_vert_flags(v, MARK1, false);
        if self.test(u, MARK1) {
            self.set_adj_vert_flags(u, MARK1, false);
            return;
        }
        for k in 0..self.verts[u as usize].adj.len() {
            let t = self.verts[u as usize].adj[k] as usize;
            for j in 0..3 {
                let w = self.tris[t].verts[j];
                if self.test(w, MARK1) {
                    self.replace_edge_vert(u, w, Some(v));
                    self.verts[w as usize].flags &= !MARK1;
                }
            }
        }
        self.set_adj_vert_flags(u, MARK1, true);
        self.verts[u as usize].flags &= !MARK1;
        self.verts[v as usize].flags &= !MARK1;
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            for j in 0..3 {
                let w = self.tris[t].verts[j];
                if self.test(w, MARK1) {
                    self.replace_edge_vert(u, w, None);
                    self.verts[w as usize].flags &= !MARK1;
                }
            }
        }
        self.set_adj_vert_flags(u, MARK1, false);
        for k in 0..self.verts[u as usize].adj.len() {
            let t = self.verts[u as usize].adj[k];
            let tri = self.tris[t as usize].verts;
            if tri.contains(&v) {
                self.num_tris -= 1;
                self.tris[t as usize].flags |= REMOVED;
                self.tri_quadrics[t as usize] = None;
                for w in tri {
                    if w != u {
                        remove_adj(&mut self.verts[w as usize].adj, t);
                    }
                }
            } else {
                let slot = tri.iter().position(|&w| w == u).expect("u in its triangle");
                self.tris[t as usize].verts[slot] = v;
                self.verts[v as usize].adj.push(t);
            }
        }
        self.set_adj_vert_flags(v, MARK1, true);
        for k in 0..self.verts[v as usize].adj.len() {
            let t = self.verts[v as usize].adj[k] as usize;
            self.tri_quadrics[t] = None;
            for j in 0..3 {
                let w = self.tris[t].verts[j];
                if self.test(w, MARK1) {
                    self.vert_quadrics[w as usize] = None;
                    self.verts[w as usize].flags &= !MARK1;
                }
            }
        }
        self.verts[u as usize].adj.clear();
        self.verts[u as usize].flags |= REMOVED;
    }

    /// The doubled cross product a triangle is removed by when null.
    fn degenerate(&self, t: usize) -> bool {
        let [p0, p1, p2] = self.tris[t]
            .verts
            .map(|u| wide(self.verts[u as usize].vert.pos));
        let a = sub(p2, p0);
        let b = sub(p1, p0);
        let n = cross(a, b);
        squared_length(n) == 0.0
    }

    fn remove_tri(&mut self, t: u32) {
        self.num_tris -= 1;
        self.tris[t as usize].flags |= REMOVED;
        for w in self.tris[t as usize].verts {
            remove_adj(&mut self.verts[w as usize].adj, t);
        }
    }

    /// The queued triangles: their quadric dropped, removed when degenerate.
    fn update_tris(&mut self) {
        for t in std::mem::take(&mut self.update_tris) {
            if self.tris[t as usize].flags & REMOVED != 0 {
                continue;
            }
            self.tri_quadrics[t as usize] = None;
            if self.degenerate(t as usize) {
                self.remove_tri(t);
            }
        }
    }

    /// The queued vertices: their quadrics dropped, removed when no triangle uses them.
    fn update_verts(&mut self) {
        for v in std::mem::take(&mut self.update_verts) {
            if self.test(v, REMOVED) {
                continue;
            }
            self.vert_quadrics[v as usize] = None;
            self.edge_quadrics[v as usize] = None;
            if self.verts[v as usize].adj.is_empty() {
                self.verts[v as usize].flags |= REMOVED;
                let (n, p) = (self.verts[v as usize].next, self.verts[v as usize].prev);
                self.verts[p as usize].next = n;
                self.verts[n as usize].prev = p;
                self.verts[v as usize].next = v;
                self.verts[v as usize].prev = v;
            }
        }
    }

    /// The queued edges with their groups: removed where an end is gone, regrouped by position,
    /// each group's cost updated on the heap.
    fn update_edges(&mut self) {
        let num = self.update_edges.len();
        for i in 0..num {
            let edge = self.update_edges[i];
            if self.edges[edge as usize].flags & REMOVED != 0 {
                continue;
            }
            let mut e = edge;
            loop {
                add_unique(&mut self.update_edges, e);
                e = self.edges[e as usize].next;
                if e == edge {
                    break;
                }
            }
        }
        for i in 0..self.update_edges.len() {
            let e = self.update_edges[i];
            if self.edges[e as usize].flags & REMOVED != 0 {
                continue;
            }
            let (a, b) = (self.edges[e as usize].v0, self.edges[e as usize].v1);
            if self.test(a, REMOVED) || self.test(b, REMOVED) {
                self.remove_edge(e);
            }
        }
        let mut buckets: WordMap<([u32; 3], [u32; 3]), Vec<usize>> = WordMap::default();
        for i in 0..self.update_edges.len() {
            let e = self.update_edges[i];
            if self.edges[e as usize].flags & REMOVED != 0 {
                continue;
            }
            self.edges[e as usize].next = e;
            self.edges[e as usize].prev = e;
            buckets
                .entry(self.edge_position_key(e))
                .or_default()
                .push(i);
        }
        for i in 0..self.update_edges.len() {
            let e1 = self.update_edges[i];
            if self.edges[e1 as usize].flags & REMOVED != 0 || self.edges[e1 as usize].next != e1 {
                continue;
            }
            let bucket = buckets[&self.edge_position_key(e1)].clone();
            for &j in bucket.iter().rev() {
                let e2 = self.update_edges[j];
                if e1 != e2 {
                    self.link_edge(e1, e2);
                }
            }
        }
        for i in 0..num {
            let edge = self.update_edges[i];
            if self.edges[edge as usize].flags & REMOVED != 0 {
                continue;
            }
            let cost = self.collapse_cost(edge);
            let mut e = edge;
            loop {
                if self.heap.contains(e) {
                    self.heap.update(e, cost);
                }
                e = self.edges[e as usize].next;
                if e == edge {
                    break;
                }
            }
        }
        self.update_edges.clear();
    }

    /// Simplifies: the cheapest edge group collapsed until
    /// the terminator stops, then null triangles and orphaned vertices removed.
    pub(super) fn simplify(&mut self, terminator: Terminator) {
        while let Some((error, top)) = self.heap.peek() {
            if terminator.stop(self.num_tris, error) {
                break;
            }
            self.heap.pop();
            let mut list = vec![top];
            let mut e = self.edges[top as usize].next;
            while e != top {
                list.push(e);
                e = self.edges[e as usize].next;
            }
            if list.iter().any(|&e| {
                let edge = &self.edges[e as usize];
                self.test(edge.v0, LOCKED) && self.test(edge.v1, LOCKED)
            }) {
                continue;
            }
            let (tv0, tv1) = (self.edges[top as usize].v0, self.edges[top as usize].v1);
            for start in [tv0, tv1] {
                for v in self.group(start) {
                    self.gather_updates(v);
                }
            }
            // An edge removed here is skipped below by its flag.
            for &e in &list {
                let (a, b) = (self.edges[e as usize].v0, self.edges[e as usize].v1);
                if self.verts[a as usize].adj.is_empty() || self.verts[b as usize].adj.is_empty() {
                    self.remove_edge(e);
                }
            }
            if self.verts[tv0 as usize].adj.is_empty() || self.verts[tv1 as usize].adj.is_empty() {
                continue;
            }
            // The merged vertices take their new values.
            let (new_verts, _) = self.new_verts(top);
            let mut i = 0;
            self.enable_group(tv0, MARK1);
            self.enable_group(tv1, MARK1);
            let mut e = top;
            loop {
                let (a, b) = (self.edges[e as usize].v0, self.edges[e as usize].v1);
                self.verts[b as usize].vert = new_verts[i];
                i += 1;
                self.verts[a as usize].flags &= !MARK1;
                self.verts[b as usize].flags &= !MARK1;
                e = self.edges[e as usize].next;
                if e == top {
                    break;
                }
            }
            for start in [tv0, tv1] {
                for v in self.group(start) {
                    if self.test(v, MARK1) {
                        self.verts[v as usize].vert = new_verts[i];
                        i += 1;
                        self.verts[v as usize].flags &= !MARK1;
                    }
                }
            }
            for e in list {
                let edge = &self.edges[e as usize];
                if edge.flags & REMOVED != 0
                    || self.verts[edge.v0 as usize].adj.is_empty()
                    || self.verts[edge.v1 as usize].adj.is_empty()
                {
                    continue;
                }
                self.collapse(e);
                self.remove_edge(e);
            }
            // The groups of v0 and v1 joined, the removed vertices taken out.
            let (tv0, tv1) = (self.edges[top as usize].v0, self.edges[top as usize].v1);
            let v0_next = self.verts[tv0 as usize].next;
            let v1_prev = self.verts[tv1 as usize].prev;
            self.verts[v0_next as usize].prev = v1_prev;
            self.verts[v1_prev as usize].next = v0_next;
            self.verts[tv0 as usize].next = tv1;
            self.verts[tv1 as usize].prev = tv0;
            for v in self.group(tv1) {
                if self.test(v, REMOVED) {
                    let (n, p) = (self.verts[v as usize].next, self.verts[v as usize].prev);
                    self.verts[p as usize].next = n;
                    self.verts[n as usize].prev = p;
                    self.verts[v as usize].next = v;
                    self.verts[v as usize].prev = v;
                }
            }
            let group = self.group(tv1);
            let locked = group
                .iter()
                .fold(0, |f, &v| f | (self.verts[v as usize].flags & LOCKED));
            for v in group {
                self.verts[v as usize].flags |= locked;
            }
            self.update_tris();
            self.update_verts();
            self.update_edges();
        }
        for t in 0..self.tris.len() as u32 {
            if self.tris[t as usize].flags & REMOVED != 0 {
                continue;
            }
            if self.degenerate(t as usize) {
                self.remove_tri(t);
            }
        }
        for v in 0..self.verts.len() {
            if self.verts[v].flags & REMOVED != 0 {
                continue;
            }
            if self.verts[v].adj.is_empty() {
                self.verts[v].flags |= REMOVED;
            }
        }
    }

    /// The simplified mesh: the surviving triangles, equal vertices
    /// shared, and the output ids of locked vertices when asked.
    pub(super) fn output(&self, locked: Option<&mut Vec<u32>>) -> (Vec<Vertex>, Vec<u32>) {
        let mut verts: Vec<Vertex> = Vec::new();
        let mut indexes = Vec::new();
        let mut seen: WordMap<[u32; 6], u32> = WordMap::default();
        let mut locked = locked;
        for tri in &self.tris {
            if tri.flags & REMOVED != 0 {
                continue;
            }
            for &w in &tri.verts {
                let vert = &self.verts[w as usize];
                match seen.get(&vert.vert.bits()) {
                    Some(&f) => indexes.push(f),
                    None => {
                        let id = verts.len() as u32;
                        if let Some(list) = locked.as_deref_mut() {
                            if vert.flags & LOCKED == LOCKED {
                                list.push(id);
                            }
                        }
                        seen.insert(vert.vert.bits(), id);
                        verts.push(vert.vert);
                        indexes.push(id);
                    }
                }
            }
        }
        (verts, indexes)
    }
}

/// Removes `t` from an adjacency list: the last element moved into the hole.
fn remove_adj(list: &mut Vec<u32>, t: u32) {
    if let Some(i) = list.iter().position(|&x| x == t) {
        list.swap_remove(i);
    }
}
