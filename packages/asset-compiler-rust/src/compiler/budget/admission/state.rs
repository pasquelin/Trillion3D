//! The admission's shared state, the admission itself and each job's first readers.
use super::{lock, Room};
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

/// A ready job: its key — its rank, else its bytes —, the job, the first of equal keys first, and
/// its estimated bytes.
pub(super) type Ready = (u64, Reverse<usize>, usize);

/// Job `at` ready with `bytes`, keyed by its `rank` when the admission has ranks, else by its
/// bytes.
pub(super) fn keyed(rank: &[u64], at: usize, bytes: usize) -> Ready {
    let key = rank.get(at).copied().unwrap_or(bytes as u64);
    (key, Reverse(at), bytes)
}

/// Where an admission stands: the jobs ready by their key (`Ready`), the highest first and then
/// the first; the inputs each job still waits for; what each job admitted holds (`Held`), none
/// once its work is done; the bytes and the jobs running — started or not, their work not yet
/// done —, and the bytes of those not yet started; the most bytes run at once; the first job in
/// order that failed, `usize::MAX` while none has; the jobs the room made wait, each counted once
/// (`counted`), the last of them and the jobs let past it while it waits (`run::FILL`); the scale
/// the measures give the estimates and the current window of measure (`run::rescale`); and the
/// first panic of a job.
pub(super) struct State {
    pub(super) ready: BinaryHeap<Ready>,
    pub(super) inputs: Vec<usize>,
    pub(super) held: Vec<Option<Held>>,
    pub(super) used: usize,
    pub(super) running: usize,
    pub(super) fresh: usize,
    pub(super) most: usize,
    pub(super) first_failed: usize,
    pub(super) waited: usize,
    pub(super) counted: Vec<bool>,
    pub(super) last_waiting: Option<usize>,
    pub(super) passed: usize,
    pub(super) scale: f64,
    pub(super) window: Window,
    pub(super) panic: Option<Box<dyn std::any::Any + Send>>,
}

/// A window of measure: its number, the resident bytes when it began, the bytes counted running of
/// the jobs started in it and the most of them at once.
pub(super) struct Window {
    pub(super) id: u64,
    pub(super) base: u64,
    pub(super) used: usize,
    pub(super) most: usize,
}

impl Window {
    /// The first window, begun with `now` resident bytes and no job started.
    pub(super) fn new(now: u64) -> Self {
        Self {
            id: 0,
            base: now,
            used: 0,
            most: 0,
        }
    }
}

/// What a job admitted holds: its estimated bytes, those of the step it runs (`super::Step`), and
/// the window of measure it started in — none until a worker starts it.
#[derive(Clone, Copy)]
pub(super) struct Held {
    estimate: usize,
    step: usize,
    window: Option<u64>,
}

impl Held {
    /// The bytes it counts: its estimate, or the step it runs when that holds more.
    fn bytes(&self) -> usize {
        self.estimate.max(self.step)
    }
}

impl State {
    /// Counts job `at` admitted, its `bytes` running, for a worker to start.
    pub(super) fn admit(&mut self, at: usize, bytes: usize) {
        self.running += 1;
        self.fresh = self.fresh.saturating_add(bytes);
        self.used = self.used.saturating_add(bytes);
        self.most = self.most.max(self.used);
        self.held[at] = Some(Held {
            estimate: bytes,
            step: 0,
            window: None,
        });
    }

    /// Job `at` started by a worker: in the current window, its bytes counted in that window's.
    pub(super) fn start(&mut self, at: usize) {
        let Some(job) = &mut self.held[at] else {
            return;
        };
        let (window, bytes) = (&mut self.window, job.bytes());
        job.window = Some(window.id);
        self.fresh = self.fresh.saturating_sub(bytes);
        window.used = window.used.saturating_add(bytes);
        window.most = window.most.max(window.used);
    }

