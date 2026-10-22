//! The surface every chart of one partition reads: the input as given, and what is measured on it
//! once before the charts are built.
//!
//! 1. The points are centred on their bounding box and scaled so its longest side measures 500
//!    (a box of no size is scaled as if that side measured 1); the box's diagonal is measured
//!    after the scale.
//! 2. Each face gets its normal (the cross product of its first corner's two edges divided by its
//!    length, left as is when that length is zero), its area (half that length) summed into the
//!    mesh's area, and, when a signal is given, its canonical frame (`util::canonical_frame`).
//! 3. The adjacency is copied twice: once as given, read by the merge, once to be cut along the
//!    shared edges while the root chart is built.
//!
//! The expected stretch is set by the partition as it goes, and the random generator's state is
//! shared by every chart: both live in cells, the rest never changes once built.
use super::draw::UNSEEDED;
use super::util::canonical_frame;
use super::ChartQuality;
use crate::hlod::flatten::uv::extremes::greater;
use std::cell::Cell;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{length, sub};

/// The side of the cube the points are scaled into.
const MODEL_SCALE: f32 = 500.0;
/// How many faces flip in a chart is tolerated: none.
const OVERTURN_TOLERANCE: f32 = 0.0;
/// The least mean squared stretch the signal optimisation aims for.
const MIN_EXPECTED_L2: f32 = 0.0;

pub(crate) struct Source {
    /// The points centred and scaled.
    pub points: Vec<[f32; 3]>,
    pub vertex_count: usize,
    pub face_count: usize,
    /// Per face, its signal tensor; `None` when no signal is given.
    pub signal: Option<Vec<[f32; 3]>>,
    /// The adjacency as given, 3 per face.
    pub given_adjacency: Vec<u32>,
    /// The adjacency the root chart's build cuts along shared edges, 3 per face.
    pub adjacency: Vec<u32>,
    /// Per face, 3 entries, `u32::MAX` where the edge is a true edge, else a false edge (one that
    /// only splits an input polygon into triangles); `None` when no table is given.
    pub false_edges: Option<Vec<u32>>,
    pub normals: Vec<[f32; 3]>,
    pub areas: Vec<f32>,
    /// Per face, the plane corners of its canonical frame; empty without a signal.
    pub canonical_uvs: Vec<[[f32; 2]; 3]>,
    /// Per face, the frame's x and y axes in space; empty without a signal.
    pub canonical_axes: Vec<[[f32; 3]; 2]>,
    /// The sum of the face areas.
    pub area: f32,
    /// The diagonal of the scaled points' bounding box.
    pub diagonal: f32,
    pub overturn_tolerance: f32,
    /// The mean squared stretch the partition currently aims for.
    pub expected_l2: Cell<f32>,
    pub expected_min_l2: f32,
    pub quality: ChartQuality,
    /// The random generator's state (`draw`).
    pub draw: Cell<u32>,
}

impl Source {
    pub(crate) fn new(
        positions: &[[f32; 3]],
        indices: &[u32],
        signal: Option<&[f32]>,
        adjacency: &[u32],
        false_edges: Option<&[u32]>,
        quality: ChartQuality,
    ) -> Source {
        let face_count = indices.len() / 3;
        let (points, diagonal) = scaled(positions);
        let signal = signal.map(|s| s.as_chunks::<3>().0.to_vec());
        let mut source = Source {
            points,
            vertex_count: positions.len(),
            face_count,
            signal,
            given_adjacency: adjacency.to_vec(),
            adjacency: adjacency.to_vec(),
            false_edges: false_edges.map(<[u32]>::to_vec),
            normals: Vec::with_capacity(face_count),
            areas: Vec::with_capacity(face_count),
            canonical_uvs: Vec::new(),
            canonical_axes: Vec::new(),
            area: 0.0,
            diagonal,
            overturn_tolerance: OVERTURN_TOLERANCE,
            expected_l2: Cell::new(0.0),
            expected_min_l2: MIN_EXPECTED_L2,
            quality,
            draw: Cell::new(UNSEEDED),
        };
        source.measure_faces(indices);
        source
    }

    /// Each face's normal, area and, with a signal, canonical frame; the mesh's area.
    fn measure_faces(&mut self, indices: &[u32]) {
        for face in indices.as_chunks::<3>().0 {
            let p = [0, 1, 2].map(|k| self.points[face[k] as usize]);
            let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
            let double_area = length(n);
            let area = double_area * 0.5;
            self.areas.push(area);
            self.area += area;
            self.normals.push(if double_area > 0.0 {
                n.map(|v| v / double_area)
            } else {
                n
            });
            if self.signal.is_some() {
                let (uvs, axes) = canonical_frame(p);
                self.canonical_uvs.push(uvs);
                self.canonical_axes.push(axes);
            }
        }
    }

    /// Whether a signal is given.
    pub(crate) fn has_signal(&self) -> bool {
        self.signal.is_some()
    }
}

/// The points centred on their bounding box and scaled into the cube, and the scaled box's
/// diagonal.
fn scaled(positions: &[[f32; 3]]) -> (Vec<[f32; 3]>, f32) {
    let mut low = [f32::MAX; 3];
    let mut high = [-f32::MAX; 3];
    for p in positions {
        for j in 0..3 {
            if low[j] > p[j] {
                low[j] = p[j];
            }
            if high[j] < p[j] {
                high[j] = p[j];
            }
        }
    }
    let center = [0, 1, 2].map(|j| (low[j] + high[j]) / 2.0);
    let side = greater(
        high[0] - low[0],
        greater(high[1] - low[1], high[2] - low[2]),
    );
    let scale = MODEL_SCALE / if side <= 0.0 { 1.0 } else { side };
    let place = |p: [f32; 3]| [0, 1, 2].map(|j| (p[j] - center[j]) * scale);
    let points = positions.iter().map(|&p| place(p)).collect();
    let diagonal = length(sub(place(high), place(low)));
    (points, diagonal)
}
