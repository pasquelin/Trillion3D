//! The quadric edge collapse simplifier (Garland & Heckbert 1997) on a vertex holding a position
//! and a normal (three attributes): area weighted quadrics with attribute gradients (Hoppe 1999)
//! and a volume constraint (Lindstrom & Turk 1998), boundary edge quadrics of weight 256, a degree
//! penalty past 24 and a fold penalty of 1e7, the edges in a binary heap keyed by cost, vertices
//! and edges sharing a position grouped so a seam collapses as one. Elements are indices into flat
//! arrays, and the order every list is walked in is fixed, so the result is deterministic.
//! Its stages live in children: attribute gradients (`attributes`), the optimal point (`optimizer`),
//! neighbourhoods and seams (`groups`), the edge table (`edges`), a collapse's cost (`cost`), the
//! collapse itself (`collapse`) and the loop (`run`).
use super::super::heap::Heap;
use super::super::quadric::Plane;
use trillion3d_math::triangle::edge_key;
use trillion3d_math::vec3::unit_where_squared;
use trillion3d_page_codec::hash::{word_map, WordMap};
mod attributes;
use attributes::SMALL_NUMBER;
mod collapse;
mod cost;
mod edges;
mod groups;
mod optimizer;
mod run;
pub(super) use attributes::QuadricAttr;

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
