//! L'annulation relue **à l'intérieur** d'un maillage.
//!
//! Un jeton lu une fois par objet ne suffit pas : une scène d'un seul objet à un million de faces
//! ne s'arrête alors qu'une fois ce million posé. Les pilotes qui découpent des faces relisent donc
//! le jeton par tranche, tous par cette aide et sous le même refus nommé — une lecture relâchée
//! toutes les quelques milliers de faces, que le corpus ne voit pas passer.
use crate::CompilerError;
use std::sync::atomic::{AtomicBool, Ordering};

/// Faces entre deux lectures du jeton : assez pour que la lecture ne pèse rien, assez peu pour
/// qu'un maillage énorme s'arrête sans attendre sa dernière face.
const SLICE: usize = 4096;

/// Vrai quand le jeton est levé, relu au début de chaque tranche. `done` est le nombre de faces
/// déjà posées par ce maillage.
pub(super) fn stopped(cancelled: &AtomicBool, done: usize) -> bool {
    done.is_multiple_of(SLICE) && cancelled.load(Ordering::Relaxed)
}

/// Le refus qu'une compilation annulée porte, le même pour tous les pilotes.
pub(super) fn refusal() -> CompilerError {
    CompilerError::new("CANCELLED", "Import cancelled")
}
