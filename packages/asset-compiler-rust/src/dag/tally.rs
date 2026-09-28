//! Why a group stalls, and the group tally per outcome, level by level, as published in the DAG
//! report.

/// Why a group did not produce a coarser level. Its clusters then become roots. Every cause is a
/// property of the group, decided by rerunning its stalled reduction with a constraint lifted:
/// none compares a number to a threshold.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StallCause {
    /// Fewer than two live triangles: nothing to halve.
    TooSmall,
    /// Rerun with no lock it still stalls, and with no lock on positions welded across the
    /// seams of every texture set it advances: the texture seams hold the group.
    SeamLocked,
    /// Rerun with no lock it advances: the positions shared with the neighbouring groups hold it.
    BorderLocked,
    /// Neither rerun advances: the surface itself resists the halving.
    Unreducible,
    /// A locked position disappeared on every retry.
    BorderLost,
    /// The simplifier returned a non-finite error.
    UnusableError,
}
impl StallCause {
    /// The name the report, the CLI and the corpus give the cause.
    pub fn name(self) -> &'static str {
        match self {
            Self::TooSmall => "too-small",
            Self::SeamLocked => "seam-locked",
            Self::BorderLocked => "border-locked",
            Self::Unreducible => "unreducible",
            Self::BorderLost => "border-lost",
            Self::UnusableError => "unusable-error",
        }
    }
}

/// A stalled group: its cause and the three counts that explain it, over its live triangles.
/// `seam` counts the positions the group uses under several (position, texture coordinate)
/// copies, `locked` those another group of the level also uses, `islands` the connected
/// components of its triangles once copies sharing position and texture coordinates are one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct GroupOutcome {
    pub cause: StallCause,
    pub triangles: usize,
    pub seam: usize,
    pub locked: usize,
    pub islands: usize,
}

/// Per-level tally of group outcomes, reported by the compiler so a stalled DAG is visible.
/// `relocked` counts, among the reduced groups, those that needed extra locks.
#[derive(Clone, Copy, Default, Debug)]
pub struct GroupTally {
    pub reduced: usize,
    pub relocked: usize,
    pub too_small: usize,
    pub seam_locked: usize,
    pub border_locked: usize,
    pub unreducible: usize,
    pub border_lost: usize,
    pub unusable_error: usize,
}
impl GroupTally {
    /// Tally in JSON, one key per field: single form written by report and warning,
    /// so added field missing nowhere.
    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "reduced": self.reduced,
            "relocked": self.relocked,
            "tooSmall": self.too_small,
            "seamLocked": self.seam_locked,
            "borderLocked": self.border_locked,
            "unreducible": self.unreducible,
            "borderLost": self.border_lost,
            "unusableError": self.unusable_error,
        })
    }
    /// Sum of multiple levels, field by field.
    pub fn total(tallies: &[GroupTally]) -> GroupTally {
        tallies
            .iter()
            .fold(GroupTally::default(), |a, t| GroupTally {
                reduced: a.reduced + t.reduced,
                relocked: a.relocked + t.relocked,
                too_small: a.too_small + t.too_small,
                seam_locked: a.seam_locked + t.seam_locked,
                border_locked: a.border_locked + t.border_locked,
                unreducible: a.unreducible + t.unreducible,
                border_lost: a.border_lost + t.border_lost,
                unusable_error: a.unusable_error + t.unusable_error,
            })
    }
    pub(super) fn record(&mut self, cause: StallCause) {
        *match cause {
            StallCause::TooSmall => &mut self.too_small,
            StallCause::SeamLocked => &mut self.seam_locked,
            StallCause::BorderLocked => &mut self.border_locked,
            StallCause::Unreducible => &mut self.unreducible,
            StallCause::BorderLost => &mut self.border_lost,
            StallCause::UnusableError => &mut self.unusable_error,
        } += 1;
    }
}

/// A stalled group and the level it was built for, as the report lists it.
#[derive(Clone, Copy, Debug)]
pub struct DagStall {
    pub level: usize,
    pub outcome: GroupOutcome,
}
impl DagStall {
    pub fn json(&self) -> serde_json::Value {
        let o = &self.outcome;
        serde_json::json!({
            "level": self.level,
            "cause": o.cause.name(),
            "triangles": o.triangles,
            "seamVertices": o.seam,
            "lockedVertices": o.locked,
            "uvIslands": o.islands,
        })
    }
}
