//! One admission for the jobs of a compile that share its RAM room: the primitives, the textures,
//! the HLOD actors.
//!
//! A pool runs as many jobs as it has workers, whatever each one holds: the widest jobs of a scene
//! could then commit several times the room at once. Each job instead names the jobs whose results
//! it reads, and is estimated — once those are done, from what they made — to hold some bytes; it
//! is admitted once its bytes fit beside the jobs running — the widest ready job first, a job
//! alone past the room never refused —, and each job that ends admits what now fits: no barrier,
//! and nothing blocks inside a pool, so a worker can never hold the work it waits for. The results
//! come back in the jobs' order, whatever order they ran in; a failure is the first in that order
//! of the jobs that fail once their inputs are made, whatever order they ran in.
//!
//! The jobs run on threads of their own, as many as the calling pool has workers, the job admitted
//! last taken first, and each hands its work to a second pool as wide: a job thread waits for its
//! work without taking up another job, so the bookkeeping that admits the next jobs never waits
//! behind a whole other job. Inside the second pool a worker waiting in a join may still run a
//! piece of another job's work, as any pool's worker does. A job nested in a job of another
//! admission runs its jobs on its own thread, one at a time, their work on the pool it stands in.
//!
//! The room is a fixed sum of estimates (`Room::Fixed`), or the bytes the process may hold
//! resident (`Room::Measured`): what it holds now plus the estimates admitted that have not
//! started, or what it held when the jobs began plus the estimates running, whichever is more,
//! plus the next job's estimate — every estimate scaled by what the process measured of the jobs
//! already done, the growth of its resident bytes over the most estimated bytes it ran at once,
//! never below `LEAST_SCALE`.
//! The shared state and the admission live in `state`, admitting, serving and running a job in `run`,
//! the tests in `tests`.
use rayon::prelude::*;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::panic::resume_unwind;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
mod state;
use state::{first_readers, Admission, State};
mod run;
use run::{admit, serve};

/// What bounds the jobs running at once.
#[derive(Clone, Copy, Debug)]
pub enum Room {
    /// The bytes their estimates may sum to.
    Fixed(usize),
    /// The bytes the process may hold resident (`crate::perf::rss::current_bytes`); a fixed sum of
    /// the estimates where the platform does not report them.
    Measured(usize),
}

/// `count` jobs that read no other's result.
pub fn alone(count: usize) -> Vec<Vec<usize>> {
    vec![Vec::new(); count]
}

/// What an admission ran under: the jobs the room made wait, the most estimated bytes running at
/// once, and, measured, the growth of the resident bytes over them.
#[derive(Clone, Copy, Debug, Default)]
pub struct Admitted {
    pub waited: usize,
    pub most: usize,
    pub measured: Option<f64>,
}

/// The results of the jobs done, which a job reads its inputs from.
pub struct Done<'a, T> {
    slots: &'a [OnceLock<T>],
}

impl<T> Done<'_, T> {
    /// Job `at`'s result: one of the jobs the running job runs after.
    pub fn get(&self, at: usize) -> &T {
        self.slots[at].get().expect("a job runs after its inputs")
    }
}

/// Sets its flag when dropped: the jobs are over, normally or by a panic.
struct Finished<'a>(&'a AtomicBool);

impl Drop for Finished<'_> {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// How often the resident bytes are sampled while measured jobs run, in milliseconds: a step's
/// peak lasts far longer.
const SAMPLE_MS: u64 = 10;

/// The least scale the measures give the estimates: a quiet start never lets the estimates count
/// for less than a quarter of their bytes.
const LEAST_SCALE: f64 = 0.25;

