//! The points, leaf by leaf in the tree's order: in each leaf first every crossed cell left alone,
//! by rank, its sheets' points in sheet order (`cell::sheet_point`), then every merged region by
//! number, the mean over its crossed cells of each one's first sheet point. Interpolation and
//! means run in double precision on the index grid; each point is scaled by the voxel into world
//! space and rounded to single precision. Each cell's slot receives its first point.
//!
//! The leaves' point counts come first, so that each leaf knows its first point and the leaves
//! then run in parallel.
use super::super::tree::{Leaf, Tree, LEAF_SIZE};
use super::cell::{corner_values, sheet_point};
use super::flags::SIGN_MASK;
use super::sheets::SHEETS;
use rayon::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use trillion3d_math::vector::vecn::{add, scale};

/// The world points of the `iso` surface of `field` on its voxels of `voxel` world units, the
/// slots of `slots` — `0` for a cell alone, else its region — replaced by each cell's first point.
pub(super) fn points(
    field: &Tree<f32>,
    flags: &Tree<u16>,
    slots: &mut Tree<u32>,
    voxel: f64,
    iso: f64,
) -> Vec<[f32; 3]> {
    let leaves: Vec<&Leaf<u16>> = flags.leaves().collect();
    let counts: Vec<u32> = {
        let slot_leaves: Vec<&Leaf<u32>> = slots.leaves().collect();
        leaves
            .par_iter()
            .zip(slot_leaves.par_iter())
            .map(|(leaf, slots)| count(leaf, slots))
            .collect()
    };
    let firsts: Vec<u32> = counts
        .iter()
        .scan(0, |next, &count| {
            let first = *next;
            *next += count;
            Some(first)
        })
        .collect();
    let pieces: Vec<Vec<[f32; 3]>> = slots
        .leaves_mut()
        .into_par_iter()
        .zip(leaves.par_iter())
        .zip(firsts.par_iter())
        .map(|((slots, leaf), &first)| leaf_points(field, leaf, slots, first, voxel, iso))
        .collect();
    pieces.concat()
}

/// A leaf's points: its lone cells' sheets and its regions. A crossed cell's slot is never the
/// empty slot, so every nonzero slot is a region.
fn count(leaf: &Leaf<u16>, slots: &Leaf<u32>) -> u32 {
    let mut regions = BTreeSet::new();
    let mut alone = 0;
    for pos in slots.active() {
        match slots.values[pos] {
            0 => alone += u32::from(SHEETS[usize::from(leaf.values[pos] & SIGN_MASK)][0]),
            region => {
                regions.insert(region);
            }
        }
    }
    alone + regions.len() as u32
}

/// The points of one leaf, numbered from `first`, each cell's slot set to its first point.
fn leaf_points(
    field: &Tree<f32>,
    leaf: &Leaf<u16>,
    slots: &mut Leaf<u32>,
    first: u32,
    voxel: f64,
    iso: f64,
) -> Vec<[f32; 3]> {
    let source = field.leaf(leaf.origin);
    // A cell's voxel on the index grid, its settled signs, and its corner values widened.
    let cell = |pos: usize| {
        let c = leaf.coord(pos);
        let signs = (leaf.values[pos] & SIGN_MASK) as u8;
        let values = corner_values(field, source, c).map(f64::from);
        (c.map(f64::from), signs, values)
    };
    let world = |p: [f64; 3]| p.map(|x| (x * voxel) as f32);
    let mut next = first;
    let mut points = Vec::new();
    let mut regions: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
    for pos in 0..LEAF_SIZE {
        if !slots.is_on(pos) {
            continue;
        }
        let region = slots.values[pos];
        if region != 0 {
            regions.entry(region).or_default().push(pos);
            continue;
        }
        slots.values[pos] = next;
        let (at, signs, values) = cell(pos);
        for sheet in 1..=SHEETS[usize::from(signs)][0] {
            points.push(world(add(sheet_point(values, signs, sheet, iso), at)));
            next += 1;
        }
    }
    // A region's cells cross a single sheet each: its first point is its only one.
    for cells in regions.values() {
        let mut sum = [0.0; 3];
        for &pos in cells {
            slots.values[pos] = next;
            let (at, signs, values) = cell(pos);
            sum = add(sum, add(at, sheet_point(values, signs, 1, iso)));
        }
        if cells.len() > 1 {
            sum = scale(sum, 1.0 / cells.len() as f64);
        }
        points.push(world(sum));
        next += 1;
    }
    points
}
