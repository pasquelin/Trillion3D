//! The simplified mesh made fit for charting (`cleaned`): its face adjacency built, then cleaned —
//! links of a face repeating a vertex dropped both ways; links the neighbour does not return
//! dropped until none is left; two faces linked twice unlinked; and a vertex shared by two fans of
//! faces that touch at it alone (a bowtie) copied for each fan after the first —, again while the
//! last pass copied a vertex, five passes at most. A mesh still holding a bowtie after the fifth
//! cannot be charted. The method then moves each copy a ten-thousandth towards its face's centre,
//! but reads the copies' ranks against the vertex count taken after the copying, so no copy ever
//! moves: none is moved here.
//!
//! Ported from DirectXMesh, which carries this notice:
//!
//! ```text
//! Copyright (c) Microsoft Corporation. All rights reserved.
//! Licensed under the MIT License.
//! ```
use super::adjacency::{adjacency, NONE};
use super::proxy::Proxy;

/// The most passes of adjacency and cleaning before a mesh still holding bowties is given up.
const PASSES: usize = 5;

/// The corner of `face` that holds `vertex`, the last one where none of the first two does.
fn corner_of(indices: &[u32], face: u32, vertex: u32) -> u32 {
    let at = 3 * face as usize;
    match (indices[at] == vertex, indices[at + 1] == vertex) {
        (true, _) => 0,
        (false, true) => 1,
        _ => 2,
    }
}

/// The edge of `face` across which `neighbour` lies, the last one where none of the first two is.
fn edge_to(adjacent: &[u32], face: u32, neighbour: u32) -> u32 {
    corner_of(adjacent, face, neighbour)
}

/// A walk around one vertex of a face, across the edges the adjacency links: first back
/// counterclockwise to a boundary, or a whole turn, then forward clockwise from there, the walk
/// turning back once from the start face when it meets a boundary.
struct Orbit<'a> {
    adjacent: &'a [u32],
    indices: &'a [u32],
    face: u32,
    vertex: u32,
    current: u32,
    edge: u32,
    next: u32,
    clockwise: bool,
}

impl<'a> Orbit<'a> {
    /// The walk around `vertex` of `face`, moved to its counterclockwise end.
    fn around(adjacent: &'a [u32], indices: &'a [u32], face: u32, vertex: u32) -> Self {
        let initial = corner_of(indices, face, vertex);
        let (mut current, mut next) = (face, (initial + 2) % 3);
        let mut previous;
        loop {
            previous = current;
            current = adjacent[3 * current as usize + next as usize];
            if current != NONE {
                next = (edge_to(adjacent, current, previous) + 2) % 3;
            }
            if current == face || current == NONE {
                break;
            }
        }
        let mut orbit = Self {
            adjacent,
            indices,
            face,
            vertex,
            current,
            edge: initial,
            next: initial,
            clockwise: true,
        };
        if current == NONE {
            orbit.next = (next + 1) % 3;
            orbit.current = previous;
            orbit.vertex = indices[3 * previous as usize + orbit.next as usize];
            orbit.edge = orbit.next;
        }
        orbit.face = orbit.current;
        orbit
    }

    fn done(&self) -> bool {
        self.current == NONE
    }

    /// The face the walk stands on, the walk moved on to the next.
    fn next_face(&mut self) -> u32 {
        let face = self.current;
        self.edge = self.next;
        loop {
            let previous = self.current;
            self.current = self.adjacent[3 * self.current as usize + self.next as usize];
            if self.current == self.face {
                self.current = NONE;
                break;
            }
            if self.current != NONE {
                let back = edge_to(self.adjacent, self.current, previous);
                self.next = (back + if self.clockwise { 1 } else { 2 }) % 3;
                break;
            }
            if !self.clockwise {
                break;
            }
            self.clockwise = false;
            self.current = self.face;
            self.next = (corner_of(self.indices, self.face, self.vertex) + 2) % 3;
            self.edge = (self.edge + 2) % 3;
        }
        face
    }

