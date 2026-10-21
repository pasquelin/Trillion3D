//! A walk around one corner's fan of faces through the face adjacency, the way the root chart's
//! corners are numbered.
//!
//! A corner is a face and the rank of one of its vertices. Walking against the winding goes to the
//! face across the corner's own edge (from the corner to the next one); walking with the winding
//! goes to the face across the edge that ends at the corner. A walk starts by going against the
//! winding until it meets no face, comes back to its start, or has taken more steps than there
//! are faces (a broken adjacency); from that face it then walks with the winding. A step that would
//! go straight back to the corner it came from stops.
//!
//! The walker keeps its last step between walks, as the corners are numbered one after another
//! with the same walker.
use crate::hlod::flatten::uv::spectral::mesh::NONE;

pub(super) struct Walk<'s> {
    adjacency: &'s [u32],
    face: u32,
    corner: u32,
    previous_face: u32,
    previous_corner: u32,
    begin_face: u32,
    with_winding: bool,
}

impl<'s> Walk<'s> {
    pub(super) fn new(adjacency: &'s [u32]) -> Self {
        Walk {
            adjacency,
            face: 0,
            corner: 0,
            previous_face: 0,
            previous_corner: 0,
            begin_face: 0,
            with_winding: false,
        }
    }

    /// The walk set at the first face of corner `corner` of `face`'s fan; `false` when the
    /// adjacency is broken.
    pub(super) fn start(&mut self, face: u32, corner: u32, face_count: usize) -> bool {
        self.face = face;
        self.corner = corner;
        self.begin_face = face;
        self.with_winding = false;
        let mut steps = 0;
        while self.has_next() && steps <= face_count {
            if !self.step() {
                return false;
            }
            steps += 1;
        }
        if steps > face_count {
            return false;
        }
        self.begin_face = self.face;
        self.previous_face = NONE;
        self.previous_corner = NONE;
        self.with_winding = true;
        true
    }

    pub(super) fn face(&self) -> u32 {
        self.face
    }

    pub(super) fn corner(&self) -> u32 {
        self.corner
    }

    fn next_face(&self) -> u32 {
        let edge = if self.with_winding {
            self.corner.wrapping_add(2) % 3
        } else {
            self.corner
        };
        self.adjacency[(self.face * 3 + edge) as usize]
    }

    /// Whether a face follows that is neither missing nor the walk's start.
    pub(super) fn has_next(&self) -> bool {
        let next = self.next_face();
        next != NONE && next != self.begin_face
    }

    /// One step to the next face; `false` when it would undo the previous step, or when the next
    /// face does not name this one back (an adjacency the library leaves undefined).
    pub(super) fn step(&mut self) -> bool {
        let next = self.next_face();
        let back = &self.adjacency[(next * 3) as usize..(next * 3 + 3) as usize];
        let Some(i) = back.iter().position(|&f| f == self.face) else {
            return false;
        };
        let next_corner = if self.with_winding {
            i as u32
        } else {
            (i as u32 + 1) % 3
        };
        if next == self.previous_face && next_corner == self.previous_corner {
            return false;
        }
        self.previous_face = self.face;
        self.previous_corner = self.corner;
        self.face = next;
        self.corner = next_corner;
        true
    }
}
