//! The simplifier of the cluster DAG: edge collapses ordered by quadric error (Garland &
//! Heckbert 1997) over vertices carrying their attributes (Hoppe 1999, 2000).
//!
//! **Vertices and positions.** A vertex is a position with its attributes; several vertices may
//! share a position — the two sides of a texture seam or of a hard edge. A collapse merges two
//! positions: every vertex at either moves to the merged position. The vertices a triangle joins
//! across the collapsing edge form a wedge (the triangles around either position that share one
//! vertex there, joined through the triangles holding both): each wedge solves its own attributes
//! at the merged position from the sum of its triangles' quadrics. Once moved, vertices equal in
//! every float are one vertex, and a triangle repeating another goes.
//!
//! **Quadrics.** Every triangle's quadric is computed from the triangle as it is now, again after
//! every collapse that touches it; a wedge's is the sum of its live triangles', and a merge adds
//! the edge quadric of every open or attribute border edge at its two positions: the distance to
//! the edge's line, weighted by twice its length — half that on an attribute seam, whose twin
//! counts the other half.
//!
//! **Placement.** The merged position is the one of least error that keeps the volume, else the
//! one of least error, else the best on the edge, else the edge's middle — each kept only if it
//! stays near the neighbourhood (within twice its box's diagonal of it) and turns no triangle
//! around. A locked position is the merged position, whatever it costs.
//!
//! **Cost.** A collapse costs its wedges' errors plus its border edges' error. Each wedge's error
//! is at most its area, the total at most the area it touches, and a collapse taking a piece's
//! last triangles costs that area — a small piece goes as cheaply as it is small. Under an edge
//! length bound (`SolveRules`), it costs at least the square of each edge it makes over the
//! bound. The queue adds penalties — a vertex of more than 24 triangles, two locked positions
//! merged, a triangle turned around — and pops the cheapest. The error published is the largest
//! cost made, penalties aside. If the collapses run out above the target, triangles are removed
//! in order until it is met, and the region's largest triangle is put back if none remains.
//!
//! **Area.** A solve that keeps the area (`SolveRules::keep_area`) counts at every collapse made,
//! per material, the area its triangles gained and lost, then pushes the material that lost the
//! most outwards along its open border by what it lost (`area.rs`).
//!
//! **Data.** Flat arrays: vertex floats (position then attributes), corner indices, per-corner
//! flags, per-triangle quadrics, per-corner edge quadrics; vertices, corners and candidate pairs
//! found by position through position-keyed lists, newest first, built from the input
//! (`build.rs`).
pub(crate) mod area;
mod build;
pub(crate) mod fixup;
pub(crate) mod merge;
pub(crate) mod moves;
mod positions;
pub(crate) mod run;
use super::quadric::{self, EdgeQuadric, V3};
use crate::simplify::Corrected;

use crate::simplify::region::collapse::merge::Scratch;
use crate::simplify::region::collapse::positions::{hash_position, ByPosition};
use trillion3d_math::geometry::triangle::next_corner;
use trillion3d_math::heap::{IndexedHeap, LeastRightUnlessLeftLess};

const NONE: u32 = u32::MAX;

/// Corner flags: merging at the pair's first or second position, triangle gathered, position
/// locked.
const MERGE_MASK: u8 = 3;
const ADJ_TRI: u8 = 1 << 2;
const LOCKED: u8 = 1 << 3;

const DEGREE_LIMIT: i32 = 24;
const DEGREE_PENALTY: f32 = 0.5;
const LOCK_PENALTY: f32 = 1e8;
const INVERSION_PENALTY: f32 = 100.0;
/// The weight of a border edge's quadric per unit of its length.
const EDGE_WEIGHT: f32 = 2.0;

pub(crate) type P = [f32; 3];

/// What the simplifier is built from.
pub(crate) struct Input<'a> {
    /// Positions in the frame, three per vertex.
    pub positions: &'a [f32],
    /// Attributes, `weights.len()` per vertex, as written.
    pub values: &'a [f32],
    /// The weight of each attribute float in the error.
    pub weights: &'a [f32],
    pub corrected: Corrected,
    /// Per vertex: its position is locked.
    pub locked: &'a [bool],
    /// Three vertices per triangle.
    pub triangles: &'a [u32],
    /// Per triangle: two triangles of different materials do not share an edge.
    pub materials: &'a [u32],
    /// The bound on the edges a collapse makes, in the frame; zero for none (`SolveRules`).
    pub edge_length_bound: f32,
    /// Whether the solve keeps the area (`SolveRules::keep_area`): only then do the collapses
    /// count the area each material gains and loses.
    pub keep_area: bool,
}

/// The region's largest triangle, put back if the simplification leaves none.
struct Backup {
    floats: Vec<f32>,
    material: u32,
    pub(crate) area: f32,
}

