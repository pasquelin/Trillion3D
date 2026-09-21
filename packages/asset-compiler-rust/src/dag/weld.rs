//! Vertices welded by what they share: the canonical vertex of every position, the lock table a
//! level derives from it, and the (position, uv) weld the endpoint reduction falls back on.
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
pub(crate) struct Welder<K> {
    pub canonical: Vec<u32>,
    seen: HashMap<K, u32>,
}
impl<K: std::hash::Hash + Eq> Welder<K> {
    pub(crate) fn by_indices(count: usize, indices: &[u32], key: impl Fn(u32) -> K) -> Self {
        let mut welder = Self {
            canonical: (0..count as u32).collect(),
            seen: HashMap::with_capacity(indices.len() / 2),
        };
        let mut visited = vec![false; count];
        for &id in indices {
            let slot = id as usize;
            if slot >= count || visited[slot] {
                continue;
            }
            visited[slot] = true;
            welder.weld(id, key(id));
        }
        welder
    }
    fn weld(&mut self, id: u32, key: K) {
        self.canonical[id as usize] = *self.seen.entry(key).or_insert(id);
    }
}

/// A weld that follows the buffer: a coarse level that creates vertices enters them under the
/// same key (`extend`), so the next level's locks, borders and fallbacks read them like source
/// vertices.
pub struct Weld<K>(Welder<K>);
impl<K: std::hash::Hash + Eq> Weld<K> {
    /// Welds the vertices appended since the last call: every vertex from the table's length
    /// to `count`.
    pub fn extend(&mut self, count: usize, key: impl Fn(u32) -> K) {
        let from = self.0.canonical.len() as u32;
        self.0.canonical.reserve(count - from as usize);
        for id in from..count as u32 {
            self.0.canonical.push(id);
            self.0.weld(id, key(id));
        }
    }
}
impl<K> std::ops::Deref for Weld<K> {
    type Target = [u32];
    fn deref(&self) -> &[u32] {
        &self.0.canonical
    }
}
/// Canonical vertex per position: duplicated vertices at UV or normal seams are one point, so a
/// lock placed on one copy locks every copy and no seam can crack.
pub type PositionWeld = Weld<[u32; 3]>;
impl PositionWeld {
    pub fn by_position(positions: &[f32], indices: &[u32]) -> Self {
        Self(Welder::by_indices(positions.len() / 3, indices, |id| {
            position_key(positions, id)
        }))
    }
    pub fn extend_by_position(&mut self, positions: &[f32]) {
        self.extend(positions.len() / 3, |id| position_key(positions, id));
    }
}
/// Canonical vertex per (position, texture coordinates): the copies that differ only by their
/// normal or their colour are one point, those on a texture seam — of either set — stay two. It
/// is the weld a stalled reduction falls back on, so a coarse level never draws one side of a
/// seam with the other side's texture.
pub type SeamWeld = Weld<([u32; 3], [u32; 4])>;
impl SeamWeld {
    pub fn by_position_and_uv(positions: &[f32], uvs: &TextureSets<'_>, indices: &[u32]) -> Self {
        Self(Welder::by_indices(positions.len() / 3, indices, |id| {
            seam_key(positions, uvs, id)
        }))
    }
    pub fn extend_by_position_and_uv(&mut self, positions: &[f32], uvs: &TextureSets<'_>) {
        self.extend(positions.len() / 3, |id| seam_key(positions, uvs, id));
    }
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
/// The two welds of a build, following the buffer together.
pub struct Welds {
    pub position: PositionWeld,
    /// Absent when the primitive carries no texture coordinate: nothing then tells a seam.
    pub seam: Option<SeamWeld>,
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
            position: PositionWeld::by_position(vertices.positions, indices),
            seam: uvs
                .iter()
                .any(Option::is_some)
                .then(|| SeamWeld::by_position_and_uv(vertices.positions, &uvs, indices)),
        }
    }
    pub fn extend(&mut self, vertices: &DagVertices<'_>) {
        self.position.extend_by_position(vertices.positions);
        if let Some(seam) = self.seam.as_mut() {
            let uvs = texture_sets(vertices.attributes);
            seam.extend_by_position_and_uv(vertices.positions, &uvs);
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
