//! Convex decomposition of a declared dynamic body that declares no shape, after the hierarchical
//! approximate convex decomposition of the literature (Mamou & Ghorbel, "A simple and efficient
//! approach for 3D mesh approximate convexification", ICIP 2009; the plane-cut refinement of
//! V-HACD): a part is kept when its concavity — the largest distance from its surface points to
//! its hull's boundary — is within the tolerance, else it is cut in two at the median of its
//! triangles' centres along their longest axis (`bisect_centres`), and each half is judged again. A
//! flat part, which has no hull, is dropped. Depth is bounded: at most `1 << MAX_DEPTH` hulls.
use super::hulls::hull_planes;
use crate::qem::compact_region;
use crate::shared_math::bisect_centres;

/// Cuts a part may go through: 64 hulls at most, the cap on a body's compound, kept at cook.
const MAX_DEPTH: u32 = 6;

/// Whether a part's surface samples (its vertices `points` and its triangles' `centres`) reach
/// deeper than `tolerance` under its hull's boundary.
fn concave(points: &[f32], centres: &[[f64; 3]], planes: &[[f32; 4]], tolerance: f64) -> bool {
    let depth = |p: [f64; 3]| {
        let under = |q: &[f32; 4]| -(0..3).map(|a| q[a] as f64 * p[a]).sum::<f64>() - q[3] as f64;
        planes.iter().map(under).fold(f64::MAX, f64::min)
    };
    let vertices = points.as_chunks::<3>().0.iter().map(|p| p.map(f64::from));
    vertices
        .chain(centres.iter().copied())
        .any(|p| depth(p) > tolerance)
}

fn split(pos: &[f32], triangles: &[u32], tolerance: f64, depth: u32, out: &mut Vec<Vec<f32>>) {
    let points = compact_region(pos, triangles).0;
    let planes = hull_planes(&points);
    // Jolt builds a flat part's hull as two back-to-back faces: it has no volume, so no mass.
    if planes.len() < 4 {
        return;
    }
    let tris = triangles.as_chunks::<3>().0;
    let corner = |i: u32, a: usize| pos[i as usize * 3 + a] as f64;
    let centres: Vec<[f64; 3]> = (tris.iter())
        .map(|t| [0, 1, 2].map(|a| t.iter().map(|&i| corner(i, a)).sum::<f64>() / 3.0))
        .collect();
    if depth >= MAX_DEPTH || tris.len() < 4 || !concave(&points, &centres, &planes, tolerance) {
        return out.push(points);
    }
    let mut ids: Vec<usize> = (0..tris.len()).collect();
    bisect_centres(&mut ids, &centres);
    let (below, above) = ids.split_at(ids.len() / 2);
    for half in [below, above] {
        let half: Vec<u32> = half.iter().flat_map(|&t| tris[t]).collect();
        split(pos, &half, tolerance, depth + 1, out);
    }
}

/// The hulls' point sets of `triangles` over `pos`, each part within `tolerance` of convex.
pub(crate) fn decompose(pos: &[f32], triangles: &[u32], tolerance: f64) -> Vec<Vec<f32>> {
    let mut out = Vec::new();
    split(pos, triangles, tolerance, 0, &mut out);
    out
}
