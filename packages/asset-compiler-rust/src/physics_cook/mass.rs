//! The exact mass of a solid a closed mesh bounds, at the runtime's density: volume integrals over
//! its triangles, each summed as the signed tetrahedron it spans with the origin (Tonon, "Explicit
//! exact formulas for the 3-D tetrahedron inertia tensor in terms of its vertex coordinates",
//! J. Math. Stat. 1(1), 2005). By the divergence theorem the sum is the solid's only when every edge
//! meets its reverse once positions are welded: a mesh with an open or one-way edge bounds no
//! volume, and is refused by name.
use super::refused;
use crate::dag::clusters::weld_positions;
use crate::shared_math::{cross, dot};
use crate::Result;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Density a body is weighed at, kg/m³: the runtime's (`SHAPE_DENSITY`, `src/commands.cpp`).
pub(super) const DENSITY: f64 = 1000.0;

/// Whether every edge of `triangles` over `pos`, positions welded, runs once each way as often.
fn closed(pos: &[f32], triangles: &[u32]) -> bool {
    let weld = weld_positions(pos, triangles);
    let mut balance: HashMap<(u32, u32), i64> = HashMap::new();
    for t in triangles.as_chunks::<3>().0 {
        let [a, b, c] = t.map(|i| weld[i as usize]);
        for (from, to) in [(a, b), (b, c), (c, a)].into_iter().filter(|(f, t)| f != t) {
            *balance.entry((from.min(to), from.max(to))).or_default() +=
                if from < to { 1 } else { -1 };
        }
    }
    balance.values().all(|&n| n == 0)
}

/// `mass`, `centerOfMass` and `inertia` about it (nine floats, column-major) of the solid mesh
/// `mesh`'s `triangles` over `pos` bound once scaled by `scale`, at `DENSITY`. Its winding may be
/// either way; a mesh not closed, or closed on no volume, is refused.
pub(super) fn solid_mass(
    pos: &[f32],
    triangles: &[u32],
    scale: [f64; 3],
    mesh: usize,
) -> Result<Value> {
    if triangles.is_empty() || !closed(pos, triangles) {
        return Err(refused(format!(
            "Mesh {mesh} is not closed: it bounds no volume to weigh."
        )));
    }
    let at = |i: u32| [0, 1, 2].map(|k| pos[i as usize * 3 + k] as f64 * scale[k]);
    // Tetrahedra spanned from a corner of the mesh, not the mesh's origin: a mesh far from its
    // origin would otherwise sum huge moments that cancel, losing the inertia to rounding.
    let origin = at(triangles[0]);
    let (mut volume, mut spanned) = (0.0, 0.0);
    let (mut first, mut second) = ([0.0; 3], [[0.0; 3]; 3]);
    for t in triangles.as_chunks::<3>().0 {
        let [a, b, c] = t.map(|i| {
            let p = at(i);
            [0, 1, 2].map(|k| p[k] - origin[k])
        });
        let det = dot(a, cross(b, c));
        let sum = [0, 1, 2].map(|k| a[k] + b[k] + c[k]);
        (volume, spanned) = (volume + det / 6.0, spanned + det.abs() / 6.0);
        for r in 0..3 {
            first[r] += det * sum[r] / 24.0;
            for q in 0..3 {
                let corners = a[r] * a[q] + b[r] * b[q] + c[r] * c[q];
                second[r][q] += det * (corners + sum[r] * sum[q]) / 120.0;
            }
        }
    }
    if volume.abs() <= spanned * 1e-9 {
        return Err(refused(format!(
            "Mesh {mesh} is flat: it has no volume to weigh."
        )));
    }
    // A mesh wound inward, or mirrored by its scale, sums every integral negated.
    let sign = volume.signum();
    let mass = DENSITY * volume * sign;
    let local = first.map(|f| f / volume);
    // Second moments about the centre, then the inertia tensor: trace times identity, less them.
    let about = |r: usize, q: usize| DENSITY * sign * second[r][q] - mass * local[r] * local[q];
    let trace = about(0, 0) + about(1, 1) + about(2, 2);
    let inertia: Vec<f64> = (0..9)
        .map(|k| (k / 3, k % 3))
        .map(|(c, r)| if r == c { trace } else { 0.0 } - about(r, c))
        .collect();
    let centre = [0, 1, 2].map(|k| local[k] + origin[k]);
    Ok(json!({"mass":mass,"centerOfMass":centre,"inertia":inertia}))
}
