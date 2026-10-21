//! The numbering of keys by their first naming, sorted side by side: what one pass inserting each
//! key into a map gives, whatever the threads.
use rayon::prelude::*;
use std::sync::atomic::{AtomicU32, Ordering};

/// The distinct keys of `named` in the order they are first named, and each naming's rank among
/// them: what one pass inserting each key into a map at its first naming gives, sorted side by
/// side. Every step runs on all threads: a long list is never walked by one.
pub(super) fn first_seen<K: Ord + Copy + Send + Sync>(named: Vec<K>) -> (Vec<K>, Vec<u32>) {
    let mut sorted: Vec<(K, u32)> = (named.into_par_iter().enumerate())
        .map(|(at, key)| (key, at as u32))
        .collect();
    sorted.par_sort_unstable();
    // Where each key's run of namings starts in `sorted`; its first naming leads it.
    let starts: Vec<u32> = (0..sorted.len())
        .into_par_iter()
        .filter(|&at| at == 0 || sorted[at - 1].0 != sorted[at].0)
        .map(|at| at as u32)
        .collect();
    // The runs by their first naming: their ranks.
    let mut by_first: Vec<(u32, u32)> = (starts.par_iter().enumerate())
        .map(|(run, &start)| (sorted[start as usize].1, run as u32))
        .collect();
    by_first.par_sort_unstable();
    let keys: Vec<K> = (by_first.par_iter())
        .map(|&(_, run)| sorted[starts[run as usize] as usize].0)
        .collect();
    let rank_of_run: Vec<AtomicU32> = (0..starts.len())
        .into_par_iter()
        .map(|_| AtomicU32::new(0))
        .collect();
    (by_first.par_iter().enumerate()).for_each(|(rank, &(_, run))| {
        rank_of_run[run as usize].store(rank as u32, Ordering::Relaxed)
    });
    drop(by_first);
    // Each run's rank given to every naming in it.
    let ranks: Vec<AtomicU32> = (0..sorted.len())
        .into_par_iter()
        .map(|_| AtomicU32::new(0))
        .collect();
    (0..starts.len()).into_par_iter().for_each(|run| {
        let end = starts.get(run + 1).map_or(sorted.len(), |&s| s as usize);
        let rank = rank_of_run[run].load(Ordering::Relaxed);
        for &(_, naming) in &sorted[starts[run] as usize..end] {
            ranks[naming as usize].store(rank, Ordering::Relaxed);
        }
    });
    let ranks = ranks.into_par_iter().map(AtomicU32::into_inner).collect();
    (keys, ranks)
}