pub(crate) struct Simplifier {
    m: usize,
    verts: Vec<f32>,
    indexes: Vec<u32>,
    materials: Vec<u32>,
    weights: Vec<f32>,
    corrected: Corrected,
    zero_weights: bool,
    vert_hash: ByPosition,
    corner_hash: ByPosition,
    vert_refs: Vec<u32>,
    corner_flags: Vec<u8>,
    tri_removed: Vec<bool>,
    remaining_verts: usize,
    remaining_tris: usize,
    pairs: Vec<[P; 2]>,
    pair_hash0: ByPosition,
    pair_hash1: ByPosition,
    heap: IndexedHeap<LeastRightUnlessLeftLess>,
    moved_verts: Vec<u32>,
    moved_corners: Vec<u32>,
    moved_pairs: Vec<u32>,
    reevaluate: Vec<u32>,
    tri_quadrics: Vec<f64>,
    edge_quadrics: Vec<EdgeQuadric>,
    edge_valid: Vec<bool>,
    backup: Option<Backup>,
    total_area: f32,
    /// The largest cost the collapses made so far, penalties aside, and whether `simplify` has
    /// run: a later call goes on from where the last one stopped (`simplify`).
    max_error: f32,
    started: bool,
    scratch: Scratch,
    edge_length_bound: f32,
    keep_area: bool,
    /// Per material (`prepare::MATERIAL_MASK`), the area the collapses made gained less the area
    /// they lost (`moves.rs`): negative where a material thinned; empty unless `keep_area`.
    area_change: Vec<f32>,
    /// Kept between collapses made: the vertices around and the pairs at one.
    near_verts: Vec<u32>,
    near_pairs: Vec<u32>,
}

impl Simplifier {
    fn stride(&self) -> usize {
        3 + self.m
    }
    fn position(&self, vert: u32) -> P {
        position(&self.verts, self.m, vert)
    }
    pub(crate) fn attributes(&self, vert: u32) -> &[f32] {
        attributes(&self.verts, self.m, vert)
    }
    fn quadric(&self, tri: usize) -> &[f64] {
        let size = quadric::size(self.m);
        &self.tri_quadrics[tri * size..(tri + 1) * size]
    }

    /// Lists `pair` unless an equal pair is listed, its two positions ordered by their hash;
    /// whether it was listed.
    fn add_unique_pair(&mut self, pair: &mut [P; 2], index: u32) -> bool {
        if hash_position(pair[0]) > hash_position(pair[1]) {
            pair.swap(0, 1);
        }
        let duplicate = self.pair_hash0.at(pair[0]).iter().rev().any(|&other| {
            let o = &self.pairs[other as usize];
            o[0] == pair[0] && o[1] == pair[1]
        });
        if duplicate {
            return false;
        }
        self.pair_hash0.add(pair[0], index);
        self.pair_hash1.add(pair[1], index);
        true
    }

    /// Calls `f` on every pair with an end at `p`: those it starts, then those it ends, each
    /// list newest first.
    fn for_pairs_at(&self, p: P, mut f: impl FnMut(u32)) {
        for &i in self.pair_hash0.at(p).iter().rev() {
            if self.pairs[i as usize][0] == p {
                f(i);
            }
        }
        for &i in self.pair_hash1.at(p).iter().rev() {
            if self.pairs[i as usize][1] == p {
                f(i);
            }
        }
    }

    /// Whether a live triangle runs the edge from `p0` to `p1` back, from `p1` to `p0`.
    fn runs_back(&self, p0: P, p1: P) -> bool {
        (self.corner_hash.at(p1).iter()).any(|&corner| {
            let corner = corner as usize;
            p0 == self.position(self.indexes[next_corner(corner)])
                && p1 == self.position(self.indexes[corner])
        })
    }

    /// The live triangles, three vertices each, in triangle order.
    pub fn remaining(&self) -> Vec<u32> {
        let live = (0..self.tri_removed.len()).filter(|&t| !self.tri_removed[t]);
        live.flat_map(|t| self.indexes[t * 3..t * 3 + 3].iter().copied())
            .collect()
    }
    /// Vertex `vert`'s position in the frame and its attributes.
    pub fn vertex(&self, vert: usize) -> (P, &[f32]) {
        (self.position(vert as u32), self.attributes(vert as u32))
    }
}

/// Vertex `vert`'s position in `verts`, `m` attribute floats after each position.
fn position(verts: &[f32], m: usize, vert: u32) -> P {
    let at = vert as usize * (3 + m);
    [verts[at], verts[at + 1], verts[at + 2]]
}
/// Vertex `vert`'s attributes in `verts`.
pub(crate) fn attributes(verts: &[f32], m: usize, vert: u32) -> &[f32] {
    let at = vert as usize * (3 + m) + 3;
    &verts[at..at + m]
}

/// A position as doubles, measured from `origin` in single precision.
fn about(p: P, origin: P) -> V3 {
    quadric::wide(trillion3d_math::vector::vecn::sub(p, origin))
}
