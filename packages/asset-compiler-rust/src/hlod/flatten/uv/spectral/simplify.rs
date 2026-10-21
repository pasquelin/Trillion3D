//! The order a quadric-error simplification removes a chart's vertices in: a vertex's importance,
//! from which the landmarks of the spectral analysis are chosen.
//!
//! A copy of the chart is collapsed edge by edge (`collapse`), each edge's cost the square root of
//! the quadric error at the end it keeps, the boundary end kept when only one end lies on the
//! boundary (`quadric`). Each face contributes the quadric of its plane, each boundary edge the
//! quadric of the plane through it perpendicular to its face, so the boundary keeps its shape.
//! The cheapest edge goes first, unless its collapse would make a face a segment (refused) or
//! flip a face (its cost raised a hundredfold and the edge put back). The collapses stop at 85
//! vertices or at a cost of 0.9 times the chart's diagonal; past the cost the remaining edges are
//! collapsed regardless of geometry down to 85 vertices. The removed vertex of the k-th collapse
//! gets importance k; the vertices left keep `KEEP` (`update` carries out a collapse).
use super::mesh::{Chart, KEEP};
use super::source::Source;

mod collapse;
mod quadric;
mod update;

/// A plane's quadric error, `xᵀ A x + 2 bᵀ x + c`.
#[derive(Clone, Copy, Default)]
struct Quadric {
    a: [[f64; 3]; 3],
    b: [f64; 3],
    c: f64,
}

struct Vertex {
    root: u32,
    importance: i32,
    boundary: bool,
    verts: Vec<u32>,
    faces: Vec<u32>,
    edges: Vec<u32>,
    /// The planes whose quadrics this vertex sums.
    quadrics: Vec<u32>,
    error: Quadric,
    deleted: bool,
}

struct Face {
    verts: [u32; 3],
    edges: [u32; 3],
    normal: [f32; 3],
    deleted: bool,
}

struct Edge {
    verts: [u32; 2],
    faces: [u32; 2],
    opposite: [u32; 2],
    boundary: bool,
    cost: f64,
    /// Which end the collapse removes, 0 or 1.
    removes: u32,
    deleted: bool,
}

pub(crate) struct Simplifier<'s> {
    source: &'s Source,
    verts: Vec<Vertex>,
    faces: Vec<Face>,
    edges: Vec<Edge>,
    quadrics: Vec<Quadric>,
    diagonal: f32,
}

impl<'s> Simplifier<'s> {
    /// The chart copied and every quadric, vertex error and edge cost measured.
    pub(crate) fn new(source: &'s Source, chart: &Chart) -> Simplifier<'s> {
        let verts = (chart.verts.iter())
            .map(|v| Vertex {
                root: v.root,
                importance: KEEP,
                boundary: v.boundary,
                verts: v.verts.clone(),
                faces: v.faces.clone(),
                edges: v.edges.clone(),
                quadrics: Vec::new(),
                error: Quadric::default(),
                deleted: false,
            })
            .collect();
        let faces = (chart.faces.iter())
            .map(|f| Face {
                verts: f.verts,
                edges: f.edges,
                normal: source.normals[f.root as usize],
                deleted: false,
            })
            .collect();
        let edges = (chart.edges.iter())
            .map(|e| Edge {
                verts: e.verts,
                faces: e.faces,
                opposite: e.opposite,
                boundary: e.boundary,
                cost: 0.0,
                removes: 0,
                deleted: false,
            })
            .collect();
        let mut simplifier = Simplifier {
            source,
            verts,
            faces,
            edges,
            quadrics: Vec::new(),
            diagonal: chart.diagonal,
        };
        simplifier.measure();
        simplifier
    }

    /// The importance vertex `v` was given.
    pub(crate) fn importance(&self, v: usize) -> i32 {
        self.verts[v].importance
    }

    /// The scaled position of a vertex.
    fn point(&self, v: u32) -> [f32; 3] {
        self.source.points[self.verts[v as usize].root as usize]
    }
}
