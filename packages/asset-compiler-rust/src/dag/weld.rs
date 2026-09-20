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

/// Canonical vertex per position: duplicated vertices at UV or normal seams are one point, so a
/// lock placed on one copy locks every copy and no seam can crack. A coarse level that creates
/// vertices enters them under the same rule (`extend`), so the next level's locks and borders
/// read them like source vertices.
pub struct Weld(Welder<[u32; 3]>);
impl Weld {
    pub fn by_position(positions: &[f32], indices: &[u32]) -> Self {
        Self(Welder::by_indices(positions.len() / 3, indices, |id| {
            position_key(positions, id)
        }))
    }
    /// Welds the vertices appended since the last call: every vertex of `positions` beyond the
    /// table's length.
    pub fn extend(&mut self, positions: &[f32]) {
        let from = self.0.canonical.len() as u32;
        let count = (positions.len() / 3) as u32;
        self.0.canonical.reserve((count - from) as usize);
        for id in from..count {
            self.0.canonical.push(id);
            self.0.weld(id, position_key(positions, id));
        }
    }
}
impl std::ops::Deref for Weld {
    type Target = [u32];
    fn deref(&self) -> &[u32] {
        &self.0.canonical
    }
}
/// Canonical vertex per (position, uv): the copies that differ only by their normal or their
/// colour are one point, those on a texture seam stay two. It is the weld the endpoint
/// reduction falls back on, so a coarse level never draws one side of a seam with the other
/// side's texture.
pub fn weld_positions_and_uv(positions: &[f32], uvs: &[f32], indices: &[u32]) -> Vec<u32> {
    Welder::by_indices(positions.len() / 3, indices, |id| {
        let i = id as usize * 2;
        let uv = [uvs[i], uvs[i + 1]].map(normalized_bits);
        (position_key(positions, id), uv)
    })
    .canonical
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
