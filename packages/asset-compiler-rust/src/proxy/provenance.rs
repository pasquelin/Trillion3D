//! Source ownership survives world-grid deduplication and BVH permutation.
use super::{PROXY_TRIANGLE_FLOATS, simplify};
use std::collections::{BTreeSet, HashMap};

/// Interned owner lists: subdivision and repeated geometry share lists, not copies.
#[derive(Default)]
pub struct Provenance {
    pub triangle_groups: Vec<u32>,
    pub group_offsets: Vec<u32>,
    /// Pairs: source node rank, linear RGBA8 albedo. First source wins a coincident tie.
    pub owners: Vec<u32>,
    /// Original world matrices, indexed by source node rank, column major.
    pub bind_worlds: Vec<f64>,
    pub source_parents: Vec<i32>,
}

/// Collect all owners before simplification throws coincident surfaces away.
pub(super) fn collect(
    triangles: &[f32],
    colours: &[u32],
    nodes: &[u32],
    size: f64,
) -> (Vec<u32>, Provenance) {
    let mut by_key = HashMap::new();
    let mut lists: Vec<Vec<(u32, u32)>> = Vec::new();
    let mut seen: Vec<BTreeSet<u32>> = Vec::new();
    let mut sources = Vec::with_capacity(nodes.len());
    for (index, triangle) in triangles
        .as_chunks::<PROXY_TRIANGLE_FLOATS>()
        .0
        .iter()
        .enumerate()
    {
        let Some(key) = simplify::key_of(triangle, size) else {
            sources.push(u32::MAX);
            continue;
        };
        let group = *by_key.entry(key).or_insert_with(|| {
            lists.push(Vec::new());
            seen.push(BTreeSet::new());
            lists.len() - 1
        });
        if seen[group].insert(nodes[index]) {
            lists[group].push((nodes[index], colours[index]));
        }
        sources.push(group as u32);
    }
    let mut interned = HashMap::new();
    let mut offsets = vec![0];
    let mut owners = Vec::new();
    let mut groups = Vec::with_capacity(lists.len());
    for list in lists {
        let next = (offsets.len() - 1) as u32;
        let group = *interned.entry(list.clone()).or_insert_with(|| {
            for (node, colour) in &list {
                owners.extend([*node, *colour]);
            }
            offsets.push((owners.len() / 2) as u32);
            next
        });
        groups.push(group);
    }
    for source in &mut sources {
        if *source != u32::MAX {
            *source = groups[*source as usize];
        }
    }
    (
        sources,
        Provenance {
            group_offsets: offsets,
            owners,
            ..Provenance::default()
        },
    )
}

#[cfg(test)]
#[path = "provenance_tests.rs"]
mod tests;
