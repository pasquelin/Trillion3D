//! The exponential map of an island's triangles (Schmidt et al. 2006), drawn on them as their
//! submesh holds them (`Submesh`) and in the scene's axes as a `z`-up mesh reads them, the second
//! and third exchanged (`Submesh::point`), so every turn and every side a cross product picks is
//! the one it picks on a `z`-up mesh:
//!
//! 1. the seed: the vertex a front from the boundary reaches last (`front`) — from every boundary
//!    vertex, in the order the edges were made, when an island candidate is measured; from the
//!    longest boundary loop's vertices in walking order when an island is mapped
//!    (`mesh::boundary_loops`) —; the
//!    first vertex the triangles name when no boundary, or no loop, seeds it;
//! 2. the seed's frame (`Frame::at_vertex`), aligned to the world's horizontal axes when mapped off
//!    a loop (`Frame::aligned`);
//! 3. the map: a second front from the seed, each vertex it reaches given the mean of what its
//!    reached neighbours propagate to it (`propagate`), each weighed by the inverse of its squared
//!    distance.
//!
//! Every vertex is framed by its normal weighed and smoothed (`normals`), the seed's own frame by
//! its normal before smoothing.
use super::base::Base;
use super::frame::{propagate, Frame};
use super::normals::{smoothed, weighted};
use super::submesh::Submesh;
use crate::hlod::flatten::mesh::boundary_loops;
use trillion3d_math::heap::{IndexedHeap, LeastRisingOnTie};
use trillion3d_math::vector::vecn::{length, squared_length, sub};

/// What an exponential map's seed lies furthest from.
#[derive(Clone, Copy)]
pub(super) enum Seeding {
    /// Every boundary vertex: how an island candidate is measured (`measure.rs`).
    Boundary,
    /// The longest boundary loop's vertices: how an island is mapped (`super::unwrap`).
    LongestLoop,
}

/// An exponential map of an island's triangles: each one's corners numbered among the island's
/// vertices, each vertex's coordinates, metres, `None` where the map does not reach, and whether
/// the map is whole — seeded off the boundary, every corner reached —, the map an island is turned
/// to its least box by.
pub(super) struct Map {
    pub(super) corners: Vec<[usize; 3]>,
    pub(super) uv: Vec<Option<[f64; 2]>>,
    pub(super) whole: bool,
}

/// What is added to each upwind weight's squared distance, square metres: `1e-8` square
/// centimetres.
const WEIGHT_TOLERANCE: f64 = 1e-12;

/// A front over `mesh` from the vertices `queue` holds, `frozen` those already reached: each vertex
/// taken off the queue in order of its key — its `distance` in single precision —, handed to
/// `reach`, frozen, then each of its neighbours not frozen put in or moved up with its distance
/// through it when shorter. The last vertex taken.
fn front(
    mesh: &Submesh,
    (distance, frozen): (&mut [f64], &mut [bool]),
    queue: &mut IndexedHeap<LeastRisingOnTie>,
    mut reach: impl FnMut(usize, &[bool]),
) -> Option<usize> {
    let mut last = None;
    while let Some(v) = queue.pop() {
        let v = v as usize;
        reach(v, frozen);
        frozen[v] = true;
        last = Some(v);
        let here = mesh.point(v);
        for m in mesh.neighbours(v) {
            if frozen[m] {
                continue;
            }
            let through = distance[v] + length(sub(here, mesh.point(m)));
            if !queue.contains(m as u32) {
                distance[m] = through;
                queue.insert(m as u32, through as f32);
            } else if through < distance[m] {
                distance[m] = through;
                queue.update(m as u32, through as f32);
            }
        }
    }
    last
}

