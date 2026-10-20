//! The numbering of keys by their first naming, sorted side by side: what one pass inserting each
//! key into a map gives, whatever the threads.
use rayon::prelude::*;

/// The distinct keys of `named` in the order they are first named, and each naming's rank among
/// them: what one pass inserting each key into a map at its first naming gives, sorted side by
/// side.
pub(super) fn first_seen<K: Ord + Copy + Send + Sync>(named: Vec<K>) -> (Vec<K>, Vec<u32>) {
    let mut sorted: Vec<(K, u32)> = (named.into_par_iter().enumerate())
        .map(|(at, key)| (key, at as u32))
        .collect();
    sorted.par_sort_unstable();
    // Each key's first naming and where its run of namings starts in `sorted`.
    let mut firsts: Vec<(u32, u32)> = Vec::new();
    for (at, &(key, first)) in sorted.iter().enumerate() {
        if at == 0 || sorted[at - 1].0 != key {
            firsts.push((first, at as u32));
        }
    }
    firsts.par_sort_unstable();
    let keys: Vec<K> = (firsts.par_iter())
        .map(|&(_, start)| sorted[start as usize].0)
        .collect();
    // Each run's rank, by where it starts, then given to every naming in it.
    let mut rank_of_run = vec![0u32; sorted.len()];
    for (rank, &(_, start)) in firsts.iter().enumerate() {
        rank_of_run[start as usize] = rank as u32;
    }
    drop(firsts);
    let mut ranks = vec![0u32; sorted.len()];
    let mut rank = 0;
    for (at, &(key, naming)) in sorted.iter().enumerate() {
        if at == 0 || sorted[at - 1].0 != key {
            rank = rank_of_run[at];
        }
        ranks[naming as usize] = rank;
    }
    (keys, ranks)
}
