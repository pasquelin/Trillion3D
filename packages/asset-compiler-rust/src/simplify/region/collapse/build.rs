//! The simplifier built from its input: the vertex floats laid position then attributes, the
//! corners and vertices listed by position, every edge's pair of positions listed once, the
//! corners at a locked position flagged, and the per-material area tally sized only when the
//! solve keeps the area.
use super::merge::Scratch;
use super::positions::ByPosition;
use super::{Input, Simplifier, LOCKED};
use crate::simplify::region::prepare::MATERIAL_MASK;
use crate::simplify::region::quadric::{self, EdgeQuadric};
use trillion3d_math::geometry::triangle::next_corner;
use trillion3d_math::heap::IndexedHeap;

impl Simplifier {
    pub fn new(input: &Input) -> Self {
        let m = input.weights.len();
        let verts_count = input.positions.len() / 3;
        let mut verts = Vec::with_capacity(verts_count * (3 + m));
        for v in 0..verts_count {
            verts.extend_from_slice(&input.positions[v * 3..v * 3 + 3]);
            verts.extend_from_slice(&input.values[v * m..(v + 1) * m]);
        }
        let corners = input.triangles.len();
        let tris = corners / 3;
        // One entry per material up to the largest, counted only when the solve keeps the area.
        let counted_materials = match input.keep_area {
            true => (input.materials.iter())
                .map(|&word| (word & MATERIAL_MASK) as usize + 1)
                .max()
                .unwrap_or(0),
            false => 0,
        };
        let mut s = Self {
            m,
            verts,
            indexes: input.triangles.to_vec(),
            materials: input.materials.to_vec(),
            weights: input.weights.to_vec(),
            corrected: input.corrected,
            zero_weights: input.weights.contains(&0.0),
            vert_hash: ByPosition::default(),
            corner_hash: ByPosition::default(),
            vert_refs: vec![0; verts_count],
            corner_flags: vec![0; corners],
            tri_removed: vec![false; tris],
            remaining_verts: verts_count,
            remaining_tris: tris,
            pairs: Vec::new(),
            pair_hash0: ByPosition::default(),
            pair_hash1: ByPosition::default(),
            heap: IndexedHeap::default(),
            moved_verts: Vec::new(),
            moved_corners: Vec::new(),
            moved_pairs: Vec::new(),
            reevaluate: Vec::new(),
            tri_quadrics: vec![0.0; tris * quadric::size(m)],
            edge_quadrics: vec![EdgeQuadric::default(); corners],
            edge_valid: vec![false; corners],
            backup: None,
            total_area: 0.0,
            max_error: 0.0,
            started: false,
            scratch: Scratch::default(),
            edge_length_bound: input.edge_length_bound,
            keep_area: input.keep_area,
            area_change: vec![0.0; counted_materials],
            near_verts: Vec::new(),
            near_pairs: Vec::new(),
        };
        for v in 0..verts_count as u32 {
            let p = s.position(v);
            s.vert_hash.add(p, v);
        }
        for corner in 0..corners {
            let vert = s.indexes[corner];
            s.vert_refs[vert as usize] += 1;
            let p = s.position(vert);
            s.corner_hash.add(p, corner as u32);
            let next = s.position(s.indexes[next_corner(corner)]);
            let mut pair = [p, next];
            let index = s.pairs.len() as u32;
            if s.add_unique_pair(&mut pair, index) {
                s.pairs.push(pair);
            }
        }
        for (v, &locked) in input.locked.iter().enumerate() {
            if locked {
                let p = s.position(v as u32);
                for &corner in s.corner_hash.at(p) {
                    s.corner_flags[corner as usize] |= LOCKED;
                }
            }
        }
        s
    }
}
