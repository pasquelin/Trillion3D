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
use rayon::prelude::*;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};

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

/// Where an admission stands: the jobs ready by their estimated bytes, the widest first and then
/// the first; the jobs admitted that no thread has taken yet, with their bytes, and those bytes'
/// sum; the inputs each job still waits for; the bytes and the jobs running — taken or not, their
/// work not yet done —; the jobs admitted whose end is not yet counted; the most bytes run at
/// once; the first job in order that failed, `usize::MAX` while none has; the jobs the
/// room made wait — the last of them apart, so each counts once —; the scale the measures give the
/// estimates; and the first panic of a job.
struct State {
    ready: BinaryHeap<(usize, Reverse<usize>)>,
    admitted: Vec<(usize, usize)>,
    fresh: usize,
    inputs: Vec<usize>,
    used: usize,
    running: usize,
    pending: usize,
    most: usize,
    first_failed: usize,
    waited: usize,
    last_waiting: Option<usize>,
    scale: f64,
    panic: Option<Box<dyn std::any::Any + Send>>,
}

/// What the running jobs share: the room, the estimate, the work, the jobs reading each one and,
/// per job, the first in order of itself and the jobs that read it through any chain, where the
/// admission stands and its threads' wake-up, the results, the errors, the resident bytes when the
/// jobs began and the most sampled since.
struct Admission<T, E, B, W> {
    room: Room,
    bytes: B,
    work: W,
    readers: Vec<Vec<usize>>,
    first_reader: Vec<usize>,
    state: Mutex<State>,
    changed: Condvar,
    results: Vec<OnceLock<T>>,
    errors: Vec<OnceLock<E>>,
    base: u64,
    peak: AtomicU64,
}

impl<T, E, B, W> Admission<T, E, B, W> {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether `bytes` more fit beside the jobs running, `used` their estimates, `fresh` those of
    /// them not yet started.
    fn fits(&self, state: &State, bytes: usize) -> bool {
        if state.running == 0 {
            return true;
        }
        match self.room {
            Room::Fixed(room) => bytes <= room.saturating_sub(state.used),
            Room::Measured(room) => {
                let scaled = |b: usize| (b as f64 * state.scale) as u64;
                let now = crate::perf::rss::current_bytes().unwrap_or(0);
                let started = now.saturating_add(scaled(state.fresh));
                let held = started.max(self.base.saturating_add(scaled(state.used)));
                held.saturating_add(scaled(bytes)) <= room as u64
            }
        }
    }

    /// Whether job `at` may still decide the admission's outcome: it, or a job reading it through
    /// any chain, comes before the first job that failed.
    fn decides(&self, state: &State, at: usize) -> bool {
        self.first_reader[at] < state.first_failed
    }
}

/// Per job, the first in order of itself and the jobs reading it through any chain (`readers`),
/// `inputs` the jobs each reads: readers before what they read, from the jobs no one reads. A job
/// on a cycle, never ready, keeps its own rank.
fn first_readers(inputs: &[Vec<usize>], readers: &[Vec<usize>]) -> Vec<usize> {
    let mut first: Vec<usize> = (0..inputs.len()).collect();
    let mut unread: Vec<usize> = readers.iter().map(Vec::len).collect();
    let mut next: Vec<usize> = (0..inputs.len()).filter(|&at| unread[at] == 0).collect();
    while let Some(at) = next.pop() {
        for &input in &inputs[at] {
            first[input] = first[input].min(first[at]);
            unread[input] -= 1;
            if unread[input] == 0 {
                next.push(input);
            }
        }
    }
    first
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

/// Admits the ready jobs of `admission` while they fit, the widest first, each handed to the
/// threads that take the jobs admitted; a ready job that can no longer decide the outcome
/// (`Admission::decides`) is dropped.
fn admit<T, E, B, W>(admission: &Admission<T, E, B, W>, state: &mut State) {
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
fn serve<T, E, B, W>(admission: &Admission<T, E, B, W>, inner: Option<&rayon::ThreadPool>)
where
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

#[cfg(test)]
mod tests {
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
}
