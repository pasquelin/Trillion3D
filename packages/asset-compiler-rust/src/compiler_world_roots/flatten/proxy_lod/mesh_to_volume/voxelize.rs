//! The flood, its storage and the voxelisation.
use super::super::grid::{add, leaf_offset, leaf_origin, Coord, Leaf, COORD_OFFSETS, DIM};
use super::closest::closest_point_on_triangle;
use super::IndexMesh;
use rayon::prelude::*;
use trillion3d_math::vecn::{squared_length, sub};
use trillion3d_page_codec::hash::{WordMap, WordSet};

/// One thread's flood state: the voxels a triangle reaches and their squared distances.
#[derive(Default)]
struct Flood {
    pub(super) seen: WordSet<Coord>,
    pub(super) stack: Vec<Coord>,
    pub(super) hits: Vec<(Coord, f32)>,
}

impl Flood {
    /// The squared index distance from voxel `ijk` to the triangle, without the store: the
    /// squared index distance is kept for the merge, and whether the triangle crosses the voxel
    /// decides the flood.
    fn update(&mut self, ijk: Coord, [a, b, c]: [[f64; 3]; 3]) -> bool {
        let center = ijk.map(f64::from);
        let dist = squared_length(sub(center, closest_point_on_triangle(a, c, b, center))) as f32;
        if dist.is_nan() {
            return false;
        }
        self.hits.push((ijk, dist));
        !(f64::from(dist) > 0.75)
    }

    /// One triangle voxelized: a flood from the first corner's voxel.
    fn triangle(&mut self, prim: [[f64; 3]; 3]) {
        let start = prim[0].map(|x| x.floor() as i32);
        self.seen.clear();
        self.stack.clear();
        self.stack.push(start);
        self.update(start, prim);
        self.seen.insert(start);
        while let Some(ijk) = self.stack.pop() {
            for offset in COORD_OFFSETS {
                let n = add(ijk, offset);
                if self.seen.insert(n) && self.update(n, prim) {
                    self.stack.push(n);
                }
            }
        }
    }

    /// One polygon voxelized, split as it goes: with fewer than 1000
    /// polygons, a triangle wider than two leaves is split in four, recursively, until the count
    /// of pieces reaches 1000.
    fn polygon(&mut self, prim: [[f64; 3]; 3], subdivisions: i32, polygons: usize) {
        if subdivisions <= 0 || polygons >= 1000 {
            self.triangle(prim);
            return;
        }
        let [a, b, c] = prim;
        let mid = |p: [f64; 3], q: [f64; 3]| {
            [
                (p[0] + q[0]) * 0.5,
                (p[1] + q[1]) * 0.5,
                (p[2] + q[2]) * 0.5,
            ]
        };
        let (ac, bc, ab) = (mid(a, c), mid(b, c), mid(a, b));
        for piece in [[a, ab, ac], [ab, bc, ac], [ab, b, bc], [ac, bc, c]] {
            self.polygon(piece, subdivisions - 1, polygons * 4);
        }
    }
}

/// The rule a voxel's value is stored by (`Flood::update`), within a leaf and across leaves: the
/// smaller distance, the smaller polygon on a tie. It is the same whatever order the triangles
/// come in, so one shared tree replaces per thread trees and their merge.
fn store(leaves: &mut WordMap<Coord, Box<Leaf>>, ijk: Coord, dist: f32, index: i32) {
    let offset = leaf_offset(ijk);
    match leaves.get_mut(&leaf_origin(ijk)) {
        Some(leaf) => {
            let old = leaf.dist[offset];
            if dist < old {
                leaf.dist[offset] = dist;
                leaf.idx[offset] = index;
                leaf.on.set_on(offset);
            } else if dist == old {
                leaf.idx[offset] = index.min(leaf.idx[offset]);
            }
        }
        None if dist < f32::MAX => {
            let mut leaf = Leaf::new(leaf_origin(ijk));
            leaf.dist[offset] = dist;
            leaf.idx[offset] = index;
            leaf.on.set_on(offset);
            leaves.insert(leaf.origin, leaf);
        }
        None => {}
    }
}

const SHARDS: usize = 256;

fn shard(origin: Coord) -> usize {
    let h = (origin[0] as u32).wrapping_mul(0x9E37_79B1)
        ^ (origin[1] as u32).wrapping_mul(0x85EB_CA77)
        ^ (origin[2] as u32).wrapping_mul(0xC2B2_AE3D);
    (h >> 24) as usize % SHARDS
}

/// Every triangle voxelized into one shared tree.
pub(super) fn voxelize(mesh: &IndexMesh) -> Vec<Box<Leaf>> {
    let polygons = mesh.tris.len();
    let shards: Vec<std::sync::Mutex<WordMap<Coord, Box<Leaf>>>> =
        (0..SHARDS).map(|_| Default::default()).collect();
    (0..polygons)
        .into_par_iter()
        .for_each_init(Flood::default, |flood, n| {
            let prim = mesh.corners(n);
            let subdivisions = if polygons < 1000 {
                subdivision_count(prim)
            } else {
                0
            };
            flood.hits.clear();
            flood.polygon(prim, subdivisions, polygons);
            flood.hits.sort_unstable_by_key(|h| shard(leaf_origin(h.0)));
            for group in flood
                .hits
                .chunk_by(|a, b| shard(leaf_origin(a.0)) == shard(leaf_origin(b.0)))
            {
                let mut leaves = shards[shard(leaf_origin(group[0].0))]
                    .lock()
                    .expect("a voxel shard");
                for &(ijk, dist) in group {
                    store(&mut leaves, ijk, dist, n as i32);
                }
            }
        });
    shards
        .into_iter()
        .flat_map(|s| s.into_inner().expect("a voxel shard").into_values())
        .collect()
}

/// How often a triangle splits: its largest extent over two leaves.
fn subdivision_count([a, b, c]: [[f64; 3]; 3]) -> i32 {
    let extent = |k: usize| a[k].max(b[k].max(c[k])) - a[k].min(b[k].min(c[k]));
    (extent(0).max(extent(1).max(extent(2))) / f64::from(DIM * 2)) as i32
}
