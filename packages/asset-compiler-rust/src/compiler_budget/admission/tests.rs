use super::*;
use std::sync::atomic::AtomicUsize;

// Behaviour: the jobs in flight never commit more than the room, a job wider than the room
// runs alone, and the results keep the jobs' order.
#[test]
fn running_jobs_never_exceed_the_room() {
    let working = [4, 4, 4, 3, 3, 3, 11, 1];
    let (held, peak) = (AtomicUsize::new(0), AtomicUsize::new(0));
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(8)
        .build()
        .unwrap();
    let out = pool.install(|| {
        let inputs = alone(working.len());
        run_admitted(
            &inputs,
            Room::Fixed(10),
            |i, _| working[i],
            |i, _| {
                let now = held.fetch_add(working[i], Ordering::SeqCst) + working[i];
                peak.fetch_max(now, Ordering::SeqCst);
                std::thread::sleep(std::time::Duration::from_millis(5));
                held.fetch_sub(working[i], Ordering::SeqCst);
                Ok::<_, ()>(i)
            },
        )
    });
    let (results, admitted) = out.unwrap();
    assert_eq!(results, (0..working.len()).collect::<Vec<_>>());
    assert!(peak.load(Ordering::SeqCst) <= 11, "{peak:?}");
    assert!(admitted.most <= 11, "{admitted:?}");
}

// Behaviour: a job starts once the jobs it reads are done, is estimated from their results,
// and reads them.
#[test]
fn a_job_reads_the_results_it_runs_after() {
    let inputs = vec![vec![1, 2], Vec::new(), Vec::new()];
    let estimated = |i: usize, done: &Done<usize>| match i {
        0 => done.get(1) + done.get(2),
        _ => 1,
    };
    let (results, admitted) = run_admitted(&inputs, Room::Fixed(100), estimated, |i, done| {
        Ok::<_, ()>(match i {
            0 => done.get(1) + done.get(2),
            _ => i * 10,
        })
    })
    .unwrap();
    assert_eq!(results, [30, 10, 20]);
    assert_eq!(admitted.most, 30);
}

// Behaviour: a failure is the result, the first in the jobs' order.
#[test]
fn the_first_failure_in_order_is_the_result() {
    let out = run_admitted(
        &alone(3),
        Room::Fixed(1),
        |_, _| 1,
        |i, _| {
            if i == 0 {
                Ok(())
            } else {
                Err(i)
            }
        },
    );
    assert_eq!(out.unwrap_err(), 1);
}
