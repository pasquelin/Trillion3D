//! A face labelling fixed around one vertex so each label's faces there stay connected.
//!
//! Around a vertex whose faces carry several labels, the faces of each label in turn (in ring
//! order, each label once) are grown from the first through shared edges. Faces of that label the
//! growth cannot reach would make a bowtie: the smaller of the reached and unreached sets (the
//! reached one on a tie) takes the other label of the two the vertex's ring shows first. One fix
//! per vertex and call.
use crate::hlod::flatten::uv::spectral::mesh::Chart;

impl<'a> Chart<'a> {
    /// The labels around vertex `v` fixed, when `fix`; whether a bowtie was found.
    pub(super) fn validate_around(&self, v: u32, face_charts: &mut [u32], fix: bool) -> bool {
        let ring = &self.verts[v as usize].faces;
        if ring.is_empty() {
            return false;
        }
        let first = face_charts[ring[0] as usize];
        let Some(differing) = ring[1..]
            .iter()
            .map(|&f| face_charts[f as usize])
            .find(|&c| c != first)
        else {
            return false;
        };
        let mut checked: Vec<u32> = Vec::new();
        for (i, &f) in ring.iter().enumerate() {
            let label = face_charts[f as usize];
            if checked.contains(&label) {
                continue;
            }
            checked.push(label);
            let mut connected = vec![f];
            let mut unconnected: Vec<u32> = ring[i + 1..]
                .iter()
                .copied()
                .filter(|&g| face_charts[g as usize] == label)
                .collect();
            if unconnected.is_empty() {
                continue;
            }
            self.connect_faces(&mut unconnected, &mut connected);
            if unconnected.is_empty() {
                continue;
            }
            if fix {
                let target = if first == label { differing } else { first };
                let moved = if unconnected.len() > connected.len() {
                    &connected
                } else {
                    &unconnected
                };
                for &g in moved {
                    face_charts[g as usize] = target;
                }
            }
            return true;
        }
        false
    }

    /// The faces of `unconnected` that share an edge with a face of `connected` moved to it, the
    /// growth continuing from each face moved.
    fn connect_faces(&self, unconnected: &mut Vec<u32>, connected: &mut Vec<u32>) {
        let mut i = 0;
        while i < connected.len() {
            if unconnected.is_empty() {
                break;
            }
            let face = &self.faces[connected[i] as usize];
            for &e in &face.edges {
                let edge = &self.edges[e as usize];
                if edge.boundary {
                    continue;
                }
                let next = edge.other_face(face.id);
                if let Some(at) = unconnected.iter().position(|&g| g == next) {
                    connected.push(next);
                    unconnected.remove(at);
                }
            }
            i += 1;
        }
    }
}
