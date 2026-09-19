//! Le décompte des groupes par issue, niveau par niveau, tel que le rapport du DAG le publie.

/// Why a group did not produce a coarser level. Its clusters then become roots.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GroupOutcome {
    Reduced,
    TooSmall,
    NoCollapse,
    BorderLost,
    UnusableError,
}
/// Per-level tally of group outcomes, reported by the compiler so a stalled DAG is visible.
/// `welded` and `relocked` count, among the reduced groups, those that needed a retry.
#[derive(Clone, Copy, Default, Debug)]
pub struct GroupTally {
    pub reduced: usize,
    pub welded: usize,
    pub relocked: usize,
    pub too_small: usize,
    pub no_collapse: usize,
    pub border_lost: usize,
    pub unusable_error: usize,
}
impl GroupTally {
    /// Le décompte en JSON, une clé par champ : la seule forme que le rapport et l'avertissement
    /// écrivent, pour qu'un champ ajouté ici ne manque nulle part.
    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "reduced": self.reduced,
            "welded": self.welded,
            "relocked": self.relocked,
            "tooSmall": self.too_small,
            "noCollapse": self.no_collapse,
            "borderLost": self.border_lost,
            "unusableError": self.unusable_error,
        })
    }
    /// La somme de plusieurs niveaux, champ à champ.
    pub fn total(tallies: &[GroupTally]) -> GroupTally {
        tallies
            .iter()
            .fold(GroupTally::default(), |a, t| GroupTally {
                reduced: a.reduced + t.reduced,
                welded: a.welded + t.welded,
                relocked: a.relocked + t.relocked,
                too_small: a.too_small + t.too_small,
                no_collapse: a.no_collapse + t.no_collapse,
                border_lost: a.border_lost + t.border_lost,
                unusable_error: a.unusable_error + t.unusable_error,
            })
    }
    pub(super) fn record(&mut self, outcome: GroupOutcome) {
        match outcome {
            GroupOutcome::Reduced => self.reduced += 1,
            GroupOutcome::TooSmall => self.too_small += 1,
            GroupOutcome::NoCollapse => self.no_collapse += 1,
            GroupOutcome::BorderLost => self.border_lost += 1,
            GroupOutcome::UnusableError => self.unusable_error += 1,
        }
    }
}