    /// Job `at` running a step of `bytes`, none once it ends (`super::Step`): what the job counts
    /// changes by the same in the room's bytes, and in its window's — or in those not yet started.
    /// The bytes of the step it ran before, which it runs again once this one ends.
    pub(super) fn step(&mut self, at: usize, bytes: usize) -> usize {
        let Some(job) = &mut self.held[at] else {
            return 0;
        };
        let before = job.bytes();
        let was = std::mem::replace(&mut job.step, bytes);
        let (after, started) = (job.bytes(), job.window);
        let shift = |count: usize| count.saturating_sub(before).saturating_add(after);
        self.used = shift(self.used);
        self.most = self.most.max(self.used);
        match started {
            Some(id) if id == self.window.id => {
                self.window.used = shift(self.window.used);
                self.window.most = self.window.most.max(self.window.used);
            }
            Some(_) => {}
            None => self.fresh = shift(self.fresh),
        }
        was
    }

    /// Lets go of the bytes of job `at`, its work done: they leave its window's, if still current,
    /// or those not yet started. A job let go of already lets go of nothing more.
    pub(super) fn release(&mut self, at: usize) {
        let Some(job) = self.held[at].take() else {
            return;
        };
        let bytes = job.bytes();
        self.running -= 1;
        self.used = self.used.saturating_sub(bytes);
        match job.window {
            Some(id) if id == self.window.id => {
                self.window.used = self.window.used.saturating_sub(bytes);
            }
            Some(_) => {}
            None => self.fresh = self.fresh.saturating_sub(bytes),
        }
    }
}

/// What the running jobs share: the room, the jobs' ranks (`keyed`; empty: none), the most jobs
/// running at once — the pool's workers —, the estimate, the work, the jobs reading each one and,
/// per job, the first in order of itself and the jobs that read it through any chain, where the
/// admission stands — shared with the steps of its jobs (`super::Step`) —, the results, the
/// errors, the resident bytes when the jobs began and the most sampled since, and the most sampled
/// since the current window began.
pub(super) struct Admission<T, E, B, W> {
    pub(super) room: Room,
    pub(super) rank: Vec<u64>,
    pub(super) width: usize,
    pub(super) bytes: B,
    pub(super) work: W,
    pub(super) readers: Vec<Vec<usize>>,
    pub(super) first_reader: Vec<usize>,
    pub(super) state: Arc<Mutex<State>>,
    pub(super) results: Vec<OnceLock<T>>,
    pub(super) errors: Vec<OnceLock<E>>,
    pub(super) base: u64,
    pub(super) peak: AtomicU64,
    pub(super) window_peak: AtomicU64,
}

impl<T, E, B, W> Admission<T, E, B, W> {
    pub(super) fn lock(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }

    /// Whether `bytes` more fit beside the jobs running, `used` what they count, `fresh` that of
    /// them not yet started, `now` the resident bytes measured last.
    pub(super) fn fits(&self, state: &State, bytes: usize, now: u64) -> bool {
        if state.running == 0 {
            return true;
        }
        match self.room {
            Room::Fixed(room) => bytes <= room.saturating_sub(state.used),
            Room::Measured(room) => {
                let scaled = |b: usize| (b as f64 * state.scale) as u64;
                let started = now.saturating_add(scaled(state.fresh));
                let held = started.max(self.base.saturating_add(scaled(state.used)));
                held.saturating_add(scaled(bytes)) <= room as u64
            }
        }
    }

    /// Whether job `at` may still decide the admission's outcome: it, or a job reading it through
    /// any chain, comes before the first job that failed.
    pub(super) fn decides(&self, state: &State, at: usize) -> bool {
        self.first_reader[at] < state.first_failed
    }
}

/// Per job, the first in order of itself and the jobs reading it through any chain (`readers`),
/// `inputs` the jobs each reads: readers before what they read, from the jobs no one reads. A job
/// on a cycle, never ready, keeps its own rank.
pub(super) fn first_readers(inputs: &[Vec<usize>], readers: &[Vec<usize>]) -> Vec<usize> {
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
