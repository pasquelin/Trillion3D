//! The first patches (`initial_patches`), the mesh cut into groups of nearby triangles:
//!
//! 1. the faces' graph (`Faces`): each triangle a node at its centroid, of its unit normal as a
//!    `z`-up mesh winds it, linked to the triangles across its sides, the links made in triangle
//!    order and each node's kept in the order made;
//! 2. the connected components, each grown from its lowest triangle, the last found first
//!    (`components`);
//! 3. the seeds: per component as many as its area holds at one seed per the mesh's area over the
//!    initial count — at most one per vertex —, the first its first triangle, each next the one a
//!    front from those so far reaches furthest, the lowest of equals (`Spread`);
//! 4. each triangle given to the seed whose front reaches it first, a step to it weighed by how far
//!    its normal turns from that seed's (`owners`), each seed's triangles in order;
//! 5. a patch of fewer than `MIN_PATCH_SIZE` triangles merged into a neighbour, then a triangle
//!    whose other sides all border one other patch moved into it (`Regions`).
//!
//! Every front takes triangles in order of their distance in single precision.
use super::base::Base;
use super::regions::Regions;
use super::MIN_PATCH_SIZE;
use crate::hlod::flatten::mesh::NONE;
use crate::hlod::options::HlodPatches;
use rayon::prelude::*;
use trillion3d_math::heap::{IndexedHeap, LeastRisingOnTie};
use trillion3d_math::vector::vec3::{cross, unit_or_itself};
use trillion3d_math::vector::vecn::{add, dot, length, scale, sub};

/// The rounds the patches' borders are evened in at most.
pub(super) const BORDER_ROUNDS: usize = 25;

/// The alignment above which a normal's turn is raised to its power.
const ALIGNMENT_FLOOR: f64 = 0.001;

/// The least weight of a step of a front from a seed, the weight of no turn at all.
const LEAST_WEIGHT: f64 = 0.001;

/// The faces' graph of a mesh (module doc): per triangle its centroid, its unit normal, its area,
/// the triangles across its sides, and its links.
pub(super) struct Faces {
    centroids: Vec<[f64; 3]>,
    pub(super) normals: Vec<[f64; 3]>,
    areas: Vec<f64>,
    pub(super) across: Vec<[usize; 3]>,
    links: Vec<Vec<usize>>,
}

impl Faces {
    /// `base`'s faces' graph.
    pub(super) fn of(base: &Base) -> Self {
        let count = base.triangle_count();
        let (mut centroids, mut normals, mut areas) = (Vec::new(), Vec::new(), Vec::new());
        for t in 0..count {
            let [a, b, c] = base.corners(t);
            centroids.push(scale(add(add(a, b), c), 1.0 / 3.0));
            let normal = cross(sub(c, a), sub(b, a));
            areas.push(0.5 * length(normal));
            normals.push(unit_or_itself(normal));
        }
        let across: Vec<[usize; 3]> = (0..count)
            .map(|t| base.mesh.neighbour_triangles(t))
            .collect();
        let mut links = vec![Vec::new(); count];
        for (t, sides) in across.iter().enumerate() {
            for &m in sides {
                if m != NONE && !links[t].contains(&m) {
                    links[t].push(m);
                    links[m].push(t);
                }
            }
        }
        Self {
            centroids,
            normals,
            areas,
            across,
            links,
        }
    }

    /// The length of the link between triangles `a` and `b`, centroid to centroid.
    fn step(&self, a: usize, b: usize) -> f64 {
        length(sub(self.centroids[a], self.centroids[b]))
    }
}

/// The connected components of `faces`, each grown from the lowest triangle not yet reached by
/// taking the last triangle found and adding those across its sides, in their order: each a list
/// of its triangles in the order taken.
fn components(faces: &Faces) -> Vec<Vec<usize>> {
    components_where(&faces.across, |_, _| true)
}

/// The components of a mesh whose triangles have the triangles `across` their sides, grown as
/// `components` grows them but across a side only where `joined` says the two triangles are.
pub(super) fn components_where(
    across: &[[usize; 3]],
    joined: impl Fn(usize, usize) -> bool,
) -> Vec<Vec<usize>> {
    let mut reached = vec![false; across.len()];
    let mut out = Vec::new();
    for start in 0..across.len() {
        if reached[start] {
            continue;
        }
        reached[start] = true;
        let (mut stack, mut component) = (vec![start], Vec::new());
        while let Some(t) = stack.pop() {
            component.push(t);
            for &m in &across[t] {
                if m != NONE && !reached[m] && joined(t, m) {
                    reached[m] = true;
                    stack.push(m);
                }
            }
        }
        out.push(component);
    }
    out
}

/// The front of the seeds of one component (`seeds_of`): its triangles ascending, each one's
/// distance to the seeds so far and the seed round that last froze it, none yet.
struct Spread {
    triangles: Vec<usize>,
    distance: Vec<f64>,
    frozen: Vec<u32>,
    round: u32,
    queue: IndexedHeap<LeastRisingOnTie>,
}

impl Spread {
    /// Triangle `t`'s rank among the component's.
    fn local(&self, t: usize) -> usize {
        self.triangles.binary_search(&t).unwrap_or(0)
    }