std::thread_local! {
    /// Whether this thread runs the work of an admission's job: an admission it starts runs nested.
    static IN_JOB: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Marks the current thread as running a job's work while it lives, and gives back what it found
/// when it drops, a panic included.
struct InJob(bool);

impl InJob {
    fn enter() -> Self {
        Self(IN_JOB.with(|flag| flag.replace(true)))
    }
}

impl Drop for InJob {
    fn drop(&mut self) {
        IN_JOB.with(|flag| flag.set(self.0));
    }
}

/// Runs `work` over every job, at most as many at once as the current pool has workers — job `k`
/// reading the results of the jobs `inputs[k]` through `Done` —, each once those are done and its
/// `bytes`, estimated from them, fit `room` beside the jobs running, the widest ready one first.
/// The results in the jobs' order and what the admission ran under; else the error of the first
/// job in that order that fails once its inputs are made: after a failure only the jobs that come
/// before it, or that such a job reads, are still admitted.
pub fn run_admitted<T: Send + Sync, E: Send + Sync>(
    inputs: &[Vec<usize>],
    room: Room,
    bytes: impl Fn(usize, &Done<T>) -> usize + Sync,
    work: impl Fn(usize, &Done<T>) -> Result<T, E> + Sync,
) -> Result<(Vec<T>, Admitted), E> {
    let count = inputs.len();
    if count == 0 {
        return Ok((Vec::new(), Admitted::default()));
    }
    let mut readers = vec![Vec::new(); count];
    for (at, inputs) in inputs.iter().enumerate() {
        for &input in inputs {
            readers[input].push(at);
        }
    }
    let results: Vec<OnceLock<T>> = (0..count).map(|_| OnceLock::new()).collect();
    // The jobs reading nothing, estimated side by side.
    let ready: BinaryHeap<(usize, Reverse<usize>)> = (0..count)
        .into_par_iter()
        .filter(|&at| inputs[at].is_empty())
        .map(|at| (bytes(at, &Done { slots: &results }), Reverse(at)))
        .collect::<Vec<_>>()
        .into();
    let measured = matches!(room, Room::Measured(_)) && crate::perf::rss::current_bytes().is_some();
    let room = match room {
        Room::Measured(bytes) if !measured => Room::Fixed(bytes),
        room => room,
    };
    let base = crate::perf::rss::current_bytes().unwrap_or(0);
    let admission = Admission {
        room,
        bytes,
        work,
        first_reader: first_readers(inputs, &readers),
        readers,
        state: Mutex::new(State {
            ready,
            admitted: Vec::new(),
            fresh: 0,
            inputs: inputs.iter().map(Vec::len).collect(),
            used: 0,
            running: 0,
            pending: 0,
            most: 0,
            first_failed: usize::MAX,
            waited: 0,
            last_waiting: None,
            scale: 1.0,
            panic: None,
        }),
        changed: Condvar::new(),
        results,
        errors: (0..count).map(|_| OnceLock::new()).collect(),
        base,
        peak: AtomicU64::new(base),
    };
    // One job, a job nested in another admission's, or a pool that cannot be built: the jobs run
    // on the calling thread, their work on the pool it stands in.
    let width = if IN_JOB.with(std::cell::Cell::get) {
        1
    } else {
        rayon::current_num_threads().min(count)
    };
    let inner = (width > 1)
        .then(|| crate::perf::pool_beside(width).ok())
        .flatten();
    admit(&admission, &mut admission.lock());
    let finished = AtomicBool::new(false);
    std::thread::scope(|threads| {
        // Set on the way out, a job's panic included: the sampler never outlives the jobs.
        let _finished = Finished(&finished);
        if measured {
            // The resident bytes sampled while the jobs run: their peaks fall between two ends.
            threads.spawn(|| {
                while !finished.load(Ordering::Relaxed) {
                    let now = crate::perf::rss::current_bytes().unwrap_or(0);
                    admission.peak.fetch_max(now, Ordering::Relaxed);
                    std::thread::sleep(std::time::Duration::from_millis(SAMPLE_MS));
                }
            });
        }
        let Some(inner) = &inner else {
            return serve(&admission, None);
        };
        let runners: Vec<_> = (0..width)
            .map(|_| threads.spawn(|| serve(&admission, Some(inner))))
            .collect();
        for runner in runners {
            if let Err(panic) = runner.join() {
                resume_unwind(panic);
            }
        }
    });
    let mut state = admission
        .state
        .into_inner()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(panic) = state.panic.take() {
        resume_unwind(panic);
    }
    if let Some(error) = admission.errors.into_iter().find_map(OnceLock::into_inner) {
        return Err(error);
    }
    let grown = admission.peak.into_inner().saturating_sub(base);
    let admitted = Admitted {
        waited: state.waited,
        most: state.most,
        measured: (measured && state.most > 0).then(|| grown as f64 / state.most as f64),
    };
    let results = (admission.results.into_iter())
        .map(|slot| slot.into_inner().expect("every job ran"))
        .collect();
    Ok((results, admitted))
}

#[cfg(test)]
mod tests;
