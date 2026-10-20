//! The adaptive mesher of a level set at an iso value and an adaptivity, with no mask, reference
//! grid or spatial adaptivity, disoriented triangles relaxed:
//!
//! 1. the voxels whose cell the surface crosses (`intersecting_cells`): every edge of the leaves
//!    whose ends straddle the iso value marks its four cells;
//! 2. each such cell's corner signs, edge flags and ambiguous face correction
//!    (`sign_flags`, `correct_signs`);
//! 3. the cells merged by 2×2×2, 4×4×4 then 8×8×8 blocks inside a leaf where the block is
//!    manifold and its gradients agree within the adaptivity (`merge_regions`);
//! 4. a point per edge group of each cell, or one per merged region at the mean of its cells'
//!    first points (`compute_point`);
//! 5. a quad around every crossed edge, collapsed to a triangle where two of its corners share a
//!    region;
//! 6. the points of triangles facing against the field's gradient moved to the mean of their
//!    polygons (`relax_disoriented`).
//! A cell's values, signs and point live in `cells`, the crossed cells in `edges`, the regions and
//! relaxation in `regions`, the points in `points`, the polygons in `polygons`.
use super::grid::{leaf_offset, leaf_origin, Coord, Grid, Mask, SIZE};
use rayon::prelude::*;
use trillion3d_page_codec::hash::WordMap;
mod cells;
mod edges;
use edges::{intersecting_cells, Offsets};
mod regions;
use regions::{merge_regions, relax_disoriented};
mod points;
use points::{crossed_cells, leaf_points};
mod polygons;
use polygons::polygons;

const SIGNS: i16 = 0xFF;
const EDGES: i16 = 0xE00;
const INSIDE: i16 = 0x100;
const XEDGE: i16 = 0x200;
const YEDGE: i16 = 0x400;
const ZEDGE: i16 = 0x800;
const SEAM: i16 = 0x1000;

/// The invalid point index: the point index tree's background.
const INVALID_POINT: u32 = u32::MAX;

/// The mesher's output: world points, quads, then triangles.
pub(super) struct Mixed {
    pub points: Vec<[f32; 3]>,
    pub quads: Vec<[u32; 4]>,
    pub triangles: Vec<[u32; 3]>,
}

/// The adaptive mesh of the `iso` surface of `grid`, `voxel` its voxel size.
pub(super) fn volume_to_mesh(grid: &Grid, voxel: f64, iso: f64, adaptivity: f64) -> Mixed {
    let iso_value = iso as f32;
    let offsets = Offsets::new();
    let mut cells: WordMap<Coord, Mask> = WordMap::default();
    for index in 0..grid.leaves.len() {
        intersecting_cells(grid, index, &offsets, iso_value, &mut cells);
    }
    let empty = Mixed {
        points: Vec::new(),
        quads: Vec::new(),
        triangles: Vec::new(),
    };
    if cells.is_empty() {
        return empty;
    }

    // Each crossed cell's corner signs, edge flags and ambiguous face correction.
    let mut aux = crossed_cells(grid, cells, iso_value);
    aux.sort_unstable_by_key(|a| super::grid::tree_order(a.origin));
    let find: WordMap<Coord, usize> = aux.iter().enumerate().map(|(i, a)| (a.origin, i)).collect();
    let active = |c: Coord| {
        find.get(&leaf_origin(c))
            .is_some_and(|&i| aux[i].on.is_on(leaf_offset(c)))
    };
    let mut point_index: Vec<Box<[u32; SIZE]>> = aux
        .iter()
        .map(|a| {
            let mut idx = Box::new([INVALID_POINT; SIZE]);
            for pos in a.on.ons() {
                idx[pos] = 0;
            }
            idx
        })
        .collect();

    // The regions merged, only when adaptive (`adaptivity > 1e-7`).
    if adaptivity > 1e-7 {
        point_index
            .par_iter_mut()
            .zip(aux.par_iter())
            .for_each(|(idx, a)| {
                merge_regions(grid, a, idx, &active, iso_value, adaptivity as f32)
            });
    }

    // The points each leaf makes.
    let mut points = leaf_points(grid, &aux, &mut point_index, voxel, iso);

    // The polygons, a quad collapsed to a triangle where two corners share a region.
    let pools = polygons(&aux, &find, &point_index);

    // The disoriented triangles relaxed.
    if adaptivity > 1e-7 {
        relax_disoriented(grid, voxel, &pools, &mut points);
    }
    let quads = pools.iter().flat_map(|p| p.0.iter().copied()).collect();
    let triangles = pools.iter().flat_map(|p| p.1.iter().copied()).collect();
    Mixed {
        points,
        quads,
        triangles,
    }
}
