//! Convex decomposition of a declared dynamic body that declares no shape, after the hierarchical
//! approximate convex decomposition of the literature (Mamou & Ghorbel, "A simple and efficient
//! approach for 3D mesh approximate convexification", ICIP 2009; the plane-cut refinement of
//! V-HACD): a part is kept when its concavity — the largest distance from its surface points to
//! its hull's boundary — is within the tolerance, else it is cut in two across its longest axis at
//! the median of its triangles' centres, and each half is judged again. A flat part, which has no
//! hull, is dropped. Depth is bounded: at most `1 << MAX_DEPTH` hulls.
use super::hulls::hull_planes;
use crate::qem::compact_region;
use crate::shared_math::{extend_aabb_f32, longest_axis};

/// Cuts a part may go through: 64 hulls at most, the cap on a body's compound, kept at cook.
const MAX_DEPTH: u32 = 6;

/// Whether a part's surface samples (vertices and centroids) reach deeper than `tolerance` under
/// its hull's boundary.
fn concave(pos: &[f32], triangles: &[u32], planes: &[[f32; 4]], tolerance: f64) -> bool {
    let depth = |p: [f32; 3]| {
        planes
            .iter()
            .map(|q| -(q[0] * p[0] + q[1] * p[1] + q[2] * p[2] + q[3]) as f64)
            .fold(f64::MAX, f64::min)
    };
    triangles
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|tri| {
            let v = |k: usize| {
                let at = tri[k] as usize * 3;
                [pos[at], pos[at + 1], pos[at + 2]]
            };
            let centroid = [0, 1, 2].map(|a| (v(0)[a] + v(1)[a] + v(2)[a]) / 3.0);
            [v(0), v(1), v(2), centroid]
        })
        .any(|p| depth(p) > tolerance)
}

fn split(pos: &[f32], triangles: &[u32], tolerance: f64, depth: u32, out: &mut Vec<Vec<f32>>) {
    let points = compact_region(pos, triangles).0;
    let planes = hull_planes(&points);
    // Jolt builds a flat part's hull as two back-to-back faces: it has no volume, so no mass.
    if planes.len() < 4 {
        return;
    }
    if depth >= MAX_DEPTH || triangles.len() < 12 || !concave(pos, triangles, &planes, tolerance) {
        return out.push(points);
    }
    let (mut min, mut max) = ([f32::MAX; 3], [f32::MIN; 3]);
    for &p in points.as_chunks::<3>().0 {
        extend_aabb_f32(&mut min, &mut max, p);
    }
    let axis = longest_axis(&min.map(f64::from), &max.map(f64::from));
    let centre =
        |tri: &[u32; 3]| tri.iter().map(|&i| pos[i as usize * 3 + axis]).sum::<f32>() / 3.0;
    let mut centres: Vec<f32> = triangles.as_chunks::<3>().0.iter().map(centre).collect();
    let middle = centres.len() / 2;
    let cut = *centres.select_nth_unstable_by(middle, f32::total_cmp).1;
    // Half the triangles or more centred on the lowest value: the ties go below, else no cut.
    let ties_below = centres[..middle].iter().all(|&c| c >= cut);
    let (mut below, mut above) = (Vec::new(), Vec::new());
    for tri in triangles.as_chunks::<3>().0.iter() {
        let c = centre(tri);
        if c < cut || (ties_below && c == cut) {
            &mut below
        } else {
            &mut above
        }
        .extend_from_slice(tri);
    }
    if below.is_empty() || above.is_empty() {
        return out.push(points);
    }
    split(pos, &below, tolerance, depth + 1, out);
    split(pos, &above, tolerance, depth + 1, out);
}

/// The hulls' point sets of `triangles` over `pos`, each part within `tolerance` of convex.
pub(crate) fn decompose(pos: &[f32], triangles: &[u32], tolerance: f64) -> Vec<Vec<f32>> {
    let mut out = Vec::new();
    split(pos, triangles, tolerance, 0, &mut out);
    out
}
