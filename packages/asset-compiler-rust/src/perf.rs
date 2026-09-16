//! Les durées par phase, attachées au travail qui les dépense.
//!
//! Des compteurs globaux additionnaient les phases de tous les travaux d'un même processus : le
//! second travail d'un lot publiait la simplification du premier, qui n'avait pourtant aucun groupe
//! à simplifier. Chaque compilation crée donc ses propres compteurs, les attache au fil qui la mène
//! et à chaque ouvrier de sa grappe, et ne relit qu'eux.
//!
//! Ces durées se chevauchent : elles s'additionnent d'un fil à l'autre et mesurent du temps de
//! calcul, jamais celui d'un travail. Le manifeste les publie sous `phaseCpuMs`, et leur somme n'est
//! le total de rien.
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
  /// La phase qu'un chronomètre alimente.
  #[derive(Clone,Copy)]
  pub enum Phase{$($variant),*}
  impl Phases{
   fn slot(&self,phase:Phase)->&AtomicU64{match phase{$(Phase::$variant=>&self.$field),*}}
   /// Milliseconds per phase, as a flat object.
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
}

thread_local! {
    /// Les compteurs du travail que ce fil sert en ce moment, s'il en sert un.
    static CURRENT: RefCell<Option<Arc<Phases>>> = const { RefCell::new(None) };
}

/// Les compteurs d'une compilation, partagés avec les fils qu'elle emploie.
#[derive(Clone, Default)]
pub struct JobPhases(Arc<Phases>);
impl JobPhases {
    /// Attache ces compteurs au fil courant, et rend ce qu'il portait quand le témoin se libère :
    /// un ouvrier de lot qui enchaîne deux travaux ne garde rien du premier.
    pub fn attach(&self) -> Attached {
        Attached(CURRENT.with(|current| current.borrow_mut().replace(self.0.clone())))
    }
    /// Attache ces compteurs pour toute la vie du fil : la grappe d'une compilation naît et meurt
    /// avec elle, et ses ouvriers ne servent jamais un autre travail.
    pub fn adopt(&self) {
        CURRENT.with(|current| *current.borrow_mut() = Some(self.0.clone()));
    }
    pub fn report(&self) -> Value {
        self.0.report()
    }
}

/// Le témoin d'un attachement : il rend au fil les compteurs qu'il portait avant.
pub struct Attached(Option<Arc<Phases>>);
impl Drop for Attached {
    fn drop(&mut self) {
        CURRENT.with(|current| *current.borrow_mut() = self.0.take());
    }
}

/// Ajoute sa durée de vie au compteur du travail attaché au fil courant. Un fil qui n'en sert aucun
/// ne compte rien plutôt que d'alimenter le travail d'un autre.
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
