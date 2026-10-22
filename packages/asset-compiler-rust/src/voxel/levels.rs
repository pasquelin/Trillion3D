//! An HLOD cell's voxels: its objects voxelized together, level after level, as a mesh's far
//! groups are (`stage.rs`), each voxel crossed by the same rays (`VoxelSampling`, the layer's)
//! against the objects' level-0 triangles in world space — a cut texel letting a ray through
//! (`sample.rs`) —, the least covered dropped until no more are left
//! than the coverage sums to (`solid.rs`), packed in 4³ bricks (`bricks.rs`). Level 0's side is
//! the pixel where the cell is first seen; each level doubles it, on a grid aligned with the one
//! below — a voxel of level `k + 1` holds eight of level `k` —, and samples every cell the level
//! below kept or dropped for its coverage, and those no ray hit when too few rays were cast to
//! tell that they hold nothing (`VoxelSampling::remembers_empty`), so a thin part's coverage still
//! gathers higher up. Levels go on until one brick holds the cell.
//!
//! A cell holds millions of voxels where a forest stands: each level is sampled tile by tile,
//! `TILE` bricks a side, each tile reading only the triangles that reach it and leaving only its
//! bricks' records — 12 bytes a voxel —, so the bytes held stay bounded whatever the cell holds.
use super::bricks::{bricks, voxel_record, VOXEL_BYTES};
use super::raster::{binned, cells, Cell};
use super::rays::Sampler;
use super::sample::Probe;
use super::solid::{solid, Voxel};
use super::VoxelSampling;
use crate::trace::surface::Traceable;
use crate::trace::tracer::vertex;
use rayon::prelude::*;
use std::collections::BTreeMap;
use trillion3d_math::geometry::aabb::aabb_of;
use trillion3d_page_codec::hash::WordMap;

/// Bricks a tile's side holds: a tile's voxels and their sums, at most 32³, fit a few tens of
/// megabytes on each core that samples one.
const TILE: i32 = 8;
/// Cells a tile's side holds.
const TILE_CELLS: i32 = TILE * 4;
/// Levels a cell has at most: 2^16 voxels wide at its first level, past any cell's.
const MAX_LEVELS: usize = 16;

/// One brick of a level as the pages read it: its corner in bricks on the level's grid, its mask
/// (bit `x + 4y + 16z`), its joint, and each voxel's record (`voxel_record`) in its mask's order.
#[derive(Clone)]
pub(crate) struct LevelBrick {
    pub at: [i32; 3],
    pub mask: u64,
    pub joint: Option<u16>,
    pub records: Vec<[u8; VOXEL_BYTES]>,
}

/// One level: its voxels' side, world units, and its bricks, tile by tile, each tile's in the
/// order `bricks` gives them.
#[derive(Clone)]
pub(crate) struct VoxelLevel {
    pub side: f64,
    pub bricks: Vec<LevelBrick>,
}

/// The tile of cell `cell`.
fn tile_of(cell: Cell) -> Cell {
    cell.map(|c| c.div_euclid(TILE_CELLS))
}

/// The cells, by tile, that `mesh`'s triangles overlap at side `side`, and each tile's triangles.
type Tiled = (BTreeMap<Cell, Vec<Cell>>, WordMap<Cell, Vec<u32>>);

/// Each triangle of `mesh` in the tiles its box, `reach` cells wider each way, reaches at side
/// `side`; with `seed`, each cell it overlaps too, by tile — level 0's cells.
fn tiled(mesh: &Traceable, side: f64, (seed, reach): (bool, i32)) -> Tiled {
    let world = &mesh.world;
    let count = world.tags.len();
    let mut tris: WordMap<Cell, Vec<u32>> = WordMap::default();
    let mut found: BTreeMap<Cell, Vec<Cell>> = BTreeMap::new();
    for t in 0..count {
        let c = [0, 1, 2].map(|k| vertex(world, t, k));
        let (lo, hi) = aabb_of(c);
        let cell = |v: f64, away: i32| ((v / side).floor() as i32).saturating_add(away);
        let low = tile_of(lo.map(|v| cell(v, -reach)));
        let high = tile_of(hi.map(|v| cell(v, reach)));
        for z in low[2]..=high[2] {
            for y in low[1]..=high[1] {
                for x in low[0]..=high[0] {
                    tris.entry([x, y, z]).or_default().push(t as u32);
                }
            }
        }
        if seed {
            cells(c, side, |cell| {
                found.entry(tile_of(cell)).or_default().push(cell)
            });
        }
    }
    for list in found.values_mut() {
        list.sort_unstable_by_key(|c| (c[2], c[1], c[0]));
        list.dedup();
    }
    (found, tris)
}

