//! Admitting the ready jobs, serving the threads, running a job.
use super::state::{Admission, State};
use super::{Done, InJob, Room, LEAST_SCALE};
use std::cmp::Reverse;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::Ordering;

/// Admits the ready jobs of `admission` while they fit, the widest first, each handed to the
/// threads that take the jobs admitted; a ready job that can no longer decide the outcome
/// (`Admission::decides`) is dropped.
pub(super) fn admit<T, E, B, W>(admission: &Admission<T, E, B, W>, state: &mut State) {
    while let Some(&(bytes, Reverse(at))) = state.ready.peek() {
        if !admission.decides(state, at) {
            state.ready.pop();
            continue;
        }
        if !admission.fits(state, bytes) {
            if state.last_waiting != Some(at) {
                state.last_waiting = Some(at);
                state.waited += 1;
            }
            break;
        }
        state.ready.pop();
        state.running += 1;
        state.pending += 1;
        state.used = state.used.saturating_add(bytes);
        state.fresh = state.fresh.saturating_add(bytes);
        state.most = state.most.max(state.used);
        state.admitted.push((at, bytes));
        admission.changed.notify_one();
    }
}

/// One of the threads of `admission`: takes the job admitted last and runs it, until none is left —
/// the order one worker of a pool takes the jobs spawned on it in.
pub(super) fn serve<T, E, B, W>(
    admission: &Admission<T, E, B, W>,
    inner: Option<&rayon::ThreadPool>,
) where
    T: Send + Sync,
    E: Send + Sync,
    B: Fn(usize, &Done<T>) -> usize + Sync,
    W: Fn(usize, &Done<T>) -> Result<T, E> + Sync,
{
    let mut state = admission.lock();
    loop {
        if let Some((at, bytes)) = state.admitted.pop() {
            state.fresh = state.fresh.saturating_sub(bytes);
            drop(state);
            run(admission, inner, (at, bytes));
            state = admission.lock();
        } else if state.pending == 0 {
            break;
        } else {
            state = admission
                .changed
                .wait(state)
                .unwrap_or_else(|e| e.into_inner());
        }
    }
}

/// Runs job `at` of `admission`, its work and the estimates of the readers it readies on `inner`
/// — on the calling thread without one —: once its work is done it lets go of its `bytes` in the
/// same step that counts it done for its readers, so a reader it readies is never admitted beside
/// the bytes of a job already done; once its readers are estimated it rescales the estimates on
/// what was measured and admits what now fits. A job that panics stops the admission, the panic
/// raised once every job taken is over.
fn run<T, E, B, W>(
    admission: &Admission<T, E, B, W>,
    inner: Option<&rayon::ThreadPool>,
    (at, bytes): (usize, usize),
) where
    T: Send + Sync,
    E: Send + Sync,
    B: Fn(usize, &Done<T>) -> usize + Sync,
    W: Fn(usize, &Done<T>) -> Result<T, E> + Sync,
{
    let done = Done {
        slots: &admission.results,
    };
    let mut released = false;
    let mut job = || {
        let outcome = {
            let _in_job = InJob::enter();
            (admission.work)(at, &done)
        };
        let failed = outcome.is_err();
        match outcome {
            Ok(result) => drop(admission.results[at].set(result)),
            Err(error) => drop(admission.errors[at].set(error)),
        }
        let readied: Vec<usize> = {
            let mut state = admission.lock();
            state.running -= 1;
            state.used = state.used.saturating_sub(bytes);
            released = true;
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
            .map(|reader| ((admission.bytes)(reader, &done), Reverse(reader)))
            .collect::<Vec<_>>()
    };
    let outcome = catch_unwind(AssertUnwindSafe(|| match inner {
        Some(inner) => inner.install(job),
        None => job(),
    }));
    let mut state = admission.lock();
    if !released {
        state.running -= 1;
        state.used = state.used.saturating_sub(bytes);
    }
    state.pending -= 1;
    match outcome {
        Ok(sized) => state.ready.extend(sized),
        Err(panic) => {
            // Nothing more is admitted.
            state.first_failed = 0;
            state.panic = state.panic.take().or(Some(panic));
        }
    }
    // What the process grew by over the most estimated at once, halving at most per job: one
    // job's quiet end never opens the room to every other at once.
    if matches!(admission.room, Room::Measured(_)) && state.most > 0 {
        let peak = admission.peak.load(Ordering::Relaxed);
        let grown = peak.saturating_sub(admission.base) as f64;
        state.scale = (grown / state.most as f64)
            .max(state.scale / 2.0)
            .max(LEAST_SCALE);
    }
    admit(admission, &mut state);
    if state.pending == 0 {
        // Nothing left to take: every thread waiting stops.
        admission.changed.notify_all();
    }
}
