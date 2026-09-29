//! The texture charts of a primitive: where their seams and islands fall, and what the
//! solve of a seam-locked group reads of them (`solved.rs`) — how much surface a unit of each
//! texture set spans, the seams on the group's open border, the faces it folds across charts.
use super::border::live_triangles;
use super::clusters::edge_key;
use super::*;
use crate::join::Join;
use crate::qem::Attribute;
use crate::shared_math::{cross, length, point, sub};

/// Per texture set of `uv_sets`, the surface length one unit of it spans over the triangles `live`:
/// the square root of their surface area over their texture area; zero where the set spans no area.
pub(super) fn densities(positions: &[f32], uv_sets: &[&[f32]], live: &[u32]) -> Vec<f64> {
    let point = |v: u32| point(positions, v);
    let area = |[a, b, c]: [[f64; 3]; 3]| length(cross(sub(b, a), sub(c, a)));
    let density = |uvs: &[f32]| {
        let texel = |v: u32| {
            let i = v as usize * 2;
            [f64::from(uvs[i]), f64::from(uvs[i + 1]), 0.0]
        };
        let (mut surface, mut texture) = (0.0, 0.0);
        for tri in live.as_chunks::<3>().0 {
            surface += area(tri.map(point));
            texture += area(tri.map(texel));
        }
        Some((surface / texture).sqrt())
            .filter(|d| d.is_finite())
            .unwrap_or(0.0)
    };
    uv_sets.iter().map(|uvs| density(uvs)).collect()
}

/// The attributes the solve weighs: normals as the endpoint reduction weighs them, each texture
/// set by its density over the group's extent — against positions normalised to that extent, a
/// coordinate that slides by `d` costs what moving a position by `d` times the density costs.
pub(super) fn weighted<'a>(
    input: &GroupReductionInput<'a>,
    live: &[u32],
    densities: &[f64],
) -> Vec<Attribute<'a>> {
    let (low, high) = cluster_bounds(input.positions, live);
    let extent = (0..3).map(|a| high[a] - low[a]).fold(0.0, f64::max);
    let mut weighted = input.weighted.to_vec();
    let textures = weighted.iter_mut().filter(|a| a.width == 2);
    for (attribute, density) in textures.zip(densities) {
        let weight = density / extent;
        attribute.weight = if weight.is_finite() {
            weight as f32
        } else {
            0.0
        };
    }
    weighted
}

/// Per source vertex, its texture island: the triangles its copy by position and every texture
/// set (`weld_seam`, empty without a texture set, and so the islands) joins.
pub fn vertex_islands(weld_seam: &[u32], indices: &[u32]) -> Vec<u32> {
    if weld_seam.is_empty() {
        return Vec::new();
    }
    let mut islands = Join::new(weld_seam.len());
    for tri in indices.as_chunks::<3>().0 {
        islands.unite(tri[0], tri[1]);
        islands.unite(tri[1], tri[2]);
    }
    (0..weld_seam.len() as u32).for_each(|v| islands.unite(v, weld_seam[v as usize]));
    (0..weld_seam.len() as u32)
        .map(|v| islands.root(v))
        .collect()
}

/// The longest edge of `tri` over `positions`.
pub(crate) fn longest_edge(positions: &[f32], tri: &[u32; 3]) -> f64 {
    let [a, b, c] = tri.map(|v| point(positions, v));
    length(sub(b, a))
        .max(length(sub(c, b)))
        .max(length(sub(a, c)))
}

/// The longest edge of the faces of `indices` a pixel must hide: those whose corners lie in two
/// texture `islands`, a corner's being its source vertex's (`source`); zero without an island.
pub(super) fn folded_span(
    indices: &[u32],
    positions: &[f32],
    islands: &[u32],
    source: impl Fn(u32) -> usize,
) -> f64 {
    let folded = |tri: &&[u32; 3]| {
        let [a, b, c] = tri.map(|v| islands.get(source(v)));
        a != b || b != c
    };
    let faces = indices.as_chunks::<3>().0.iter().filter(folded);
    faces
        .map(|tri| longest_edge(positions, tri))
        .fold(0.0, f64::max)
}

/// The group's triangles with every copy of a position on its open border — an edge one triangle
/// alone uses —, but a locked one, pointed at the first copy, and what that costs.
/// meshoptimizer keeps a seam corner on an open border where it is: a sheet of one chart per quad
/// keeps its whole outline. One copy there slides along the border like any border vertex, its
/// coordinates solved; the copies it replaces cost their largest coordinate step times their
/// set's density, a distance on the surface like the rest of the group's error.
pub(super) fn open_border_welded(
    input: &GroupReductionInput,
    live: &[u32],
    densities: &[f64],
) -> (Vec<u32>, f64) {
    let weld = |v: u32| input.weld[v as usize];
    let mut edges: HashMap<u64, u32> = HashMap::new();
    for tri in live.as_chunks::<3>().0 {
        for k in 0..3 {
            *edges
                .entry(edge_key(weld(tri[k]), weld(tri[(k + 1) % 3])))
                .or_default() += 1;
        }
    }
    let open: HashSet<u32> = edges
        .into_iter()
        .filter(|&(_, uses)| uses == 1)
        .flat_map(|(key, _)| [(key >> 32) as u32, key as u32])
        .collect();
    let uv_sets = input.attributes.uv_sets();
    let mut first: HashMap<u32, u32> = HashMap::new();
    let mut error = 0.0_f64;
    let corners = live.iter().map(|&v| {
        let w = weld(v);
        if input.locks[v as usize] || !open.contains(&w) {
            return v;
        }
        let copy = *first.entry(w).or_insert(v);
        for (uvs, density) in uv_sets.iter().zip(densities) {
            let (a, b) = (v as usize * 2, copy as usize * 2);
            let step = f64::from(uvs[a] - uvs[b]).hypot(f64::from(uvs[a + 1] - uvs[b + 1]));
            error = error.max(step * density);
        }
        copy
    });
    let welded = live_triangles(corners);
    (welded, error)
}
