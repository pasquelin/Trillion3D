//! Waves of jobs that fit together in one job's RAM room.
//!
//! A pool runs as many jobs as it has workers, whatever each one holds: the widest jobs of a
//! scene could then commit several times the job's budget at once. Jobs are instead cut, in
//! their order, into consecutive waves of at most `workers` jobs whose working sets fit the room
//! together; a wave starts once the previous one has returned its memory. Nothing blocks inside
//! the pool, so a worker waiting for room can never hold the work it waits for.
use rayon::prelude::*;
use std::ops::Range;

/// Consecutive ranges covering `working`, each at most `workers` long and summing within
/// `room`. `None` when one job alone exceeds `room`: no serialisation will make it fit.
pub fn waves(working: &[usize], room: usize, workers: usize) -> Option<Vec<Range<usize>>> {
    let mut ranges = Vec::new();
    let (mut start, mut used) = (0, 0usize);
    for (index, &bytes) in working.iter().enumerate() {
        if bytes > room {
            return None;
        }
        if index > start && (index - start >= workers.max(1) || bytes > room - used) {
            ranges.push(start..index);
            (start, used) = (index, 0);
        }
        used += bytes;
    }
    if start < working.len() {
        ranges.push(start..working.len());
    }
    Some(ranges)
}

/// Runs `work` over every index of `ranges`, one wave after the other on the current pool,
/// and returns the results in index order. The first error stops the waves not yet started.
pub fn run_waves<T: Send, E: Send>(
    ranges: &[Range<usize>],
    work: impl Fn(usize) -> Result<T, E> + Sync,
) -> Result<Vec<T>, E> {
    let mut results = Vec::with_capacity(ranges.last().map_or(0, |r| r.end));
    for range in ranges {
        let wave = range
            .clone()
            .into_par_iter()
            .map(&work)
            .collect::<Result<Vec<_>, E>>()?;
        results.extend(wave);
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // Behaviour: a wave closes on its worker count or on the room, whichever comes first.
    #[test]
    fn waves_hold_the_workers_and_the_room() {
        assert_eq!(waves(&[1, 1, 1, 1], 10, 2), Some(vec![0..2, 2..4]));
        assert_eq!(waves(&[6, 5, 4, 1], 10, 4), Some(vec![0..1, 1..4]));
        assert_eq!(waves(&[], 10, 4), Some(vec![]));
    }

    // Behaviour: a job wider than the whole room is refused, not run alone over the budget.
    #[test]
    fn a_job_wider_than_the_room_is_refused() {
        assert_eq!(waves(&[3, 11, 2], 10, 4), None);
    }

    // Behaviour: the jobs in flight never commit more than the room, and results keep their order.
    #[test]
    fn running_waves_never_exceeds_the_room() {
        let working = [4, 4, 4, 3, 3, 3, 9, 1];
        let ranges = waves(&working, 10, 8).expect("fits");
        let (held, peak) = (AtomicUsize::new(0), AtomicUsize::new(0));
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(8)
            .build()
            .unwrap();
        let out = pool.install(|| {
            run_waves(&ranges, |i| {
                let now = held.fetch_add(working[i], Ordering::SeqCst) + working[i];
                peak.fetch_max(now, Ordering::SeqCst);
                std::thread::sleep(std::time::Duration::from_millis(5));
                held.fetch_sub(working[i], Ordering::SeqCst);
                Ok::<_, ()>(i)
            })
        });
        assert_eq!(out, Ok((0..working.len()).collect::<Vec<_>>()));
        assert!(peak.load(Ordering::SeqCst) <= 10, "{peak:?}");
    }
}
