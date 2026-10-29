//! A chart: a piece of the input surface with its own vertices, faces and edges, each linked to
//! the root mesh it came from and to the chart it was cut from, and what the partition learns of
//! it as it goes — its plane coordinates, its landmarks and spectrum, its stretch, its children
//! once it is cut.
//!
//! The measures every step shares live in `common` (areas, edge lengths, signal lengths, the
//! overlap test, a child's construction) and `bounds` (rotations and bounding boxes).
use super::source::Source;
use super::spectrum::Spectrum;

mod bounds;
mod common;

/// No vertex, face, edge or index.
pub(crate) const NONE: u32 = u32::MAX;
/// The importance of a vertex that must stay in every simplification.
pub(crate) const KEEP: i32 = -1;
/// The spectrum's dimensions computed for a chart never cut before.
pub(crate) const FIRST_EIGEN_DIMENSION: usize = 10;
/// The fewest landmarks a spectral analysis takes; a chart with fewer vertices keeps them all.
pub(crate) const MIN_LANDMARKS: usize = 25;

#[derive(Clone, Default)]
pub(crate) struct Vert {
    /// Its index in this chart.
    pub id: u32,
    /// Its vertex in the root chart.
    pub root: u32,
    /// Its vertex in the chart this one was cut from.
    pub parent: u32,
    pub uv: [f32; 2],
    pub landmark: bool,
    /// For a landmark, its place in the landmark list.
    pub landmark_slot: u32,
    pub boundary: bool,
    /// The order a simplification removes it in, `KEEP` when it must stay.
    pub importance: i32,
    /// The distance to the current source along the edges (`cut`'s search).
    pub geodesic: f32,
    /// The vertices it shares an edge with, in ring order.
    pub verts: Vec<u32>,
    /// The faces around it, in ring order.
    pub faces: Vec<u32>,
    /// The edges around it, in ring order.
    pub edges: Vec<u32>,
    /// The next vertex on the shortest edge path to the current source.
    pub next: u32,
}

impl Vert {
    /// The vertex `old` of the chart this one is cut from, as vertex `id` of the new chart: it
    /// keeps its place in the root chart and its importance, and its rings are left to rebuild.
    pub(crate) fn cut_from(id: usize, old: &Vert) -> Self {
        Self {
            id: id as u32,
            root: old.root,
            parent: old.id,
            boundary: old.boundary,
            importance: old.importance,
            ..Self::default()
        }
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Face {
    /// Its index in this chart.
    pub id: u32,
    /// Its face in the root chart, the input's face.
    pub root: u32,
    /// Its face in the chart this one was cut from.
    pub parent: u32,
    pub verts: [u32; 3],
    /// Its edges, the k-th from corner k to corner k + 1.
    pub edges: [u32; 3],
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Edge {
    /// Its index in this chart.
    pub id: u32,
    pub verts: [u32; 2],
    /// The faces on its two sides, the second `NONE` on a boundary.
    pub faces: [u32; 2],
    /// Per side, the face's corner opposite the edge.
    pub opposite: [u32; 2],
    pub length: f32,
    /// The length weighed by the signal.
    pub signal_length: f32,
    pub boundary: bool,
    /// Whether a cut may run along it: every edge may but a false edge, which only splits a
    /// polygon of the input into triangles.
    pub splittable: bool,
}

impl Edge {
    /// The end of the edge that is not `v`, one of its two.
    pub(crate) fn other_end(&self, v: u32) -> u32 {
        other_of(self.verts, v)
    }

    /// The face across the edge from face `f`, one of its two (`NONE` across a boundary).
    pub(crate) fn other_face(&self, f: u32) -> u32 {
        other_of(self.faces, f)
    }
}

/// The member of the pair that is not `one`, one of the two.
pub(crate) fn other_of(pair: [u32; 2], one: u32) -> u32 {
    pair[0] ^ pair[1] ^ one
}

pub(crate) struct Chart<'a> {
    pub source: &'a Source,
    pub verts: Vec<Vert>,
    pub faces: Vec<Face>,
    pub edges: Vec<Edge>,
    /// The diagonal of the root mesh's bounding box.
    pub diagonal: f32,
    /// The charts this one borders, during a border's graph cut and during the merge.
    pub neighbours: Vec<u32>,
    pub children: Vec<Chart<'a>>,
    pub spectrum: Spectrum,
    pub landmarks: Vec<u32>,
    /// The parameterisation's mean squared stretch.
    pub stretch_l2: f32,
    /// The least mean squared stretch any parameterisation of the chart can reach.
    pub base_l2: f32,
    /// The geometric mean squared stretch, with a signal.
    pub geometric_l2: f32,
    /// Whether this chart was cut from a chart the partition split.
    pub sub_chart: bool,
    pub area_2d: f32,
    pub area_3d: f32,
    pub parameterized: bool,
    pub l2_optimized: bool,
    /// Whether the landmarks' first two are the two farthest apart in the plane.
    pub landmarks_ordered: bool,
    /// Whether the faces may form bowties to break on the next build.
    pub needs_clean: bool,
}

impl<'a> Chart<'a> {
    /// An empty chart over `source`.
    pub(crate) fn new(source: &'a Source) -> Chart<'a> {
        Chart {
            source,
            verts: Vec::new(),
            faces: Vec::new(),
            edges: Vec::new(),
            diagonal: 0.0,
            neighbours: Vec::new(),
            children: Vec::new(),
            spectrum: Spectrum::default(),
            landmarks: Vec::new(),
            stretch_l2: 0.0,
            base_l2: 0.0,
            geometric_l2: 0.0,
            sub_chart: false,
            area_2d: 0.0,
            area_3d: 0.0,
            parameterized: false,
            l2_optimized: false,
            landmarks_ordered: false,
            needs_clean: false,
        }
    }

    /// Whether the partition weighs a signal.
    pub(crate) fn has_signal(&self) -> bool {
        self.source.has_signal()
    }

    /// Whether any vertex lies on a boundary.
    pub(crate) fn has_boundary_vertex(&self) -> bool {
        self.verts.iter().any(|v| v.boundary)
    }

    /// The signal tensor of the root face `root`.
    pub(crate) fn tensor(&self, root: u32) -> Option<&'a [f32; 3]> {
        let source: &'a Source = self.source;
        source.signal.as_ref().map(|s| &s[root as usize])
    }

    /// The scaled position of a chart vertex.
    pub(crate) fn point(&self, v: u32) -> [f32; 3] {
        self.source.points[self.verts[v as usize].root as usize]
    }
}
