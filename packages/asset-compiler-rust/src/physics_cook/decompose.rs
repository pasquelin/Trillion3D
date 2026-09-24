//! Convex decomposition of a declared dynamic body that declares no shape, after the hierarchical
//! approximate convex decomposition of the literature (Mamou & Ghorbel, "A simple and efficient
//! approach for 3D mesh approximate convexification", ICIP 2009; the plane-cut refinement of
//! V-HACD): a part is kept when its concavity — the largest distance from its surface points to
//! its hull's boundary — is within the tolerance, else it is cut in two across its longest axis at
//! its centroid, and each half is judged again. Depth is bounded: at most `1 << MAX_DEPTH` hulls.
use super::hull_planes;

/// Cuts a part may go through: 64 hulls at most, the grain of a body's compound.
const MAX_DEPTH: u32 = 6;

fn points_of(pos: &[f32], triangles: &[u32]) -> Vec<f32> {
    let mut seen = std::collections::BTreeSet::new();
    let mut points = Vec::new();
    for &i in triangles {
        if seen.insert(i) {
            points.extend_from_slice(&pos[i as usize * 3..i as usize * 3 + 3]);
        }
    }
    points
}

/// Largest distance from a part's surface samples (vertices and centroids) to its hull boundary.
fn concavity(pos: &[f32], triangles: &[u32], planes: &[[f32; 4]]) -> f64 {
    let depth = |p: [f32; 3]| {
        planes
            .iter()
            .map(|q| -(q[0] * p[0] + q[1] * p[1] + q[2] * p[2] + q[3]) as f64)
            .fold(f64::MAX, f64::min)
            .max(0.0)
    };
    triangles
        .chunks_exact(3)
        .flat_map(|tri| {
            let v = |k: usize| {
                let at = tri[k] as usize * 3;
                [pos[at], pos[at + 1], pos[at + 2]]
            };
            let centroid = [0, 1, 2].map(|a| (v(0)[a] + v(1)[a] + v(2)[a]) / 3.0);
            [v(0), v(1), v(2), centroid]
        })
        .map(depth)
        .fold(0.0, f64::max)
}

fn split(pos: &[f32], triangles: &[u32], tolerance: f64, depth: u32, out: &mut Vec<Vec<f32>>) {
    let points = points_of(pos, triangles);
    let planes = hull_planes(&points);
    if planes.is_empty() {
        return;
    }
    if depth >= MAX_DEPTH || triangles.len() < 12 || concavity(pos, triangles, &planes) <= tolerance
    {
        return out.push(points);
    }
    let (mut min, mut max) = ([f32::MAX; 3], [f32::MIN; 3]);
    for p in points.chunks_exact(3) {
        for a in 0..3 {
            min[a] = min[a].min(p[a]);
            max[a] = max[a].max(p[a]);
        }
    }
    let axis = (0..3)
        .max_by(|&a, &b| (max[a] - min[a]).total_cmp(&(max[b] - min[b])))
        .unwrap_or(0);
    let centre = |tri: &[u32]| tri.iter().map(|&i| pos[i as usize * 3 + axis]).sum::<f32>() / 3.0;
    let mut centres: Vec<f32> = triangles.chunks_exact(3).map(centre).collect();
    let middle = centres.len() / 2;
    let cut = *centres.select_nth_unstable_by(middle, f32::total_cmp).1;
    let (mut below, mut above) = (Vec::new(), Vec::new());
    for tri in triangles.chunks_exact(3) {
        if centre(tri) < cut {
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
