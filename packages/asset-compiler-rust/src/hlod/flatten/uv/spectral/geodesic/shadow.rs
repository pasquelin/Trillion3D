//! The shadow of a saddle or boundary vertex: the faces around the apex the window bends at that
//! no unfolding of that window reaches, behind the edge from the apex to the face's third corner.
//!
//! From the face beyond that edge, the walk turns around the apex face by face, collecting each
//! face and its edge opposite the apex, until it closes back on the third corner, meets a vertex
//! already in a shadow, or would cross a boundary. When it stopped on a shadowed vertex or a
//! boundary (not by closing), each collected edge gets a whole window whose pseudo source is the
//! apex, at the apex's own distance. Each third corner opens at most one shadow per run.
use super::plane::{distance, into_frame_3d};
use super::{Window, Windows};

impl Windows {
    /// The shadow behind edge `bridge`, from the third corner `third` of face `face_to`, around
    /// `apex`, the window `w` reaching the apex at `extra` past its pseudo source.
    pub(super) fn shadow(
        &mut self,
        w: &Window,
        third: u32,
        bridge: u32,
        face_to: u32,
        apex: u32,
        extra: f64,
    ) {
        if self.verts[third as usize].shadow || self.edges[bridge as usize].is_boundary() {
            return;
        }
        self.verts[third as usize].shadow = true;
        let mut bridge = bridge;
        let mut face = self.edges[bridge as usize].other_face(face_to);
        let mut edge = self.faces[face as usize].edge_opposite(apex, &self.edges);
        let mut here = third;
        let mut next = self.edges[edge as usize].other_end(third);
        let mut collected = Vec::new();
        loop {
            collected.push((edge, face));
            if next == third || self.verts[next as usize].shadow {
                break;
            }
            bridge = self.faces[face as usize].edge_opposite(here, &self.edges);
            if self.edges[bridge as usize].is_boundary() {
                break;
            }
            here = self.edges[edge as usize].other_end(here);
            face = self.edges[bridge as usize].other_face(face);
            edge = self.faces[face as usize].edge_opposite(apex, &self.edges);
            next = self.edges[edge as usize].other_end(here);
        }
        let stopped = self.verts[next as usize].shadow || self.edges[bridge as usize].is_boundary();
        if next == third || !stopped {
            return;
        }
        let a = self.verts[apex as usize].p;
        for (edge, face) in collected {
            let e = &self.edges[edge as usize];
            let (p0, p1) = (
                self.verts[e.verts[0] as usize].p,
                self.verts[e.verts[1] as usize].p,
            );
            let window = Window {
                edge,
                mark: e.verts[0],
                pseudo: apex,
                b0: 0.0,
                b1: e.length,
                d0: distance(p0, a),
                d1: distance(p1, a),
                src: into_frame_3d(p0, p1, a),
                pseudo_distance: w.pseudo_distance + extra,
                from_face: face,
                ksi: w.ksi,
            };
            self.offer(window);
        }
    }
}
