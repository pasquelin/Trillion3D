//! The face adjacency the charting reads (`adjacency`): each vertex's representative — the first
//! vertex at exactly its position that shares no face with it —, then, across each edge of each
//! face, the neighbour sharing that edge the other way round among the representatives — of
//! several, the one whose face turns least from this one's —, each link made both ways at once.
//! Both steps walk chained hash tables, newest entry first, whose order decides the result, so the
//! tables are kept as the mesh library the method calls builds them.
//!
//! Ported from DirectXMesh, which carries this notice:
//!
//! ```text
//! Copyright (c) Microsoft Corporation. All rights reserved.
//! Licensed under the MIT License.
//! ```
use super::normals::unit;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, sub};

/// No vertex, no face, no entry.
pub(super) const NONE: u32 = u32::MAX;

/// A chained hash table of `buckets` heads, entries linked newest first.
struct Chains {
    heads: Vec<u32>,
    next: Vec<u32>,
}

impl Chains {
    fn new(buckets: usize, entries: usize) -> Self {
        Self {
            heads: vec![NONE; buckets],
            next: Vec::with_capacity(entries),
        }
    }
    /// A new entry at the head of `bucket`, its rank returned.
    fn push(&mut self, bucket: usize) -> u32 {
        let at = self.next.len() as u32;
        self.next.push(self.heads[bucket]);
        self.heads[bucket] = at;
        at
    }
    /// `entry`, found after `previous` (none for the head) in `bucket`, unlinked.
    fn unlink(&mut self, bucket: usize, previous: u32, entry: u32) {
        let after = self.next[entry as usize];
        match previous {
            NONE => self.heads[bucket] = after,
            p => self.next[p as usize] = after,
        }
    }
}

/// Whether one face holding `vertex` also holds `other`, `corners` each vertex's corners newest
/// first.
fn share_face(indices: &[u32], (first, after): (&[u32], &[u32]), vertex: u32, other: u32) -> bool {
    let mut corner = first[vertex as usize];
    while corner != NONE {
        let face = (corner / 3) as usize;
        if indices[3 * face..3 * face + 3].contains(&other) {
            return true;
        }
        corner = after[corner as usize];
    }
    false
}

/// Each vertex's representative: the first vertex at its exact position, met earlier, sharing no
/// face with it; itself where none is.
fn representatives(indices: &[u32], positions: &[[f32; 3]]) -> Vec<u32> {
    let vertices = positions.len();
    let mut first = vec![NONE; vertices];
    let mut after = vec![NONE; indices.len()];
    for (j, &k) in indices.iter().enumerate() {
        after[j] = first[k as usize];
        first[k as usize] = j as u32;
    }
    let buckets = (vertices / 3).max(1);
    let mut table = Chains::new(buckets, vertices);
    let mut owner: Vec<u32> = Vec::with_capacity(vertices);
    let mut reps = vec![NONE; vertices];
    for vert in 0..vertices {
        let p = positions[vert];
        let key = p
            .map(f32::to_bits)
            .iter()
            .fold(0u32, |s, &b| s.wrapping_add(b));
        let bucket = key as usize % buckets;
        let mut entry = table.heads[bucket];
        let mut found = NONE;
        while entry != NONE {
            let candidate = owner[entry as usize];
            if positions[candidate as usize] == p
                && !share_face(indices, (&first, &after), vert as u32, candidate)
            {
                found = candidate;
                break;
            }
            entry = table.next[entry as usize];
        }
        reps[vert] = match found {
            NONE => {
                table.push(bucket);
                owner.push(vert as u32);
                vert as u32
            }
            found => found,
        };
    }
    reps
}

/// One directed edge of a face among the representatives: its two ends, its face's third corner
/// and its face.
#[derive(Clone, Copy)]
struct Edge {
    from: u32,
    to: u32,
    other: u32,
    face: u32,
}

/// The unit normal of the face `[a, b, c]` as the library weighs two candidates:
/// `(a − b) × (a − c)`.
fn face_normal(positions: &[[f32; 3]], [a, b, c]: [u32; 3]) -> [f32; 3] {
    let [a, b, c] = [a, b, c].map(|v| positions[v as usize]);
    unit(cross(sub(a, b), sub(a, c)))
}

/// The face adjacency of `indices` over `positions`, three entries a face, `NONE` across an edge
/// no neighbour shares (module doc).
pub(super) fn adjacency(indices: &[u32], positions: &[[f32; 3]]) -> Vec<u32> {
    let reps = representatives(indices, positions);
    let faces = indices.len() / 3;
    let buckets = (positions.len() / 3).max(1);
    let rep = |face: usize, k: usize| reps[indices[3 * face + k % 3] as usize];
    let degenerate = |face: usize| {
        let [a, b, c] = [0, 1, 2].map(|k| rep(face, k));
        a == b || a == c || b == c
    };
    let mut table = Chains::new(buckets, 3 * faces);
    let mut edges: Vec<Edge> = Vec::with_capacity(3 * faces);
    for face in (0..faces).filter(|&f| !degenerate(f)) {
        for point in 0..3 {
            let (from, to, other) = (rep(face, point), rep(face, point + 1), rep(face, point + 2));
            table.push(from as usize % buckets);
            edges.push(Edge {
                from,
                to,
                other,
                face: face as u32,
            });
        }
    }
    let mut adjacent = vec![NONE; 3 * faces];
    for face in (0..faces).filter(|&f| !degenerate(f)) {
        for point in 0..3 {
            if adjacent[3 * face + point] != NONE {
                continue;
            }
            let (from, to, other) = (rep(face, point + 1), rep(face, point), rep(face, point + 2));
            let bucket = from as usize % buckets;
            let matches = |e: &Edge| e.to == to && e.from == from;
            let (mut previous, mut entry) = (NONE, table.heads[bucket]);
            while entry != NONE && !matches(&edges[entry as usize]) {
                previous = entry;
                entry = table.next[entry as usize];
            }
            if entry == NONE {
                continue;
            }
            let (mut found, mut found_previous) = (entry, previous);
            let mut best: Option<f32> = None;
            let own = face_normal(positions, [to, from, other]);
            let (mut previous, mut current) = (entry, table.next[entry as usize]);
            while current != NONE {
                let e = edges[current as usize];
                if matches(&e) {
                    let first = edges[found as usize];
                    let best_so_far = *best.get_or_insert_with(|| {
                        dot(
                            face_normal(positions, [first.from, first.to, first.other]),
                            own,
                        )
                    });
                    let diff = dot(face_normal(positions, [e.from, e.to, e.other]), own);
                    if diff > best_so_far {
                        (found, found_previous, best) = (current, previous, Some(diff));
                    }
                }
                previous = current;
                current = table.next[current as usize];
            }
            table.unlink(bucket, found_previous, found);
            let found_face = edges[found as usize].face;
            adjacent[3 * face + point] = found_face;
            // This face's own entry the other way round leaves the table.
            let back = to as usize % buckets;
            let (mut previous, mut current) = (NONE, table.heads[back]);
            while current != NONE {
                let e = edges[current as usize];
                if e.face == face as u32 && e.to == from && e.from == to {
                    table.unlink(back, previous, current);
                    break;
                }
                previous = current;
                current = table.next[current as usize];
            }
            if (0..point).any(|p2| adjacent[3 * face + p2] == found_face) {
                adjacent[3 * face + point] = NONE;
                continue;
            }
            let ff = found_face as usize;
            if let Some(p2) = (0..3).find(|&k| reps[indices[3 * ff + k] as usize] == from) {
                adjacent[3 * ff + p2] = face as u32;
            }
        }
    }
    adjacent
}