    /// The corner of the face last returned that holds the walk's vertex.
    fn point(&self) -> u32 {
        match self.clockwise {
            true => self.edge,
            false => (self.edge + 1) % 3,
        }
    }
}

/// Whether `face` repeats a vertex.
fn degenerate(indices: &[u32], face: usize) -> bool {
    let [a, b, c] = [0, 1, 2].map(|k| indices[3 * face + k]);
    a == b || a == c || b == c
}

/// One cleaning pass over `indices` and its `adjacent` faces (module doc): the vertices copied to
/// break bowties, each copy's vertex in the order the copies are made, `indices` rewired to them.
fn clean(indices: &mut [u32], vertices: usize, adjacent: &mut [u32]) -> Vec<u32> {
    let faces = indices.len() / 3;
    for face in (0..faces).filter(|&f| degenerate(indices, f)) {
        for point in 0..3 {
            let k = adjacent[3 * face + point];
            if k != NONE {
                for entry in &mut adjacent[3 * k as usize..3 * k as usize + 3] {
                    if *entry == face as u32 {
                        *entry = NONE;
                    }
                }
                adjacent[3 * face + point] = NONE;
            }
        }
    }
    loop {
        let mut unlinked = false;
        for at in 0..3 * faces {
            let k = adjacent[at] as usize;
            if adjacent[at] != NONE && !adjacent[3 * k..3 * k + 3].contains(&((at / 3) as u32)) {
                unlinked = true;
                adjacent[at] = NONE;
            }
        }
        if !unlinked {
            break;
        }
    }
    for face in (0..faces).filter(|&f| !degenerate(indices, f)) {
        let [j0, j1, j2] = [0, 1, 2].map(|k| adjacent[3 * face + k]);
        let twice = |a: u32, b: u32| a == b && a != NONE;
        if twice(j0, j1) || twice(j0, j2) || twice(j1, j2) {
            let neighbour = (if j0 == j1 || j0 == j2 { j0 } else { j1 }) as usize;
            for edge in 0..3 {
                if adjacent[3 * face + edge] == neighbour as u32 {
                    adjacent[3 * face + edge] = NONE;
                }
                if adjacent[3 * neighbour + edge] == face as u32 {
                    adjacent[3 * neighbour + edge] = NONE;
                }
            }
        }
    }
    let mut seen: Vec<bool> = (0..3 * faces)
        .map(|at| degenerate(indices, at / 3))
        .collect();
    let mut owner = vec![NONE; vertices];
    let mut rewired = indices.to_vec();
    let mut copies = Vec::new();
    for face in 0..faces as u32 {
        for point in 0..3 {
            let at = 3 * face as usize + point;
            if seen[at] {
                continue;
            }
            seen[at] = true;
            let mut orbit = Orbit::around(adjacent, indices, face, indices[at]);
            let (mut replaced, mut replacement) = (NONE, NONE);
            while !orbit.done() {
                let current = orbit.next_face();
                let corner = 3 * current as usize + orbit.point() as usize;
                seen[corner] = true;
                let j = indices[corner];
                if j == replaced {
                    rewired[corner] = replacement;
                } else if owner[j as usize] == NONE {
                    owner[j as usize] = face;
                } else if owner[j as usize] != face {
                    (replaced, replacement) = (j, (vertices + copies.len()) as u32);
                    rewired[corner] = replacement;
                    copies.push(j);
                }
            }
        }
    }
    if !copies.is_empty() {
        indices.copy_from_slice(&rewired);
    }
    copies
}

/// `proxy`'s face adjacency once its mesh is clean (module doc), its bowtie vertices copied; none
/// when bowties remain after the last pass.
pub(super) fn cleaned(proxy: &mut Proxy) -> Option<Vec<u32>> {
    for _ in 0..PASSES {
        let mut adjacent = adjacency(&proxy.indices, &proxy.points);
        let copies = clean(&mut proxy.indices, proxy.points.len(), &mut adjacent);
        proxy.split(&copies);
        if copies.is_empty() {
            return Some(adjacent);
        }
    }
    None
}
