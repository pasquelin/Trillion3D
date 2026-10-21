//! The field's active values, in single precision (steps 5 to 7 of `field`):
//!
//! - the squared distances in voxels² made world distances, the voxel times their root, negative
//!   where the value was not negative — inside, the outside being negative until then
//!   (`world_distances`);
//! - one step of the eikonal equation `|∇φ| = 1`: every value lowered by `0.8` voxel, a step
//!   `φ − Δx · S(φ) · (|∇φ| / Δx − 1)` computed for each from the lowered field, `S(φ) =
//!   φ / √(φ² + |∇φ|²)`, `|∇φ|²` by Godunov's upwind scheme on the one-sided differences, then
//!   each value made the lesser of itself and its step and raised back by `0.8` voxel less
//!   `MARGIN` (`relax`);
//! - the values at or past the band's width, either side, set to it and made inactive (`trim`).
//!
//! A step reads only the lowered field and writes its own buffer: each leaf runs in parallel.
use super::super::tree::{shift, Coord, Leaf, Tree, LEAF_SIZE};
use super::MARGIN;
use crate::hlod::flatten::uv::extremes::{greater, lesser};
use rayon::prelude::*;

/// Each squared distance in voxels² made a world distance, signed: positive outside, where it was
/// negative, negative inside.
pub(super) fn world_distances(tree: &mut Tree<f32>, voxel: f32) {
    change_active(tree, |value| {
        let sign = if *value < 0.0 { voxel } else { -voxel };
        *value = sign * value.abs().sqrt();
        true
    });
}

/// The distances relaxed by one step of the eikonal equation, never above their former value
/// but for the `MARGIN` they come back short of.
pub(super) fn relax(tree: &mut Tree<f32>, voxel: f32) {
    let offset = (0.8 * f64::from(voxel)) as f32;
    change_active(tree, |value| {
        *value -= offset;
        true
    });
    let steps: Vec<Box<[f32; LEAF_SIZE]>> = {
        let field = &*tree;
        let leaves: Vec<&Leaf<f32>> = field.leaves().collect();
        leaves
            .par_iter()
            .map(|&leaf| step(field, leaf, voxel))
            .collect()
    };
    let back = offset - MARGIN;
    tree.leaves_mut()
        .into_par_iter()
        .zip(steps)
        .for_each(|(leaf, steps)| {
            for pos in 0..LEAF_SIZE {
                if leaf.is_on(pos) {
                    leaf.values[pos] = lesser(leaf.values[pos], steps[pos]) + back;
                }
            }
        });
}

/// The active values at or past `outside`, or at or below `−inside`, set to that bound and made
/// inactive.
pub(super) fn trim(tree: &mut Tree<f32>, outside: f32, inside: f32) {
    let inner = -inside;
    change_active(tree, |value| {
        let below = *value < 0.0;
        if below && !(*value > inner) {
            *value = inner;
            false
        } else if !below && !(*value < outside) {
            *value = outside;
            false
        } else {
            true
        }
    });
}

/// The step of each active value of `leaf`, by rank, read from `field`.
fn step(field: &Tree<f32>, leaf: &Leaf<f32>, voxel: f32) -> Box<[f32; LEAF_SIZE]> {
    let inverse = 1.0 / voxel;
    let mut steps = Box::new([0.0; LEAF_SIZE]);
    for pos in leaf.active() {
        let phi = leaf.values[pos];
        let voxel_at = leaf.coord(pos);
        let at = |d: Coord| field.get(shift(voxel_at, d));
        let up = [
            at([1, 0, 0]) - phi,
            at([0, 1, 0]) - phi,
            at([0, 0, 1]) - phi,
        ];
        let down = [
            phi - at([-1, 0, 0]),
            phi - at([0, -1, 0]),
            phi - at([0, 0, -1]),
        ];
        let gradient = upwind_gradient(phi > 0.0, down, up);
        let excess = gradient.sqrt() * inverse - 1.0;
        let sign = phi / (phi * phi + gradient).sqrt();
        steps[pos] = phi - voxel * sign * excess;
    }
    steps
}

/// `|∇φ|²` by Godunov's upwind scheme from the backward differences `down` and the forward ones
/// `up`: each axis the larger square of the backward difference's positive part and the
/// forward's negative part outside, of the backward's negative part and the forward's positive
/// part inside, summed `x`, `y`, `z`.
fn upwind_gradient(outside: bool, down: [f32; 3], up: [f32; 3]) -> f32 {
    let axis = |k: usize| {
        let (back, ahead) = match outside {
            true => (greater(down[k], 0.0), lesser(up[k], 0.0)),
            false => (lesser(down[k], 0.0), greater(up[k], 0.0)),
        };
        greater(back * back, ahead * ahead)
    };
    let mut sum = axis(0);
    sum += axis(1);
    sum += axis(2);
    sum
}

/// Each active value of `tree` passed to `change`, the leaves in parallel; a value it returns
/// `false` for made inactive.
fn change_active(tree: &mut Tree<f32>, change: impl Fn(&mut f32) -> bool + Sync) {
    tree.leaves_mut().into_par_iter().for_each(|leaf| {
        for pos in 0..LEAF_SIZE {
            if leaf.is_on(pos) && !change(&mut leaf.values[pos]) {
                leaf.set_on(pos, false);
            }
        }
    });
}
