//! The adaptive tessellation of a displaced mesh: triangles are refined where the displacement
//! strays from what their corners' displacements interpolate, until none strays by more than the
//! target error, then every vertex moves by its displacement.
//!
//! Each triangle looks for the point to split it at (`search.rs`): the one whose displacement
//! strays most. A triangle that strays by more than the target asks to be split there. The requests
//! are sorted, and answered from the last: a split at a point of an edge splits the triangles on
//! both its sides, any other point pokes the triangle into three (`refine.rs`); a triangle made or
//! changed by a split looks again, and an edge whose flip makes both triangles better shaped, by
//! the cotangent weights of the angles across it, is flipped. This goes on while a triangle asks,
//! up to `MAX_TRIANGLES`. Vertices at one position — where the soup's triangles meet — then take
//! the mean of their displacements, so no crack opens, and move.
use super::mesh::Soup;
use super::policy::Displacer;
use rayon::prelude::*;
use trillion3d_math::vector::vecn::{add, scale};
use trillion3d_page_codec::hash::WordMap;

/// The most triangles a tessellation makes: past it no triangle is split and, a mesh that begins
/// at it, none is displaced.
pub(crate) const MAX_TRIANGLES: usize = 10_000_000;

/// The least cosine of the angle between the normals of two triangles whose shared edge may be
/// flipped.
pub(super) const COSINE_THRESHOLD: f32 = 0.999;

/// What a triangle holds of the refinement: the barycentric weights of the point it asks to be
/// split at, and its place in the queue of requests — a position in it, `-1` when it has none and
/// `-2` when it is to look again.
#[derive(Clone, Copy, Debug)]
pub(super) struct Record {
    pub split: [f32; 3],
    pub request: i32,
}

impl Default for Record {
    fn default() -> Self {
        Self {
            split: [0.0; 3],
            request: -1,
        }
    }
}

/// Whether every axis of `v` is a finite number.
pub(super) fn finite(v: [f32; 3]) -> bool {
    v.iter().all(|x| x.is_finite())
}

/// The refinement of a mesh in progress.
pub(super) struct Tessellation<'a> {
    pub mesh: Soup,
    pub policy: &'a Displacer<'a>,
    /// The squared error a triangle may stray by, and the length of the edge under which it is
    /// not looked at.
    pub target_error: f32,
    pub sample_rate: f32,
    /// The displacement of each vertex.
    pub displacements: Vec<[f32; 3]>,
    pub records: Vec<Record>,
    /// The triangles to look at again.
    pub find: Vec<u32>,
    /// The queue of requests, the triangles to split.
    pub splits: Vec<u32>,
    /// The triangles the requests made so far add, which the cap counts.
    pub new_triangles: usize,
    /// The most triangles the mesh may come to (`MAX_TRIANGLES`).
    pub cap: usize,
}

/// Refines `mesh` as `policy` displaces it, to the squared error `target_error` and the sample
/// rate (a length) `sample_rate`, to at most `cap` triangles — `MAX_TRIANGLES` —, and moves its
/// vertices by their displacements.
pub(super) fn tessellate<'a>(
    mesh: Soup,
    policy: &'a Displacer<'a>,
    (target_error, sample_rate): (f32, f32),
    cap: usize,
) -> Soup {
    let triangles = mesh.triangle_count();
    let mut work = Tessellation {
        mesh,
        policy,
        target_error,
        sample_rate,
        displacements: Vec::new(),
        records: vec![Record::default(); triangles],
        find: Vec::new(),
        splits: Vec::new(),
        new_triangles: 0,
        cap,
    };
    work.displace_corners();
    if triangles >= cap {
        return work.mesh;
    }
    let all: Vec<u32> = (0..triangles as u32).collect();
    work.look(&all);
    while !work.splits.is_empty() {
        work.splits.sort_unstable();
        for (at, &triangle) in work.splits.iter().enumerate() {
            work.records[triangle as usize].request = at as i32;
        }
        while let Some(triangle) = work.splits.pop() {
            work.split_triangle(triangle as usize);
        }
        if work.mesh.triangle_count() >= cap {
            break;
        }
        work.new_triangles = 0;
        let again = std::mem::take(&mut work.find);
        work.look(&again);
    }
    work.finish()
}

impl Tessellation<'_> {
    /// The displacement of every vertex a triangle names, evaluated in the first triangle that
    /// names it; zero where it is not a number.
    fn displace_corners(&mut self) {
        self.displacements = vec![[f32::NAN; 3]; self.mesh.vertex_count()];
        for triangle in 0..self.mesh.triangle_count() {
            for vertex in self.mesh.triangle(triangle) {
                if !finite(self.displacements[vertex as usize]) {
                    let d = self.policy.of_vertex(&self.mesh, vertex, triangle);
                    self.displacements[vertex as usize] = if finite(d) { d } else { [0.0; 3] };
                }
            }
        }
    }

    /// Looks at each of `triangles` for the point to split it at, side by side, and queues the
    /// requests in their order.
    fn look(&mut self, triangles: &[u32]) {
        for &triangle in triangles {
            self.records[triangle as usize].request = -1;
        }
        let this = &*self;
        let found: Vec<Option<[f32; 3]>> = triangles
            .par_iter()
            .map_init(Vec::new, |heap, &triangle| {
                this.find_split(triangle as usize, heap)
            })
            .collect();
        for (&triangle, split) in triangles.iter().zip(found) {
            if let Some(bary) = split {
                self.enqueue(triangle as usize, bary);
            }
        }
    }

    /// Queues the request to split `triangle` at the weights `bary`, if the cap leaves room for the
    /// two or three triangles it makes.
    fn enqueue(&mut self, triangle: usize, bary: [f32; 3]) {
        let added = if bary.contains(&0.0) { 2 } else { 3 };
        let before = self.new_triangles;
        self.new_triangles += added;
        if before < self.cap.saturating_sub(self.mesh.triangle_count()) {
            self.records[triangle] = Record {
                split: bary,
                request: self.splits.len() as i32,
            };
            self.splits.push(triangle as u32);
        }
    }

    /// Where the refinement ends: the vertices at one position take the mean of their
    /// displacements, summed in vertex order, then every vertex moves by its own.
    fn finish(mut self) -> Soup {
        let vertices = self.mesh.vertex_count();
        let mut old = std::mem::take(&mut self.displacements);
        old.resize(vertices, [f32::NAN; 3]);
        // Per position, the sum of its vertices' displacements and their number.
        let mut sums: Vec<([f32; 3], u32)> = Vec::new();
        let mut slots: WordMap<[u32; 3], usize> = WordMap::default();
        let mut slot_of = Vec::with_capacity(vertices);
        for (vertex, &d) in old.iter().enumerate() {
            let key = self.mesh.position_key(vertex as u32);
            let slot = *slots.entry(key).or_insert_with(|| {
                sums.push(([0.0; 3], 0));
                sums.len() - 1
            });
            sums[slot] = (add(sums[slot].0, d), sums[slot].1 + 1);
            slot_of.push(slot);
        }
        for (vertex, slot) in slot_of.into_iter().enumerate() {
            let (sum, count) = sums[slot];
            let d = scale(sum, 1.0 / count as f32);
            self.displacements.push(d);
            if finite(d) {
                let moved = add(self.mesh.position(vertex as u32), d);
                self.mesh.set_position(vertex, moved);
            }
        }
        self.mesh
    }
}
