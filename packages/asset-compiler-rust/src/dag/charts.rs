//! The texture charts of a primitive: where their seams and mirrors fall, and what the solve of a
//! seam-locked group reads of them (`solved.rs`) — how much surface a unit of each texture set
//! spans, and the seams on the group's open border.
use super::border::live_triangles;
use super::clusters::edge_key;
use super::*;
use crate::qem::Attribute;
use crate::shared_math::{cross, length, point, sub};

/// Per texture set, the surface length one unit of it spans in the group: the square root of the
/// group's surface area over its texture area; zero where the set spans no area.
pub(super) fn densities(input: &GroupReductionInput, live: &[u32]) -> Vec<f64> {
    let point = |v: u32| point(input.positions, v);
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
        let density = (surface / texture).sqrt();
        if density.is_finite() {
            density
        } else {
            0.0
        }
    };
    input
        .attributes
        .uv_sets()
        .into_iter()
        .map(density)
        .collect()
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
    let mut weighted = input.attributes.weighted();
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

/// Per source vertex, whether its position is written under several texture coordinates: a seam
/// vertex, which permissive simplification must not merge across. `weld` is by position,
/// `weld_seam` by position and every texture set.
pub fn seam_vertices(weld: &[u32], weld_seam: &[u32], indices: &[u32]) -> Vec<bool> {
    let mut first = vec![u32::MAX; weld.len()];
    let mut seam = vec![false; weld.len()];
    for &v in indices {
        let (position, copy) = (weld[v as usize] as usize, weld_seam[v as usize]);
        if first[position] == u32::MAX {
            first[position] = copy;
        } else if first[position] != copy {
            seam[position] = true;
        }
    }
    (0..weld.len()).map(|v| seam[weld[v] as usize]).collect()
}

/// Per source vertex, whether its position is one where a chart meets its mirror image in the
/// source: around it, the triangles of one texture set turn both ways. The artist's layout, read
/// once: a coordinate the solve places may fold, a mirror it is not. Empty without a texture set.
pub fn mirror_vertices(weld: &[u32], uv_sets: &[&[f32]], indices: &[u32]) -> Vec<bool> {
    if uv_sets.is_empty() {
        return Vec::new();
    }
    let mut sides = vec![[0u8; 2]; weld.len()];
    for (set, uvs) in uv_sets.iter().enumerate() {
        for tri in indices.as_chunks::<3>().0 {
            let [s, t, u] = tri.map(|v| [uvs[v as usize * 2], uvs[v as usize * 2 + 1]]);
            let turn = (t[0] - s[0]) * (u[1] - s[1]) - (u[0] - s[0]) * (t[1] - s[1]);
            let side = match turn {
                turn if turn > 0.0 => 1,
                turn if turn < 0.0 => 2,
                _ => continue,
            };
            for &v in tri {
                sides[weld[v as usize] as usize][set] |= side;
            }
        }
    }
    (0..weld.len())
        .map(|v| sides[weld[v] as usize].contains(&3))
        .collect()
}

/// The group's triangles with every copy of a position on its open border — an edge one triangle
/// alone uses —, but a locked or a mirror one, pointed at the first copy, and what that costs.
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
        let kept = input.locks[v as usize] || input.mirrors.get(v as usize) == Some(&true);
        if kept || !open.contains(&w) {
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
