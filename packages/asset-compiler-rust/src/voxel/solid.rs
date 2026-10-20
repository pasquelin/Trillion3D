//! Which sampled voxels are solid, by coverage redistribution, so a thin surface's partial coverage
//! gathers into whole voxels instead of vanishing: the least covered voxel left is dropped and its
//! coverage handed to its neighbours among the 26 around it, each by the projected area of its
//! normal distribution toward it — a wall moves across itself, not along —, until no more voxels
//! are left than the coverage sampled sums to: the voxels keep the opacity the surface had, a
//! sparse crown no denser than its leaves. A neighbour's coverage takes the share as an overlap
//! does, `a + b − ab`, and its sums the share's, each side weighed by the half of the other it does
//! not hide. A solid voxel then shows what its faces open on a voxel left empty see — a building's
//! walls from the street, not its core from inside —, all of them where none that opens sees
//! anything.
use super::raster::Cell;
use super::sample::{sample, symmetric, Moments, Probe, FACES};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use trillion3d_math::vecn::squared_length;

/// A sampled voxel, as the compiler alone holds it: its coverage, each face's sums and, once
/// solid, the sums it shows, and the joint most of its triangles follow. Its record keeps what
/// the runtime reads of it (`bricks::voxel_record`).
#[derive(Clone)]
pub(super) struct Voxel {
    pub cell: Cell,
    pub coverage: f64,
    pub faces: [Moments; FACES],
    pub shown: Moments,
    pub joint: Option<u16>,
}

impl Voxel {
    /// Cell `cell` of side `side` sampled (`sample`) against its overlapping triangles `ranks`, its
    /// joint `joint`: what an HLOD cell's levels and a mesh's far groups both sample.
    pub(super) fn sampled(
        probe: &Probe<'_>,
        (cell, side): (Cell, f64),
        ranks: &[u32],
        joint: Option<u16>,
    ) -> Self {
        let (coverage, faces) = sample(probe, cell, side, ranks);
        Self {
            cell,
            coverage,
            faces,
            shown: Moments::default(),
            joint,
        }
    }
}

/// The solid voxels of `voxels`, in their order.
pub(super) fn solid(voxels: Vec<Voxel>) -> Vec<Voxel> {
    let mut voxels: Vec<Voxel> = voxels.into_iter().filter(|v| v.coverage > 0.0).collect();
    let at: HashMap<Cell, usize> = (voxels.iter().enumerate())
        .map(|(i, v)| (v.cell, i))
        .collect();
    let mut alive = vec![true; voxels.len()];
    let (mut left, covered) = (voxels.len(), voxels.iter().map(|v| v.coverage).sum::<f64>());
    // Least covered first, ties by order; a voxel's entry is current while its coverage is.
    let mut heap: BinaryHeap<Reverse<(u64, usize)>> = (voxels.iter().enumerate())
        .map(|(i, v)| Reverse((v.coverage.to_bits(), i)))
        .collect();
    while left as f64 > covered {
        let Some(Reverse((bits, i))) = heap.pop() else {
            break;
        };
        if !alive[i] || bits != voxels[i].coverage.to_bits() {
            continue;
        }
        alive[i] = false;
        left -= 1;
        let (cell, coverage, faces) = (voxels[i].cell, voxels[i].coverage, voxels[i].faces);
        let all = sum(faces.iter());
        let ndf = symmetric(all.ndf, all.hits.max(f64::MIN_POSITIVE));
        // At most the 26 around it, held on the stack: no allocation a dropped voxel.
        let mut neighbours = [(0usize, 0.0f64); OFFSETS.len()];
        let mut count = 0;
        for o in &OFFSETS {
            let Some(&j) = at.get(&[cell[0] + o[0], cell[1] + o[1], cell[2] + o[2]]) else {
                continue;
            };
            let weight = projected_area(&ndf, o.map(f64::from));
            if alive[j] && weight > 0.0 {
                neighbours[count] = (j, weight);
                count += 1;
            }
        }
        let neighbours = &neighbours[..count];
        let total: f64 = neighbours.iter().map(|n| n.1).sum();
        for &(j, weight) in neighbours {
            let share = coverage * weight / total;
            let held = voxels[j].coverage;
            let (given, kept) = (1.0 - 0.5 * held, 1.0 - 0.5 * share);
            let neighbour = &mut voxels[j];
            for (mine, theirs) in neighbour.faces.iter_mut().zip(&faces) {
                *mine = mine.blend(kept, theirs, given * weight / total);
            }
            neighbour.coverage = share + held - share * held;
            heap.push(Reverse((neighbour.coverage.to_bits(), j)));
        }
    }
    let solid = |c: Cell| at.get(&c).is_some_and(|&j| alive[j]);
    (voxels.into_iter().zip(&alive))
        .filter(|(_, &alive)| alive)
        .map(|(mut v, _)| {
            // Face `2a` takes rays along `+a`, from the voxel before it on axis `a`.
            let open = |face: usize| {
                let mut from = v.cell;
                from[face / 2] += if face % 2 == 0 { -1 } else { 1 };
                !solid(from)
            };
            let seen = |f: &usize| open(*f) && v.faces[*f].hits > 0.0;
            let opened = (0..FACES).filter(seen).map(|f| &v.faces[f]);
            v.shown = match opened.clone().count() {
                0 => sum(v.faces.iter()),
                _ => sum(opened),
            };
            v
        })
        .collect()
}

/// The sum of `moments`.
fn sum<'a>(moments: impl Iterator<Item = &'a Moments>) -> Moments {
    moments.fold(Moments::default(), |all, m| all.blend(1.0, m, 1.0))
}

/// The 26 neighbours of a voxel.
const OFFSETS: [[i32; 3]; 26] = {
    let mut out = [[0; 3]; 26];
    let (mut k, mut n) = (0, 0);
    while k < 27 {
        if k != 13 {
            out[n] = [k % 3 - 1, k / 3 % 3 - 1, k / 9 - 1];
            n += 1;
        }
        k += 1;
    }
    out
};

/// The area the normal distribution `ndf` (the mean of the normals' products) shows along `d`:
/// `√(dᵀ S d)` over `|d|`, a plane's `|n · d|`.
fn projected_area(ndf: &[[f64; 3]; 3], d: [f64; 3]) -> f64 {
    let along: f64 = (0..3)
        .map(|i| d[i] * (0..3).map(|j| ndf[i][j] * d[j]).sum::<f64>())
        .sum();
    let length2 = squared_length(d);
    (along.max(0.0) / length2).sqrt()
}
