//! Admitting the ready jobs, launching them, running a job.
use super::state::{keyed, Admission, Ready, State, Window};
use super::{Done, Room, Running, LEAST_SCALE};
use crate::support::perf::{Phase, Timer};
use std::cmp::Reverse;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::Ordering;

/// The ready jobs behind a first one that does not fit that one admission looks at, and the most
/// it lets past that first one while it waits: it is delayed by a few jobs at most, never starved.
pub(super) const FILL: usize = 8;

/// Admits the ready jobs of `admission` while they fit and fewer run than the pool has workers,
/// the first by key first (`Ready`); a ready job that can no longer decide the outcome
/// (`Admission::decides`) is dropped; `now` is the resident bytes measured last. A first job that
/// does not fit lets the next that fit pass (`fill`) when the jobs are ranked; unranked, the widest
/// waits first and none passes it. A job made to wait counts once, however often. The jobs
/// admitted, for the caller to launch once it lets go of the state (`launch`).
pub(super) fn admit<T, E, B, W>(
    admission: &Admission<T, E, B, W>,
    state: &mut State,
    now: u64,
) -> Vec<usize> {
    let mut admitted = Vec::new();
    while state.running < admission.width {
        let Some(&(_, Reverse(at), bytes)) = state.ready.peek() else {
            break;
        };
        if !admission.decides(state, at) {
            state.ready.pop();
            continue;
        }
        if !admission.fits(state, bytes, now) {
            if state.last_waiting != Some(at) {
                state.last_waiting = Some(at);
                state.passed = 0;
            }
            if !std::mem::replace(&mut state.counted[at], true) {
                state.waited += 1;
            }
            if !admission.rank.is_empty() {
                fill(admission, state, now, &mut admitted);
            }
            break;
        }
        state.ready.pop();
        state.admit(at, bytes);
        admitted.push(at);
    }
    admitted
}

/// Admits into `admitted`, of the `FILL` ready jobs behind the first — which does not fit —, those
/// that fit, in key order, while fewer than `FILL` passed it since it began to wait and fewer run
/// than the pool has workers; the first stays first.
fn fill<T, E, B, W>(
    admission: &Admission<T, E, B, W>,
    state: &mut State,
    now: u64,
    admitted: &mut Vec<usize>,
) {
    let Some(first) = state.ready.pop() else {
        return;
    };
    let mut kept: Vec<Ready> = Vec::new();
    for _ in 0..FILL {
        if state.passed >= FILL || state.running >= admission.width {
            break;
        }
        let Some(job @ (_, Reverse(at), bytes)) = state.ready.pop() else {
            break;
        };
        if !admission.decides(state, at) {
            continue;
        }
        if admission.fits(state, bytes, now) {
            state.admit(at, bytes);
            state.passed += 1;
            admitted.push(at);
        } else {
            kept.push(job);
        }
    }
    state.ready.push(first);
    state.ready.extend(kept);
}

/// The scale the measures give the estimates, at a job's end, `now` the resident bytes: what the
/// process grew by since the last job ended over the most estimated bytes of the jobs started
/// meanwhile it ran at once, halving at most per job, so one job's quiet end never opens the room
/// to every other at once; then a new window, from what the process holds now and no job started.
/// A job carried into a window counts in neither side of its measure: what it already holds is in
/// the window's start, its estimate is not in the bytes run — what it grows by still counts, so
/// the scale errs high, never collapsing under a long job that already holds its bytes. The
/// results a job keeps count in the one window it ends in, never in every later one.
fn rescale<T, E, B, W>(admission: &Admission<T, E, B, W>, state: &mut State, now: u64) {
    let peak = (admission.window_peak.swap(now, Ordering::Relaxed)).max(now);
    if state.window.most > 0 {
        let grown = peak.saturating_sub(state.window.base) as f64;
        state.scale = (grown / state.window.most as f64)
            .max(state.scale / 2.0)
            .max(LEAST_SCALE);
    }
    let id = state.window.id + 1;
    state.window = Window {
        id,
        ..Window::new(now)
    };
}

/// Spawns each of the `jobs` admitted on `scope`, a task of the pool it stands in: a worker runs
/// it once it takes it — the one that spawned it, job admitted last first, unless another steals
/// it (`run`).
pub(super) fn launch<'scope, T, E, B, W>(
    scope: &rayon::Scope<'scope>,
    admission: &'scope Admission<T, E, B, W>,
    jobs: Vec<usize>,
) where
    T: Send + Sync,
    E: Send + Sync,
    B: Fn(usize, &Done<T>) -> usize + Sync,
    W: Fn(usize, &Done<T>) -> Result<T, E> + Sync,
{
    for at in jobs {
        scope.spawn(move |scope| run(scope, admission, at));
    }
}

/// Runs job `at` of `admission` and the estimates of the readers it readies, then launches what
/// its end admits on `scope`: once its work is done it lets go of its bytes in the same step that
/// counts it done for its readers, so a reader it readies is never admitted beside the bytes of a
/// job already done; once its readers are estimated it rescales the estimates on what was measured
/// — once the allocator gave back what the job freed — and admits what now fits. A job that panics
/// stops the admission, the panic raised once every job launched is over.
fn run<'scope, T, E, B, W>(
    scope: &rayon::Scope<'scope>,
    admission: &'scope Admission<T, E, B, W>,
    at: usize,
) where
    T: Send + Sync,
    E: Send + Sync,
    B: Fn(usize, &Done<T>) -> usize + Sync,
    W: Fn(usize, &Done<T>) -> Result<T, E> + Sync,
{
    admission.lock().start(at);
    let done = Done {
        slots: &admission.results,
    };
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let outcome = {
            // Its steps count as its own (`Step`), whatever other job this worker stands on.
            let _running = Running::enter(&admission.state, at);
            // What the job's own timers leave out counts as the job's.
            let _job = Timer::new(Phase::Job);
            (admission.work)(at, &done)
        };
        let failed = outcome.is_err();
        match outcome {
            Ok(result) => drop(admission.results[at].set(result)),
            Err(error) => drop(admission.errors[at].set(error)),
        }
        let readied: Vec<usize> = {
            let mut state = admission.lock();
            state.release(at);
            // A failed job readies no reader.
            if failed {
                state.first_failed = state.first_failed.min(at);
                Vec::new()
            } else {
                (admission.readers[at].iter().copied())
                    .filter(|&reader| {
                        state.inputs[reader] -= 1;
                        state.inputs[reader] == 0
                    })
                    .collect()
            }
        };
        // Estimated from what they read, out of the lock.
        (readied.into_iter())
            .map(|reader| keyed(&admission.rank, reader, (admission.bytes)(reader, &done)))
            .collect::<Vec<_>>()
    }));
    // Measured once, out of the lock: the window and the room read the same bytes.
    let measured = matches!(admission.room, Room::Measured(_));
    let now = if measured {
        crate::support::perf::rss::purge();
        crate::support::perf::rss::current_bytes().unwrap_or(0)
    } else {
        0
    };
    let admitted = {
        let mut state = admission.lock();
        // A job that panicked before its end lets go of its bytes here.
        state.release(at);
        match outcome {
            Ok(sized) => state.ready.extend(sized),
            Err(panic) => {
                // Nothing more is admitted.
                state.first_failed = 0;
                state.panic = state.panic.take().or(Some(panic));
            }
        }
        if measured {
            rescale(admission, &mut state, now);
        }
        admit(admission, &mut state, now)
    };
    launch(scope, admission, admitted);
}
