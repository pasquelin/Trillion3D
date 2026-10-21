//! One admission for the jobs of a compile that share its RAM room: the primitives, the textures,
//! the HLOD actors.
//!
//! A pool runs as many jobs as it has workers, whatever each one holds: the widest jobs of a scene
//! could then commit several times the room at once. Each job instead names the jobs whose results
//! it reads, and is estimated — once those are done, from what they made — to hold some bytes; it
//! is admitted once its bytes fit beside the jobs running — a job alone past the room never
//! refused —, and each job that ends admits what now fits: no barrier, and nothing waits for room
//! inside a pool, so a worker can never hold the work it waits for. The ready jobs go by their
//! rank when the caller gives one — the critical path's, the highest first — else the widest
//! first; the bytes only decide whether a job fits. A first ready job that does not fit lets a few
//! behind it that do pass (`run::FILL`), never more while it waits, so it stays first once the
//! room frees. The results come back in the jobs' order, whatever order they ran in; a failure is
//! the first in that order of the jobs that fail once their inputs are made, whatever order they
//! ran in.
//!
//! The jobs run as tasks of the calling pool — the compile's one pool, whose workers also run
//! every job's parallel steps —, each spawned once admitted, at most as many running at once as
//! the pool has workers: the admission makes no thread nor pool of its own, so the compile never
//! holds more threads than cores. A worker waiting in a join takes whatever work is queued, a
//! whole other job included: the job it waits in then ends only once the other does, its bytes
//! counted all along, its timers paused while the other's run. A job nested in a job of another
//! admission runs its jobs on the same pool.
//!
//! A job counts its estimate while it runs, or the step it runs when that step holds more: a step
//! whose bytes are counted exactly before it starts — a shell's surface cells before its march —
//! says so (`Step`), and while it runs no job starts beside it that its exact bytes leave no room
//! for. Nothing makes a step wait for room: the worker that runs it may stand on another job's
//! work, whose bytes it would then wait for forever.
//!
//! The room is a fixed sum of estimates (`Room::Fixed`), or the bytes the process may hold
//! resident (`Room::Measured`): what it holds now plus the estimates admitted that have not
//! started, or what it held when the jobs began plus the estimates running, whichever is more,
//! plus the next job's estimate — every estimate scaled by what the process measured of the jobs
//! lately, the growth of its resident bytes since the last job ended over the most estimated bytes
//! of the jobs started meanwhile it ran at once, never below `LEAST_SCALE` and halving at most per
//! job. Measured since the start instead, the growth would count every result the jobs done keep —
//! a graph's results pile up as it runs — against the estimates of the jobs still to come, again
//! and again: the scale would only rise, and late jobs would run one at a time. Before the bytes
//! are measured at a job's end, and at a step's, the allocator gives back what it holds freed
//! (`rss::purge`): what is measured is what the jobs still hold, not what they let go of.
//! The shared state and the admission live in `state`, admitting and running a job in `run`, the
//! tests in `tests`.
use rayon::prelude::*;
use std::cell::RefCell;
use std::collections::BinaryHeap;
use std::panic::resume_unwind;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
mod state;
use state::{first_readers, keyed, Admission, Ready, State, Window};
mod run;
use run::{admit, launch};

