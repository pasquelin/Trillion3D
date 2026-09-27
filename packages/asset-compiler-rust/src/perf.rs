//! Durations per phase, attached to the job that spends them.
//!
//! Global counters used to add up the phases of every job in the same process:
//! the second job of a batch published the first's simplification, which had no
//! group to simplify. Each compilation therefore creates its own counters, attaches
//! them to the thread that leads it and to each worker of its pool, and rereads
//! only those.
//!
//! These durations overlap: each timer measures the **elapsed** time between its
//! birth and its death, and those intervals add up from one thread to another.
//! Elapsed time is not CPU time: a wait, a write or a preempted thread enter the
//! phase without any computation. The manifest therefore publishes them under
//! `phaseElapsedMs`, their sum is the total of nothing, and `cpuMs` stays zero
//! until someone actually measures the CPU.
use serde_json::{json, Value};
use std::cell::RefCell;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Instant;

macro_rules! phases {
 ($($field:ident=>$variant:ident=>$label:literal),* $(,)?) => {
  #[derive(Default)]
  struct Phases{$($field:AtomicU64),*}
  /// The phase a timer feeds.
  #[derive(Clone,Copy)]
  pub enum Phase{$($variant),*}
  impl Phases{
   fn slot(&self,phase:Phase)->&AtomicU64{match phase{$(Phase::$variant=>&self.$field),*}}
   /// Elapsed milliseconds accumulated per phase, as a flat object.
   fn report(&self)->Value{json!({$($label:(self.$field.load(Ordering::Relaxed) as f64)/1.0e6),*})}
  }
 }
}

phases! {
 decode=>Decode=>"decodeMs",
 topology=>Topology=>"topologyMs",
 weld=>Weld=>"weldMs",
 cluster_level0=>ClusterLevel0=>"clusterLevel0Ms",
 adjacency=>Adjacency=>"adjacencyMs",
 grouping=>Grouping=>"groupingMs",
 locks=>Locks=>"locksMs",
 simplify=>Simplify=>"simplifyMs",
 resplit=>Resplit=>"resplitMs",
 culling=>Culling=>"cullingMs",
 page_bytes=>PageBytes=>"pageBytesMs",
 page_hash=>PageHash=>"pageHashMs",
 page_write=>PageWrite=>"pageWriteMs",
 page_packed=>PagePacked=>"pagePackedMs",
 coplanar=>Coplanar=>"coplanarMs",
 manifest=>Manifest=>"manifestMs",
 texture_alpha=>TextureAlpha=>"textureAlphaMs",
 texture_decode=>TextureDecode=>"textureDecodeMs",
 texture_bake=>TextureBake=>"textureBakeMs",
 texture_write=>TextureWrite=>"textureWriteMs",
 cutout_scan=>CutoutScan=>"cutoutScanMs",
}

thread_local! {
    /// Counters of the job this thread currently serves, if it serves one.
    static CURRENT: RefCell<Option<Arc<Phases>>> = const { RefCell::new(None) };
}

/// Counters of a compilation, shared with the threads it employs.
#[derive(Clone, Default)]
pub struct JobPhases(Arc<Phases>);
impl JobPhases {
    /// Attaches these counters to the current thread, and restores what it carried
    /// when the guard drops: a batch worker that chains two jobs keeps nothing of
    /// the first.
    pub fn attach(&self) -> Attached {
        Attached(CURRENT.with(|current| current.borrow_mut().replace(self.0.clone())))
    }
    /// Attaches these counters for the whole life of the thread: a compilation's
    /// pool is born and dies with it, and its workers never serve another job.
    pub fn adopt(&self) {
        CURRENT.with(|current| *current.borrow_mut() = Some(self.0.clone()));
    }
    /// The pool of one job: born and dying with it, each worker adopting these
    /// counters, never a neighbour's.
    pub fn pool(&self, threads: usize) -> Result<rayon::ThreadPool, rayon::ThreadPoolBuildError> {
        let phases = self.clone();
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .start_handler(move |_| phases.adopt())
            .build()
    }
    pub fn report(&self) -> Value {
        self.0.report()
    }
}

/// Attachment guard: it restores to the thread the counters it carried before.
pub struct Attached(Option<Arc<Phases>>);
impl Drop for Attached {
    fn drop(&mut self) {
        CURRENT.with(|current| *current.borrow_mut() = self.0.take());
    }
}

/// Adds its lifetime — elapsed time, not CPU time — to the counter of the job
/// attached to the current thread. A thread that serves none counts nothing
/// rather than feeding another job's.
pub struct Timer {
    start: Instant,
    phases: Option<Arc<Phases>>,
    phase: Phase,
}
impl Timer {
    pub fn new(phase: Phase) -> Self {
        Self {
            start: Instant::now(),
            phases: CURRENT.with(|current| current.borrow().clone()),
            phase,
        }
    }
}
impl Drop for Timer {
    fn drop(&mut self) {
        if let Some(phases) = &self.phases {
            phases
                .slot(self.phase)
                .fetch_add(self.start.elapsed().as_nanos() as u64, Ordering::Relaxed);
        }
    }
}

/// Elapsed milliseconds of the stages of one primitive, in order. Primitives compile in parallel
/// and share their job's counters, so a primitive cannot read its own share of them: it times its
/// own stages, each from the end of the one before, and a slow cook says where it went.
pub struct Laps {
    last: Instant,
    laps: serde_json::Map<String, Value>,
}
impl Laps {
    pub fn start() -> Self {
        Self {
            last: Instant::now(),
            laps: serde_json::Map::new(),
        }
    }
    /// Closes the running stage under `label`, and opens the next.
    pub fn lap(&mut self, label: &str) {
        let now = Instant::now();
        let ms = now.duration_since(self.last).as_secs_f64() * 1000.0;
        self.laps.insert(label.into(), json!(ms));
        self.last = now;
    }
    pub fn report(self) -> Value {
        Value::Object(self.laps)
    }
}
