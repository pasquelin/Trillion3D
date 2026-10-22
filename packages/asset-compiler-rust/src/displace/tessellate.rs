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
use std::collections::HashMap;
use trillion3d_math::vector::vecn::{add, scale};

/// The most triangles a tessellation makes: past it no triangle is split and, a mesh that begins
/// at it, none is displaced.
pub(super) const MAX_TRIANGLES: usize = 10_000_000;

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
    /// The queue of requests, the first `split_count` of it valid while they are being made.
    pub splits: Vec<u32>,
    pub split_count: usize,
    /// The triangles the requests made so far add, which the cap counts.
    pub new_triangles: usize,
}

/// Refines `mesh` as `policy` displaces it, to the squared error `target_error` and the sample
/// rate (a length) `sample_rate`, and moves its vertices by their displacements.
pub(super) fn tessellate<'a>(
    mesh: Soup,
    policy: &'a Displacer<'a>,
    (target_error, sample_rate): (f32, f32),
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
        splits: vec![0; triangles],
        split_count: 0,
        new_triangles: 0,
    };
    work.displace_corners();
    if triangles >= MAX_TRIANGLES {
        return work.mesh;
    }
    let all: Vec<u32> = (0..triangles as u32).collect();
    work.look(&all);
    while work.split_count > 0 {
        work.splits.truncate(work.split_count);
        work.splits.sort_unstable();
        for (at, &triangle) in work.splits.iter().enumerate() {
            work.records[triangle as usize].request = at as i32;
        }
        while let Some(triangle) = work.splits.pop() {
            work.split_triangle(triangle as usize);
        }
        if work.mesh.triangle_count() >= MAX_TRIANGLES {
            break;
        }
        work.splits.resize(work.records.len(), 0);
        work.split_count = 0;
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
            .map(|&triangle| this.find_split(triangle as usize))
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
        if before < MAX_TRIANGLES.saturating_sub(self.mesh.triangle_count()) {
            self.records[triangle] = Record {
                split: bary,
                request: self.split_count as i32,
            };
            self.splits[self.split_count] = triangle as u32;
            self.split_count += 1;
        }
    }

    /// Where the refinement ends: the vertices at one position take the mean of their
    /// displacements, then every vertex moves by its own.
    fn finish(mut self) -> Soup {
        let vertices = self.mesh.vertex_count();
        let at = |mesh: &Soup, vertex: usize| {
            mesh.position(vertex as u32)
                .map(|x| if x == 0.0 { 0 } else { x.to_bits() })
        };
        let mut together: HashMap<[u32; 3], Vec<usize>> = HashMap::new();
        for vertex in 0..vertices {
            together
                .entry(at(&self.mesh, vertex))
                .or_default()
                .push(vertex);
        }
        let mut old = std::mem::take(&mut self.displacements);
        old.resize(vertices, [f32::NAN; 3]);
        for vertex in 0..vertices {
            let same = &together[&at(&self.mesh, vertex)];
            let sum = same
                .iter()
                .fold([0.0; 3], |sum, &other| add(sum, old[other]));
            self.displacements.push(scale(sum, 1.0 / same.len() as f32));
        }
        for (vertex, &d) in self.displacements.iter().enumerate() {
            if finite(d) {
                let moved = add(self.mesh.position(vertex as u32), d);
                self.mesh.set_position(vertex, moved);
            }
        }
        self.mesh
    }
}
