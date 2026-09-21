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
