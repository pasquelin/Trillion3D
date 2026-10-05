use super::*;
use crate::join::Join;

/// Surfaces grouped by the plane they really share.
///
/// Hashing alone would split one plane in two whenever a rounding bit pushes a surface across a
/// quantisation edge — exactly the case this stage exists for, where two surfaces agree to the last
/// float. So neighbouring buckets are merged, and only when the planes themselves pass the explicit
/// parallel-and-coincident test.
pub fn plane_groups(surfaces: &[Surface], offset_quantum: f64) -> Vec<Vec<usize>> {
    let mut buckets: BTreeMap<[i64; 4], Vec<usize>> = BTreeMap::new();
    for (index, surface) in surfaces.iter().enumerate() {
        buckets.entry(surface.key).or_default().push(index);
    }
    let keys: Vec<[i64; 4]> = buckets.keys().copied().collect();
    let slot: BTreeMap<[i64; 4], usize> = keys
        .iter()
        .enumerate()
        .map(|(index, key)| (*key, index))
        .collect();
    let mut join = Join::new(keys.len());
    for (index, key) in keys.iter().enumerate() {
        let mine = &surfaces[buckets[key][0]];
        for step in 0..81usize {
            let mut neighbour = *key;
            let mut digits = step;
            for value in &mut neighbour {
                *value += digits as i64 % 3 - 1;
                digits /= 3;
            }
            let Some(other) = slot.get(&neighbour).copied() else {
                continue;
            };
            if other == index {
                continue;
            }
            let theirs = &surfaces[buckets[&neighbour][0]];
            if !plane::same_plane(
                (mine.normal, mine.offset),
                (theirs.normal, theirs.offset),
                offset_quantum,
            ) {
                continue;
            }
            join.unite(index as u32, other as u32);
        }
    }
    let mut merged: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
    for (index, key) in keys.iter().enumerate() {
        merged
            .entry(join.root(index as u32))
            .or_default()
            .extend(buckets[key].iter().copied());
    }
    let mut groups: Vec<Vec<usize>> = merged.into_values().collect();
    for group in &mut groups {
        group.sort_unstable();
    }
    groups
}
