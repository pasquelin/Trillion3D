use super::*;

pub fn cluster_triangles(
    positions: &[f32],
    indices: &[u32],
    max_triangles: usize,
) -> Result<Vec<Vec<u32>>> {
    if indices.is_empty() || !indices.len().is_multiple_of(3) {
        return Err(invalid("Index count must be a positive multiple of three"));
    }
    if max_triangles == 0 || !max_triangles.is_multiple_of(4) || max_triangles > 512 {
        return Err(invalid(
            "Cluster triangle budget must be a positive multiple of four up to 512",
        ));
    }
    if indices.len() / 3 <= max_triangles {
        return Ok(vec![indices.to_vec()]);
    }
    let (compact_pos, compact_idx, remap) = compact_region(positions, indices);
    let bytes = unsafe {
        std::slice::from_raw_parts(compact_pos.as_ptr() as *const u8, compact_pos.len() * 4)
    };
    let vertices =
        meshopt::VertexDataAdapter::new(bytes, 12, 0).map_err(|_| invalid("POSITION adapter"))?;
    let meshlets = meshopt::build_meshlets(
        &compact_idx,
        &vertices,
        DAG_CLUSTER_VERTICES,
        max_triangles,
        0.0,
    );
    if meshlets.is_empty() {
        return Err(invalid("Meshlet builder produced no cluster"));
    }
    let mut clusters = Vec::with_capacity(meshlets.len());
    for i in 0..meshlets.len() {
        let meshlet = meshlets.get(i);
        let mut cluster = Vec::with_capacity(meshlet.triangles.len());
        for corner in meshlet.triangles {
            let local = *meshlet
                .vertices
                .get(*corner as usize)
                .ok_or_else(|| invalid("Meshlet vertex out of range"))?;
            cluster.push(
                *remap
                    .get(local as usize)
                    .ok_or_else(|| invalid("Meshlet remap out of range"))?,
            );
        }
        if cluster.is_empty() {
            continue;
        }
        clusters.push(cluster);
    }
    if clusters.is_empty() {
        return Err(invalid("Meshlet builder produced no triangle"));
    }
    Ok(clusters)
}

// ---------------------------------------------------------------- cluster graph

/// Key of undirected edge. `topology.rs::edge_key` answers same question under another
/// encoding — ordered pair rather than 64-bit word — serving another table type:
/// both remain, aligning one to other would change iteration order.
pub(super) fn edge_key(a: u32, b: u32) -> u64 {
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    ((lo as u64) << 32) | hi as u64
}

/// Shared-edge weights between clusters. Only cluster-boundary edges can be shared, so collecting
/// those keeps the pass proportional to the boundary rather than to the triangle count.
pub fn cluster_adjacency(clusters: &[&[u32]]) -> Vec<Vec<(u32, u32)>> {
    let mut records: Vec<(u64, u32)> = Vec::new();
    let mut local: HashMap<u64, u32> = HashMap::new();
    for (id, indices) in clusters.iter().enumerate() {
        local.clear();
        for tri in indices.as_chunks::<3>().0 {
            for k in 0..3 {
                *local.entry(edge_key(tri[k], tri[(k + 1) % 3])).or_insert(0) += 1;
            }
        }
        for (&key, &count) in local.iter() {
            if count == 1 {
                records.push((key, id as u32));
            }
        }
    }
    records.sort_unstable();
    let mut weights: Vec<HashMap<u32, u32>> = vec![HashMap::new(); clusters.len()];
    let mut start = 0usize;
    while start < records.len() {
        let mut end = start + 1;
        while end < records.len() && records[end].0 == records[start].0 {
            end += 1;
        }
        for i in start..end {
            for j in i + 1..end {
                let (a, b) = (records[i].1, records[j].1);
                if a == b {
                    continue;
                }
                *weights[a as usize].entry(b).or_insert(0) += 1;
                *weights[b as usize].entry(a).or_insert(0) += 1;
            }
        }
        start = end;
    }
    weights
        .into_iter()
        .map(|map| {
            let mut list: Vec<(u32, u32)> = map.into_iter().collect();
            list.sort_unstable();
            list
        })
        .collect()
}

/// Recursive bisection of the cluster graph into partitions of at most `max` members.
/// Splits on the longest axis of the cluster centres, then trades members across the cut while the
/// shared-edge weight drops, which is the cheap stand-in for a METIS-style graph partitioner.
pub(super) fn normalized_bits(value: f32) -> u32 {
    if value == 0.0 {
        0
    } else {
        value.to_bits()
    }
}
pub(super) fn position_key(positions: &[f32], id: u32) -> [u32; 3] {
    let i = id as usize * 3;
    [
        normalized_bits(positions[i]),
        normalized_bits(positions[i + 1]),
        normalized_bits(positions[i + 2]),
    ]
}
/// Canonical vertex per position: duplicated vertices at UV or normal seams are one point, so a
/// lock placed on one copy locks every copy and no seam can crack.
pub fn weld_positions(positions: &[f32], indices: &[u32]) -> Vec<u32> {
    weld_by(positions.len() / 3, indices, |id| {
        position_key(positions, id)
    })
}
/// Canonical vertex per (position, every texture coordinate): copies that differ only by their
/// normal or their colour are one point, those on a texture seam of any set stay two. It names
/// the seams a reduction protects and the normal copies a coarse corner picks from. The key
/// allocates nothing: three position words, then two per set of the two a page can carry.
pub fn weld_positions_and_uv(positions: &[f32], uv_sets: &[&[f32]], indices: &[u32]) -> Vec<u32> {
    weld_by(positions.len() / 3, indices, |id| {
        let mut key = [0u32; 7];
        key[..3].copy_from_slice(&position_key(positions, id));
        for (set, uvs) in uv_sets.iter().enumerate() {
            let i = id as usize * 2;
            key[3 + 2 * set] = normalized_bits(uvs[i]);
            key[4 + 2 * set] = normalized_bits(uvs[i + 1]);
        }
        key
    })
}
pub(super) fn weld_by<K: std::hash::Hash + Eq>(
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
