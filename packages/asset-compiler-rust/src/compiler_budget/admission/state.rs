//! The admission's shared state, the admission itself and each job's first readers.
use super::Room;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::sync::atomic::AtomicU64;
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};

/// Where an admission stands: the jobs ready by their estimated bytes, the widest first and then
/// the first; the jobs admitted that no thread has taken yet, with their bytes, and those bytes'
/// sum; the inputs each job still waits for; the bytes and the jobs running — taken or not, their
/// work not yet done —; the jobs admitted whose end is not yet counted; the most bytes run at
/// once; the first job in order that failed, `usize::MAX` while none has; the jobs the
/// room made wait — the last of them apart, so each counts once —; the scale the measures give the
/// estimates; and the first panic of a job.
pub(super) struct State {
    pub(super) ready: BinaryHeap<(usize, Reverse<usize>)>,
    pub(super) admitted: Vec<(usize, usize)>,
    pub(super) fresh: usize,
    pub(super) inputs: Vec<usize>,
    pub(super) used: usize,
    pub(super) running: usize,
    pub(super) pending: usize,
    pub(super) most: usize,
    pub(super) first_failed: usize,
    pub(super) waited: usize,
    pub(super) last_waiting: Option<usize>,
    pub(super) scale: f64,
    pub(super) panic: Option<Box<dyn std::any::Any + Send>>,
}

/// What the running jobs share: the room, the estimate, the work, the jobs reading each one and,
/// per job, the first in order of itself and the jobs that read it through any chain, where the
/// admission stands and its threads' wake-up, the results, the errors, the resident bytes when the
/// jobs began and the most sampled since.
pub(super) struct Admission<T, E, B, W> {
    pub(super) room: Room,
    pub(super) bytes: B,
    pub(super) work: W,
    pub(super) readers: Vec<Vec<usize>>,
    pub(super) first_reader: Vec<usize>,
    pub(super) state: Mutex<State>,
    pub(super) changed: Condvar,
    pub(super) results: Vec<OnceLock<T>>,
    pub(super) errors: Vec<OnceLock<E>>,
    pub(super) base: u64,
    pub(super) peak: AtomicU64,
}

impl<T, E, B, W> Admission<T, E, B, W> {
    pub(super) fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether `bytes` more fit beside the jobs running, `used` their estimates, `fresh` those of
    /// them not yet started.
    pub(super) fn fits(&self, state: &State, bytes: usize) -> bool {
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