    /// `seed` added: a new round's front from it, each triangle it reaches sooner than every
    /// earlier seed did given its new distance; a triangle frozen this round is left alone.
    fn add(&mut self, faces: &Faces, seed: usize) {
        self.round += 1;
        let at = self.local(seed);
        self.distance[at] = 0.0;
        self.frozen[at] = self.round;
        self.queue.insert(at as u32, 0.0);
        while let Some(v) = self.queue.pop() {
            let v = v as usize;
            self.frozen[v] = self.round;
            let t = self.triangles[v];
            for &m in &faces.links[t] {
                let n = self.local(m);
                if self.frozen[n] == self.round {
                    continue;
                }
                let through = self.distance[v] + faces.step(t, m);
                if through < self.distance[n] {
                    self.distance[n] = through;
                    match self.queue.contains(n as u32) {
                        true => self.queue.update(n as u32, through as f32),
                        false => self.queue.insert(n as u32, through as f32),
                    }
                }
            }
        }
    }

    /// The triangle reached furthest from the seeds so far, the lowest of equals; none when every
    /// one reached is a seed.
    fn furthest(&self) -> Option<usize> {
        let mut best: Option<(usize, f64)> = None;
        for (v, &d) in self.distance.iter().enumerate() {
            if self.frozen[v] != 0 && d != f64::MAX && d > best.map_or(0.0, |(_, most)| most) {
                best = Some((v, d));
            }
        }
        best.map(|(v, _)| self.triangles[v])
    }
}

/// The `wanted` seeds of component `part` (module doc, step 3).
fn seeds_of(faces: &Faces, part: &[usize], wanted: usize) -> Vec<usize> {
    let mut seeds = vec![part[0]];
    if wanted == 1 {
        return seeds;
    }
    let mut triangles = part.to_vec();
    triangles.sort_unstable();
    let count = triangles.len();
    let mut spread = Spread {
        triangles,
        distance: vec![f64::MAX; count],
        frozen: vec![0; count],
        round: 0,
        queue: IndexedHeap::new(count),
    };
    spread.add(faces, part[0]);
    while seeds.len() < wanted {
        let Some(next) = spread.furthest() else {
            break;
        };
        seeds.push(next);
        spread.add(faces, next);
    }
    seeds
}

/// A step of `length` towards a triangle of unit normal `to` from a seed of unit normal `seed`,
/// weighed by its turn: the normals' cosine raised to `alignment`, its square taken from one, held
/// in `[0, 1]`, cubed and held in `[LEAST_WEIGHT, 1]` — a cosine of no real power passing through
/// as no number, which the holds leave as it is.
fn weighed(length: f64, to: [f64; 3], seed: [f64; 3], alignment: f64) -> f64 {
    let mut cosine = dot(to, seed);
    if alignment > ALIGNMENT_FLOOR {
        cosine = cosine.powf(alignment);
    }
    let w = (1.0 - cosine * cosine).clamp(0.0, 1.0);
    (w * w * w).clamp(LEAST_WEIGHT, 1.0) * length
}

/// Each triangle's seed of `seeds`, by rank: the one whose front reaches it first, each step
/// weighed by its turn from that seed (`weighed`).
fn owners(faces: &Faces, seeds: &[usize], alignment: f64) -> Vec<usize> {
    let count = faces.across.len();
    let (mut distance, mut frozen) = (vec![0.0; count], vec![false; count]);
    let mut owner = vec![NONE; count];
    let mut queue = IndexedHeap::<LeastRisingOnTie>::new(count);
    for (rank, &seed) in seeds.iter().enumerate() {
        if !queue.contains(seed as u32) {
            frozen[seed] = true;
            owner[seed] = rank;
            queue.insert(seed as u32, 0.0);
        }
    }
    while let Some(v) = queue.pop() {
        let v = v as usize;
        frozen[v] = true;
        let seed = seeds[owner[v]];
        for &m in &faces.links[v] {
            if frozen[m] {
                continue;
            }
            let step = weighed(
                faces.step(v, m),
                faces.normals[m],
                faces.normals[seed],
                alignment,
            );
            let through = distance[v] + step;
            if !queue.contains(m as u32) {
                (distance[m], owner[m]) = (through, owner[v]);
                queue.insert(m as u32, through as f32);
            } else if through < distance[m] {
                (distance[m], owner[m]) = (through, owner[v]);
                queue.update(m as u32, through as f32);
            }
        }
    }
    owner
}

/// The initial patches of `base`, its faces' graph `faces`, at `settings`' initial count and
/// curvature alignment (module doc). Every triangle is given a seed: each component holds one, and
/// its front reaches all of it.
pub(super) fn initial_patches(
    base: &Base,
    faces: &Faces,
    settings: &HlodPatches,
) -> Vec<Vec<usize>> {
    let points = settings.initial.max(1).min(base.mesh.vertex_count());
    let total: f64 = faces.areas.iter().sum();
    let per_seed = total / points as f64;
    let seeds: Vec<usize> = (components(faces).par_iter())
        .flat_map_iter(|part| {
            let area: f64 = part.iter().map(|&t| faces.areas[t]).sum();
            let wanted = ((area / per_seed).ceil() as i32).max(1) as usize;
            seeds_of(faces, part, wanted)
        })
        .collect();
    let owner = owners(faces, &seeds, settings.curvature_alignment);
    let mut sets: Vec<Vec<usize>> = vec![Vec::new(); seeds.len()];
    for (t, &rank) in owner.iter().enumerate() {
        sets[rank].push(t);
    }
    sets.retain(|set| !set.is_empty());
    let mut regions = Regions::of(&faces.across, sets);
    regions.merge_small(MIN_PATCH_SIZE - 1);
    regions.optimize_borders(BORDER_ROUNDS);
    (regions.into_sets().into_iter())
        .filter(|patch| !patch.is_empty())
        .collect()
}