/// The voxels of the cells `candidates` of one tile, sampled against its triangles `tris`, the
/// solid ones packed in bricks, and the cells the next level samples again: those sampled that a
/// ray hit, and those none did when too few rays were cast to tell that they hold nothing.
fn tile_bricks(
    probe: &Probe<'_>,
    side: f64,
    candidates: &[Cell],
    tris: &[u32],
) -> (Vec<LevelBrick>, Vec<Cell>) {
    let sampling = &probe.sampling;
    let bins = binned(
        &probe.mesh.world,
        (candidates, side),
        sampling.reach(),
        tris.iter().map(|&t| t as usize),
    );
    let sampled: Vec<Voxel> = (candidates.iter().zip(&bins).zip(0u32..))
        .map(|((&cell, ranks), rank)| Voxel::sampled(probe, (cell, side, rank), ranks, None))
        .collect();
    let remembered = (sampled.iter())
        .filter(|v| v.coverage > 0.0 || sampling.remembers_empty())
        .map(|v| v.cell)
        .collect();
    let voxels = solid(sampled, sampling.redistributes());
    let packed = (bricks(&voxels).into_iter())
        .map(|brick| LevelBrick {
            at: brick.at,
            mask: brick.mask,
            joint: brick.joint,
            records: (brick.voxels.iter())
                .map(|&v| voxel_record(&voxels[v], sampling))
                .collect(),
        })
        .collect();
    (packed, remembered)
}

/// The levels of `mesh` — an HLOD cell's objects in world space — from side `first`, finest
/// first, sampled as `sampling` says (the layer's), `checkpoint` asked between levels; none when
/// its first level keeps no voxel.
pub(crate) fn cell_levels(
    mesh: &Traceable,
    first: f64,
    sampling: VoxelSampling,
    checkpoint: &(dyn Fn() -> crate::Result<()> + Sync),
) -> crate::Result<Vec<VoxelLevel>> {
    let near = vec![0.0; mesh.world.tags.len()];
    let sampler = Sampler::of(&sampling);
    let probe = Probe {
        mesh,
        near: &near,
        tie: mesh.tie(),
        sampling,
        sampler: &sampler,
    };
    let mut levels: Vec<VoxelLevel> = Vec::new();
    let mut side = first;
    let mut candidates: Option<BTreeMap<Cell, Vec<Cell>>> = None;
    while side > 0.0 && levels.len() < MAX_LEVELS {
        checkpoint()?;
        let (seeded, tris) = tiled(mesh, side, (candidates.is_none(), sampling.reach()));
        let by_tile = candidates.take().unwrap_or(seeded);
        let tiles: Vec<(&Cell, &Vec<Cell>)> = by_tile.iter().collect();
        let made: Vec<(Vec<LevelBrick>, Vec<Cell>)> = tiles
            .par_iter()
            .map(|(tile, cells)| {
                let tris = tris.get(*tile).map_or(&[][..], Vec::as_slice);
                tile_bricks(&probe, side, cells, tris)
            })
            .collect();
        // The tiles go before the next level's are made: a forest's hold millions of cells.
        drop(by_tile);
        let (built, remembered): (Vec<_>, Vec<_>) = made.into_iter().unzip();
        let level = VoxelLevel {
            side,
            bricks: built.into_iter().flatten().collect(),
        };
        if level.bricks.is_empty() {
            break;
        }
        let last = level.bricks.len() <= 1;
        levels.push(level);
        if last {
            break;
        }
        // The next level samples again every cell this one remembers, a level up: its tiles hold
        // them.
        let mut next: BTreeMap<Cell, Vec<Cell>> = BTreeMap::new();
        for cell in remembered.iter().flatten() {
            let up = cell.map(|c| c.div_euclid(2));
            next.entry(tile_of(up)).or_default().push(up);
        }
        for list in next.values_mut() {
            list.sort_unstable_by_key(|c| (c[2], c[1], c[0]));
            list.dedup();
        }
        candidates = Some(next);
        side *= 2.0;
    }
    Ok(levels)
}