/// What bounds the jobs running at once.
#[derive(Clone, Copy, Debug)]
pub enum Room {
    /// The bytes their estimates may sum to.
    Fixed(usize),
    /// The bytes the process may hold resident (`crate::support::perf::rss::current_bytes`); a fixed sum of
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

/// An admission's state, locked: a job's panic, caught, leaves it whole.
fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

/// The state of an admission and one of its jobs.
type Mark = (Arc<Mutex<State>>, usize);

std::thread_local! {
    /// The jobs whose work runs on this thread, the innermost last: a worker that takes another
    /// job whole while it waits in a join runs that one's on top of its own.
    static RUNNING: RefCell<Vec<Mark>> = const { RefCell::new(Vec::new()) };
}

/// Marks job `at` of the admission `state` as running on the current thread while it lives, its
/// mark taken off when it drops, a panic included.
struct Running;

impl Running {
    fn enter(state: &Arc<Mutex<State>>, at: usize) -> Self {
        RUNNING.with(|running| running.borrow_mut().push((Arc::clone(state), at)));
        Self
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        RUNNING.with(|running| running.borrow_mut().pop());
    }
}

/// A step of a job, counted while it lives (`Step::begin`); nothing outside an admitted job.
pub struct Step(Option<(Mark, usize)>);

impl Step {
    /// The step the job running on this thread is about to run, which holds `bytes` at most,
    /// everything the job holds meanwhile included — counted exactly before it starts, as a
    /// shell's surface cells are before its march. While it lives the job counts the more of its
    /// estimate and `bytes`: a step that outgrows its estimate lets no job start that its bytes
    /// leave no room for. When it drops, the job counts what it counted before it, once the
    /// allocator gave back what the step freed (`rss::purge`); the room that frees admits the next
    /// jobs when a job ends. Begun in the job's own flow — the
    /// thread its work runs on —, never in a task it shares out, which a worker standing on another
    /// job's work may run.
    pub fn begin(bytes: usize) -> Self {
        let job = RUNNING.with(|running| running.borrow().last().cloned());
        Self(job.map(|(state, at)| {
            let was = lock(&state).step(at, bytes);
            ((state, at), was)
        }))
    }
}

impl Drop for Step {
    fn drop(&mut self) {
        if let Some(((state, at), was)) = self.0.take() {
            crate::support::perf::rss::purge();
            lock(&state).step(at, was);
        }
    }
}

/// Runs `work` over every job as tasks of the current pool, at most as many at once as it has
/// workers — job `k` reading the results of the jobs `inputs[k]` through `Done` —, each once those
/// are done and its `bytes`, estimated from them, fit `room` beside the jobs running, the ready one
/// of highest `rank` first — none: the widest. The results in the jobs' order and what the
/// admission ran under; else the error of the first job in that order that fails once its inputs
/// are made: after a failure only the jobs that come before it, or that such a job reads, are
/// still admitted.
pub fn run_admitted<T: Send + Sync, E: Send + Sync>(
    inputs: &[Vec<usize>],
    (room, rank): (Room, Option<&[u64]>),
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
    let rank = rank.map_or_else(Vec::new, <[u64]>::to_vec);
    // The jobs reading nothing, estimated side by side.
    let ready: BinaryHeap<Ready> = (0..count)
        .into_par_iter()
        .filter(|&at| inputs[at].is_empty())
        .map(|at| keyed(&rank, at, bytes(at, &Done { slots: &results })))
        .collect::<Vec<_>>()
        .into();
    let first = crate::support::perf::rss::current_bytes();
    let measured = matches!(room, Room::Measured(_)) && first.is_some();
    let room = match room {
        Room::Measured(bytes) if !measured => Room::Fixed(bytes),
        room => room,
    };
    let base = first.unwrap_or(0);
    let admission = Admission {
        room,
        rank,
        width: rayon::current_num_threads(),
        bytes,
        work,
        first_reader: first_readers(inputs, &readers),
        readers,
        state: Arc::new(Mutex::new(State {
            ready,
            inputs: inputs.iter().map(Vec::len).collect(),
            held: vec![None; count],
            used: 0,
            running: 0,
            fresh: 0,
            most: 0,
            first_failed: usize::MAX,
            waited: 0,
            counted: vec![false; count],
            last_waiting: None,
            passed: 0,
            scale: 1.0,
            window: Window::new(base),
            panic: None,
        })),
        results,
        errors: (0..count).map(|_| OnceLock::new()).collect(),
        base,
        peak: AtomicU64::new(base),
        window_peak: AtomicU64::new(base),
    };
    let opening = admit(&admission, &mut admission.lock(), base);
    let finished = AtomicBool::new(false);
    std::thread::scope(|threads| {
        // Set on the way out, a job's panic included: the sampler never outlives the jobs.
        let _finished = Finished(&finished);
        if measured {
            // The resident bytes sampled while the jobs run: their peaks fall between two ends.
            threads.spawn(|| {
                while !finished.load(Ordering::Relaxed) {
                    let now = crate::support::perf::rss::current_bytes().unwrap_or(0);
                    admission.peak.fetch_max(now, Ordering::Relaxed);
                    admission.window_peak.fetch_max(now, Ordering::Relaxed);
                    std::thread::sleep(std::time::Duration::from_millis(SAMPLE_MS));
                }
            });
        }
        // The calling thread runs jobs too while it waits for the last.
        rayon::in_place_scope(|scope| launch(scope, &admission, opening));
    });
    let (panic, waited, most) = {
        let mut state = admission.lock();
        (state.panic.take(), state.waited, state.most)
    };
    if let Some(panic) = panic {
        resume_unwind(panic);
    }
    if let Some(error) = admission.errors.into_iter().find_map(OnceLock::into_inner) {
        return Err(error);
    }
    let grown = admission.peak.into_inner().saturating_sub(base);
    let admitted = Admitted {
        waited,
        most,
        measured: (measured && most > 0).then(|| grown as f64 / most as f64),
    };
    let results = (admission.results.into_iter())
        .map(|slot| slot.into_inner().expect("every job ran"))
        .collect();
    Ok((results, admitted))
}

#[cfg(test)]
mod tests;