/// The vertex a front from `sources`, each frozen at distance zero in its order, reaches last.
fn furthest(mesh: &Submesh, sources: &[usize]) -> Option<usize> {
    let count = mesh.vertices.len();
    let (mut distance, mut frozen) = (vec![0.0; count], vec![false; count]);
    let mut queue = IndexedHeap::<LeastRisingOnTie>::new(count);
    for &v in sources {
        if !queue.contains(v as u32) {
            frozen[v] = true;
            queue.insert(v as u32, 0.0);
        }
    }
    front(mesh, (&mut distance, &mut frozen), &mut queue, |_, _| {})
}

/// Every vertex of a boundary edge, the edges in the order they were made, each edge's lower end
/// first, each vertex once.
fn boundary_vertices(mesh: &Submesh) -> Vec<usize> {
    let mut seen = vec![false; mesh.vertices.len()];
    let mut out = Vec::new();
    for (e, edge) in mesh.edges.iter().enumerate() {
        if mesh.is_boundary(e) {
            for v in edge.ends {
                if !std::mem::replace(&mut seen[v], true) {
                    out.push(v);
                }
            }
        }
    }
    out
}

/// The exponential map of the triangles `island` of `base`, seeded as `seeding` says (module doc).
pub(super) fn expmap(base: &Base, island: &[usize], seeding: Seeding) -> Map {
    let mesh = Submesh::of(base, island);
    let count = mesh.vertices.len();
    let unsmoothed = weighted(&mesh);
    // A seed's frame: its normal, the edge it met first laid across it.
    let framed = |v: usize| match mesh.first_edge(v) {
        Some(e) => Frame::at_vertex(mesh.point(v), unsmoothed[v], mesh.point(mesh.other(e, v))),
        None => Frame::along(mesh.point(v), unsmoothed[v]),
    };
    let (seed, seed_frame, seeded) = match seeding {
        Seeding::Boundary => {
            let sources = boundary_vertices(&mesh);
            let seed = furthest(&mesh, &sources).unwrap_or(0);
            (seed, framed(seed), !sources.is_empty())
        }
        // The loop of the most vertices, the first of equals.
        Seeding::LongestLoop => match (boundary_loops(&mesh, |_| true, |v| mesh.point(v)).loops)
            .into_iter()
            .reduce(|best, l| if l.len() > best.len() { l } else { best })
        {
            Some(longest) => {
                let seed = furthest(&mesh, &longest).unwrap_or(0);
                (seed, framed(seed).aligned(), true)
            }
            None => (0, framed(0), false),
        },
    };
    let normals = smoothed(unsmoothed, &mesh);
    let frames: Vec<Frame> = (0..count)
        .map(|v| Frame::along(mesh.point(v), normals[v]))
        .collect();
    let mut uv: Vec<Option<[f64; 2]>> = vec![None; count];
    let (mut distance, mut frozen) = (vec![0.0; count], vec![false; count]);
    let mut queue = IndexedHeap::<LeastRisingOnTie>::new(count);
    uv[seed] = Some([0.0; 2]);
    frozen[seed] = true;
    queue.insert(seed as u32, 0.0);
    // Each vertex but the seed: the upwind mean over its reached neighbours.
    let reach = |v: usize, frozen: &[bool]| {
        if v == seed {
            return;
        }
        let here = mesh.point(v);
        let (mut sum, mut weight) = ([0.0f64; 2], 0.0f64);
        for m in mesh.neighbours(v) {
            let Some(at) = uv[m].filter(|_| frozen[m]) else {
                continue;
            };
            let p = propagate(here, at, &frames[m], &seed_frame);
            let w = 1.0 / (squared_length(sub(here, frames[m].origin)) + WEIGHT_TOLERANCE);
            sum = [sum[0] + w * p[0], sum[1] + w * p[1]];
            weight += w;
        }
        uv[v] = Some([sum[0] / weight, sum[1] / weight]);
    };
    front(&mesh, (&mut distance, &mut frozen), &mut queue, reach);
    let whole = seeded && (mesh.triangles.iter()).all(|tri| tri.iter().all(|&v| uv[v].is_some()));
    Map {
        corners: mesh.mesh.triangles,
        uv,
        whole,
    }
}
