//! The borders between a chart's children moved by graph cuts.
//!
//! Each child's fuzzy region (`fuzzy`): its vertices on a border its parent does not have, grown
//! ring by ring over the child; the faces around the outer 70% of the rings (rounded) stay fixed.
//! Between every two neighbouring children, the fuzzy faces of either are the nodes of a graph
//! whose links cross their shared edges and whose terminals tie a fuzzy face to the fixed
//! neighbour's child (`flow`); the minimum cut relabels them.
//!
//! - By the dihedral angle (`angle`): a link weighs `1 / (1 + d / mean d)`, `d = 1 − n1·n2` of the
//!   two faces' normals; the cut runs twice.
//! - By the stretch (`stretch`, `distortion`): each child's local landmarks are embedded in two
//!   dimensions; a link also weighs how differently the two children's embeddings distort the
//!   faces on either side.
//!
//! The new labels replace the old unless one label took every face; they are then made valid,
//! and a labelling that cannot be made valid leaves the border as it was.
use crate::hlod::flatten::uv::spectral::mesh::{Chart, Edge, NONE};
use crate::hlod::flatten::uv::spectral::util::{near_zero, push_unique};
use flow::Flow;
use trillion3d_math::vector::vecn::dot;

mod angle;
mod distortion;
mod flow;
mod fuzzy;
mod stretch;

/// The fuzzy faces of two neighbouring children: the faces, and each face's node (`NONE` for the
/// faces outside the graph).
struct Nodes {
    faces: Vec<u32>,
    of_face: Vec<u32>,
}

impl<'a> Chart<'a> {
    /// The borders moved by the dihedral angle; whether the new labels hold, `None` when there
    /// is nothing to cut (fewer than two children, or no dihedral angle to weigh).
    pub(crate) fn optimize_boundary_by_angle(
        &mut self,
        face_charts: &mut [u32],
        count: usize,
    ) -> crate::Result<Option<bool>> {
        if count < 2 || self.children.len() < 2 {
            return Ok(None);
        }
        let backup = face_charts.to_vec();
        let Some((angles, mean)) = self.edge_angle_distances() else {
            return Ok(None);
        };
        let mut fuzzy = vec![false; self.faces.len()];
        for (i, child) in self.children.iter().enumerate() {
            child.fuzzy_region(self, &mut fuzzy);
            for face in &child.faces {
                face_charts[face.parent as usize] = i as u32;
            }
        }
        self.cut_by_angle(face_charts, &fuzzy, &angles, mean);
        Ok(Some(self.keep_valid_cut(face_charts, &backup, count)?))
    }

    /// Per edge, `1 − n1·n2` of the normals of its two faces (0 on a boundary), and their mean
    /// over the inner edges; `None` without an inner edge or for a mean within `ZERO` of zero.
    fn edge_angle_distances(&self) -> Option<(Vec<f32>, f32)> {
        let normals = &self.source.normals;
        let mut distances = vec![0f32; self.edges.len()];
        let (mut sum, mut count) = (0f32, 0usize);
        for (d, edge) in distances.iter_mut().zip(&self.edges) {
            if edge.boundary {
                continue;
            }
            let [a, b] = edge
                .faces
                .map(|f| normals[self.faces[f as usize].root as usize]);
            *d = 1.0 - dot(a, b);
            sum += *d;
            count += 1;
        }
        if count == 0 {
            return None;
        }
        let mean = sum / count as f32;
        (!near_zero(mean)).then_some((distances, mean))
    }

    /// The relabelled faces `face_charts` kept unless one label took them all, then made valid;
    /// whether they are valid.
    fn keep_valid_cut(
        &mut self,
        face_charts: &mut [u32],
        backup: &[u32],
        count: usize,
    ) -> crate::Result<bool> {
        let first = face_charts[0];
        if face_charts[1..self.faces.len()].iter().all(|&c| c == first) {
            face_charts[..self.faces.len()].copy_from_slice(&backup[..self.faces.len()]);
        }
        Ok(self
            .try_make_partition_valid(count, face_charts)?
            .unwrap_or(false))
    }

    /// Each child's neighbouring children: the labels of the faces around its vertices in this
    /// chart other than its own, in order of appearance.
    fn find_neighbour_children(&mut self, face_charts: &[u32]) {
        let mut found = Vec::with_capacity(self.children.len());
        for (i, child) in self.children.iter().enumerate() {
            let mut neighbours = Vec::new();
            for v in &child.verts {
                for &f in &self.verts[v.parent as usize].faces {
                    if face_charts[f as usize] != i as u32 {
                        push_unique(&mut neighbours, face_charts[f as usize]);
                    }
                }
            }
            found.push(neighbours);
        }
        for (child, neighbours) in self.children.iter_mut().zip(found) {
            child.neighbours = neighbours;
        }
    }

    /// Every pair of neighbouring children, the lower label first, in label order and each child's
    /// neighbour order.
    fn borders(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        (self.children.iter().enumerate())
            .flat_map(|(one, child)| child.neighbours.iter().map(move |&two| (one as u32, two)))
            .filter(|&(one, two)| one < two)
    }

    /// The fuzzy faces of the border between children `one` and `two`; none when it has none.
    fn border_nodes(
        &self,
        (one, two): (u32, u32),
        face_charts: &[u32],
        fuzzy: &[bool],
    ) -> Option<Nodes> {
        let nodes = self.fuzzy_nodes(one, two, face_charts, fuzzy);
        (!nodes.faces.is_empty()).then_some(nodes)
    }

    /// The fuzzy faces labelled `one` or `two`, numbered in face order.
    fn fuzzy_nodes(&self, one: u32, two: u32, face_charts: &[u32], fuzzy: &[bool]) -> Nodes {
        let mut nodes = Nodes {
            faces: Vec::new(),
            of_face: vec![NONE; self.faces.len()],
        };
        for f in 0..self.faces.len() {
            if fuzzy[f] && (face_charts[f] == one || face_charts[f] == two) {
                nodes.of_face[f] = nodes.faces.len() as u32;
                nodes.faces.push(f as u32);
            }
        }
        nodes
    }

    /// The fuzzy faces `nodes` relabelled `one` or `two` by the minimum cut: a link of weight
    /// `weight(edge, face, across)` across each inner edge between two of them (once from each
    /// side), a fuzzy face beside a fixed face tied to that face's side.
    fn cut_nodes(
        &self,
        (one, two): (u32, u32),
        nodes: &Nodes,
        face_charts: &mut [u32],
        fuzzy: &[bool],
        weight: impl Fn(&Edge, u32, u32) -> f32,
    ) {
        let mut flow = Flow::new(nodes.faces.len());
        for &f in &nodes.faces {
            let face = &self.faces[f as usize];
            for e in face.edges {
                let edge = &self.edges[e as usize];
                if edge.boundary {
                    continue;
                }
                let across = edge.other_face(face.id);
                let node = nodes.of_face[f as usize];
                if fuzzy[across as usize] && nodes.of_face[across as usize] != NONE {
                    let w = weight(edge, f, across);
                    flow.link(node, nodes.of_face[across as usize], w, w);
                } else if !fuzzy[across as usize] {
                    if face_charts[across as usize] == one {
                        flow.tie(node, f32::MAX, 0.0);
                    } else {
                        flow.tie(node, 0.0, f32::MAX);
                    }
                }
            }
        }
        flow.solve();
        for (node, &f) in nodes.faces.iter().enumerate() {
            face_charts[f as usize] = if flow.on_source_side(node as u32) {
                one
            } else {
                two
            };
        }
    }
}
