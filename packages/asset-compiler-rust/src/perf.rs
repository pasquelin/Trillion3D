//! Per-phase timing. Counters accumulate across worker threads, so a phase reports the CPU time
//! spent in it, not wall time; the sum of all phases exceeds the wall time of a parallel run.
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

macro_rules! phases {
 ($($field:ident=>$label:literal),* $(,)?) => {
  pub struct Phases{$(pub $field:AtomicU64),*}
  pub static PHASES:Phases=Phases{$($field:AtomicU64::new(0)),*};
  impl Phases{
   /// Milliseconds per phase, as a flat object.
   pub fn report(&self)->Value{json!({$($label:(self.$field.load(Ordering::Relaxed) as f64)/1.0e6),*})}
  }
 }
}

phases! {
 decode=>"decodeMs",
 topology=>"topologyMs",
 weld=>"weldMs",
 cluster_level0=>"clusterLevel0Ms",
 adjacency=>"adjacencyMs",
 grouping=>"groupingMs",
 locks=>"locksMs",
 simplify=>"simplifyMs",
 resplit=>"resplitMs",
 culling=>"cullingMs",
 page_bytes=>"pageBytesMs",
 page_hash=>"pageHashMs",
 page_write=>"pageWriteMs",
 page_packed=>"pagePackedMs",
 coplanar=>"coplanarMs",
 manifest=>"manifestMs",
}

/// Adds its lifetime to one counter when dropped.
pub struct Timer {
    start: Instant,
    slot: &'static AtomicU64,
}
impl Timer {
    pub fn new(slot: &'static AtomicU64) -> Self {
        Self {
            start: Instant::now(),
            slot,
        }
    }
}
impl Drop for Timer {
    fn drop(&mut self) {
        self.slot
            .fetch_add(self.start.elapsed().as_nanos() as u64, Ordering::Relaxed);
    }
}
