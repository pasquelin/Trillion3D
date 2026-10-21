//! Geodesic distances from one vertex to every other across a chart's faces, by window
//! propagation: the exact distance along the surface, not along edges, merged where adjacent
//! windows agree closely enough.
//!
//! A window is an interval `[b0, b1]` of an edge, measured from the edge's `mark` end, over which
//! the distance to the source is the straight distance in the unfolded plane to a pseudo source
//! `src` (a vertex the geodesics bend around, or the source itself) plus that pseudo source's own
//! distance. The source's opposite edges start as whole windows (`start`). The window of least
//! distance is taken from the heap (`merge`, which first joins it with an adjacent window of its
//! edge when the joined window's error stays small) and unfolded across the face beyond its edge
//! (`propagate`): its rays from the pseudo source cover parts of the face's two other edges, and
//! a window ending on a saddle or boundary vertex also spreads from that vertex, into the faces
//! its shadow hides (`shadow`). Each new window is cut against the windows already on its edge
//! (`insert`, `intersect`): where two overlap, the one farther at the overlap's middle gives way.
//! Each window that reaches an edge end lowers that vertex's distance; a vertex no window reached
//! takes the nearest window of its edges at the end.
//!
//! Every quantity is in double precision, from the chart's single-precision points.
use super::mesh::{Chart, NONE};
use super::ranked::{Least, Ranked};
use crate::hlod::flatten::uv::extremes::lesser;
use plane::angle_between;

mod insert;
mod intersect;
mod merge;
mod plane;
mod propagate;
mod shadow;
mod start;

/// A window on an edge.
#[derive(Clone, Copy, Default)]
struct Window {
    edge: u32,
    /// The edge end `b0` and `b1` count from.
    mark: u32,
    /// The pseudo source vertex, `NONE` for a merged window's.
    pseudo: u32,
    b0: f64,
    b1: f64,
    d0: f64,
    d1: f64,
    /// The pseudo source in the edge's plane frame: the mark end at the origin, the edge along x.
    src: [f64; 2],
    pseudo_distance: f64,
    /// The face the window was unfolded from.
    from_face: u32,
    /// The error merging accumulated.
    ksi: f64,
}

/// Where a window on an edge stands in the heap.
#[derive(Clone, Copy, PartialEq)]
enum Link {
    Out,
    Held(u32),
    Dropped,
}

#[derive(Clone)]
struct Listed {
    link: Link,
    window: Window,
}

#[derive(Clone)]
struct Vertex {
    p: [f64; 3],
    boundary: bool,
    /// The sum of its corner angles.
    angle: f64,
    /// How far from this vertex the window that gave its distance ends.
    window_gap: f64,
    distance: f64,
    used: bool,
    shadow: bool,
    edges: Vec<u32>,
}

#[derive(Clone)]
struct Edge {
    verts: [u32; 2],
    /// The faces on its two sides, `NONE` for a missing one.
    faces: [u32; 2],
    length: f64,
    windows: Vec<Listed>,
}

#[derive(Clone)]
struct Face {
    edges: [u32; 3],
    verts: [u32; 3],
}

/// The window propagation over one chart.
#[derive(Clone)]
pub(crate) struct Windows {
    verts: Vec<Vertex>,
    edges: Vec<Edge>,
    faces: Vec<Face>,
    heap: Ranked<Least<f64>>,
    /// The window each heap entry holds.
    held: Vec<Window>,
    /// The heap entries free for reuse.
    free: Vec<u32>,
}

impl Vertex {
    /// Whether the geodesics may bend around this vertex: a boundary vertex, or one whose corner
    /// angles sum to more than a full turn.
    fn saddle_or_boundary(&self) -> bool {
        self.boundary || self.angle > (2.0 * std::f32::consts::PI) as f64
    }
}

impl Edge {
    /// The end of the edge that is not `v`.
    fn other_end(&self, v: u32) -> u32 {
        self.verts[0] ^ self.verts[1] ^ v
    }

    /// The face across the edge from face `f`.
    fn other_face(&self, f: u32) -> u32 {
        self.faces[0] ^ self.faces[1] ^ f
    }

    fn is_boundary(&self) -> bool {
        self.faces[0] == NONE || self.faces[1] == NONE
    }
}

impl Face {
    /// The face's edge opposite vertex `v`.
    fn edge_opposite(&self, v: u32, edges: &[Edge]) -> u32 {
        for &e in &self.edges[..2] {
            if !edges[e as usize].verts.contains(&v) {
                return e;
            }
        }
        self.edges[2]
    }

    /// The face's two edges other than `e`, in face order.
    fn other_edges(&self, e: u32) -> [u32; 2] {
        let [a, b, c] = self.edges;
        if e == a {
            [b, c]
        } else if e == b {
            [a, c]
        } else {
            [a, b]
        }
    }
}

impl Windows {
    /// The propagation's mesh, from a chart's vertices, edges and faces.
    pub(crate) fn from_chart(chart: &Chart) -> Windows {
        let mut verts: Vec<Vertex> = (0..chart.verts.len() as u32)
            .map(|v| Vertex {
                p: chart.point(v).map(|x| x as f64),
                boundary: chart.verts[v as usize].boundary,
                angle: 0.0,
                window_gap: f32::MAX as f64,
                distance: f32::MAX as f64,
                used: false,
                shadow: false,
                edges: Vec::new(),
            })
            .collect();
        let edges: Vec<Edge> = (chart.edges.iter().enumerate())
            .map(|(i, e)| {
                let (a, b) = (verts[e.verts[0] as usize].p, verts[e.verts[1] as usize].p);
                verts[e.verts[0] as usize].edges.push(i as u32);
                verts[e.verts[1] as usize].edges.push(i as u32);
                Edge {
                    verts: e.verts,
                    faces: e.faces,
                    length: plane::distance(a, b),
                    windows: Vec::new(),
                }
            })
            .collect();
        let faces: Vec<Face> = (chart.faces.iter())
            .map(|f| {
                let [a, b, c] = f.verts.map(|v| verts[v as usize].p);
                verts[f.verts[2] as usize].angle += angle_between(c, a, b);
                verts[f.verts[1] as usize].angle += angle_between(b, a, c);
                verts[f.verts[0] as usize].angle += angle_between(a, b, c);
                for v in f.verts {
                    verts[v as usize].used = true;
                }
                Face {
                    edges: f.edges,
                    verts: f.verts,
                }
            })
            .collect();
        Windows {
            verts,
            edges,
            faces,
            heap: Ranked::new(0),
            held: Vec::new(),
            free: Vec::new(),
        }
    }

    /// The distance from the last run's source to vertex `v`.
    pub(crate) fn distance(&self, v: usize) -> f64 {
        self.verts[v].distance
    }

    /// `window` put in the heap, keyed by its least distance; its entry.
    fn hold(&mut self, window: Window) -> u32 {
        let key = lesser(window.d0, window.d1) + window.pseudo_distance;
        let id = self.free.pop().unwrap_or(self.held.len() as u32);
        if id as usize == self.held.len() {
            self.held.push(window);
        } else {
            self.held[id as usize] = window;
        }
        self.heap.insert(id, Least(key));
        id
    }

    /// Heap entry `id` taken out and freed.
    fn release(&mut self, id: u32) {
        self.heap.remove(id);
        self.free.push(id);
    }
}
