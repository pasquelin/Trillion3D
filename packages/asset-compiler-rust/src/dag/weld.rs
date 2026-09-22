//! Vertices welded by what they share: the canonical vertex of every position, the lock table a
//! level derives from it, and the (position, uv) weld a stalled reduction falls back on.
use super::*;

/// A value's bits, with the two zeros as one: they draw the same vertex.
pub(crate) fn normalized_bits(value: f32) -> u32 {
    if value == 0.0 {
        0
    } else {
        value.to_bits()
    }
}
pub(crate) fn position_key(positions: &[f32], id: u32) -> [u32; 3] {
    let i = id as usize * 3;
    [
        normalized_bits(positions[i]),
        normalized_bits(positions[i + 1]),
        normalized_bits(positions[i + 2]),
    ]
}

/// Canonical vertex per key: the first vertex seen under a key stands for every later one. Built
/// from the vertices an index list names, in its order, so the result depends on the mesh alone.
pub(crate) fn weld_by<K: std::hash::Hash + Eq>(
    count: usize,
    indices: &[u32],
    key: impl Fn(u32) -> K,
) -> Vec<u32> {
    let mut canonical: Vec<u32> = (0..count as u32).collect();
    let mut seen: HashMap<K, u32> = HashMap::with_capacity(indices.len() / 2);
    let mut visited = vec![false; count];
    for &id in indices {
        let slot = id as usize;
        if slot >= count || visited[slot] {
            continue;
        }
        visited[slot] = true;
        canonical[slot] = *seen.entry(key(id)).or_insert(id);
    }
    canonical
}
/// Canonical vertex per position: duplicated vertices at UV or normal seams are one point, so a
/// lock placed on one copy locks every copy and no seam can crack.
pub(crate) fn weld_positions(positions: &[f32], indices: &[u32]) -> Vec<u32> {
    weld_by(positions.len() / 3, indices, |id| {
        position_key(positions, id)
    })
}
/// Canonical vertex per (position, texture coordinates): the copies that differ only by their
/// normal or their colour are one point, those on a texture seam — of either set — stay two. It
/// is the weld a stalled reduction falls back on, so a coarse level never draws one side of a
/// seam with the other side's texture.
fn weld_positions_and_uv(positions: &[f32], uvs: &TextureSets<'_>, indices: &[u32]) -> Vec<u32> {
    weld_by(positions.len() / 3, indices, |id| {
        seam_key(positions, uvs, id)
    })
}
/// The texture coordinate sets a primitive carries, two floats per vertex each.
pub type TextureSets<'a> = [Option<&'a [f32]>; 2];
fn seam_key(positions: &[f32], uvs: &TextureSets<'_>, id: u32) -> ([u32; 3], [u32; 4]) {
    let i = id as usize * 2;
    let uv =
        |set: Option<&[f32]>| set.map_or([0, 0], |uvs| [uvs[i], uvs[i + 1]].map(normalized_bits));
    let [a, b] = [uv(uvs[0]), uv(uvs[1])];
    (position_key(positions, id), [a[0], a[1], b[0], b[1]])
}
/// The two welds of a build.
pub struct Welds {
    pub position: Vec<u32>,
    /// Absent when the primitive carries no texture coordinate: nothing then tells a seam.
    pub seam: Option<Vec<u32>>,
}
/// The texture coordinate sets among a primitive's attributes.
fn texture_sets(attributes: &[Attribute]) -> TextureSets<'_> {
    let set = |flag| {
        attributes
            .iter()
            .find(|a| a.flag == flag)
            .map(|a| a.values.as_slice())
    };
    [
        set(crate::geometry_page::FLAG_UV),
        set(crate::geometry_page::FLAG_UV1),
    ]
}
impl Welds {
    pub fn of(vertices: &DagVertices<'_>, indices: &[u32]) -> Self {
        let uvs = texture_sets(vertices.attributes);
        Self {
            position: weld_positions(vertices.positions, indices),
            seam: uvs
                .iter()
                .any(Option::is_some)
                .then(|| weld_positions_and_uv(vertices.positions, &uvs, indices)),
        }
    }
    /// Vertices on a texture seam: their position has copies that differ by texture
    /// coordinate — one class by position holding more than one class by (position, uv).
    pub fn texture_seams(&self) -> Vec<bool> {
        let weld: &[u32] = &self.position;
        let Some(seam_weld) = self.seam.as_deref() else {
            return vec![false; weld.len()];
        };
        let mut first = vec![u32::MAX; weld.len()];
        let mut seam = vec![false; weld.len()];
        for (vertex, &class) in weld.iter().enumerate() {
            let uv_class = seam_weld[vertex];
            let slot = &mut first[class as usize];
            if *slot == u32::MAX {
                *slot = uv_class;
            } else if *slot != uv_class {
                seam[class as usize] = true;
            }
        }
        weld.iter().map(|&class| seam[class as usize]).collect()
    }
}
pub(super) const LOCK_SHARED: u32 = u32::MAX - 1;
/// Lock table for one level: a vertex is locked when another group of the same level also uses its
/// position. The primitive's own open boundary belongs to a single group, so it stays free and keeps
/// simplifying; only the seams between groups are pinned, which is what keeps the cut watertight.
pub fn level_locks(weld: &[u32], clusters: &[&[u32]], groups: &[Vec<usize>]) -> Vec<bool> {
    let mut owner = vec![u32::MAX; weld.len()];
    for (id, group) in groups.iter().enumerate() {
        let id = id as u32;
        for &slot in group {
            for &vertex in clusters[slot] {
                let canonical = weld[vertex as usize] as usize;
                if owner[canonical] == u32::MAX {
                    owner[canonical] = id;
                } else if owner[canonical] != id {
                    owner[canonical] = LOCK_SHARED;
                }
            }
        }
    }
    (0..weld.len())
        .map(|vertex| owner[weld[vertex] as usize] == LOCK_SHARED)
        .collect()
}
