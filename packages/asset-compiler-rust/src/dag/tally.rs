//! Why a group stalls, and the group tally per outcome, level by level, as published in the DAG
//! report.

/// Why a group did not produce a coarser level. Its clusters then become roots.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StallCause {
    /// No target cluster size down to half a cluster re-splits what the simplifier left into the
    /// group's parents.
    Unreducible,
    /// The simplifier returned a non-finite error.
    UnusableError,
}
impl StallCause {
    /// Every cause, in the order the tally counts them.
    pub const ALL: [StallCause; 2] = [Self::Unreducible, Self::UnusableError];
    /// The key the tally's JSON counts the cause under.
    pub fn key(self) -> &'static str {
        match self {
            Self::Unreducible => "unreducible",
            Self::UnusableError => "unusableError",
        }
    }
    /// The name the report, the CLI and the corpus give the cause.
    pub fn name(self) -> &'static str {
        match self {
            Self::Unreducible => "unreducible",
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

/// Per-level tally of group outcomes, reported by the compiler so a stalled DAG is visible: the
/// groups reduced, and the stalled ones per cause (`StallCause as usize`).
#[derive(Clone, Copy, Default, Debug)]
pub struct GroupTally {
    pub reduced: usize,
    pub stalled: [usize; StallCause::ALL.len()],
}
impl GroupTally {
    /// Tally in JSON, one key per outcome: single form written by report and warning,
    /// so added field missing nowhere.
    pub fn json(&self) -> serde_json::Value {
        let mut out = serde_json::Map::new();
        out.insert("reduced".into(), self.reduced.into());
        for cause in StallCause::ALL {
            out.insert(cause.key().into(), self.stalled[cause as usize].into());
        }
        serde_json::Value::Object(out)
    }
    /// Sum of multiple levels, outcome by outcome.
    pub fn total(tallies: &[GroupTally]) -> GroupTally {
        tallies.iter().fold(GroupTally::default(), |mut a, t| {
            a.reduced += t.reduced;
            a.stalled
                .iter_mut()
                .zip(t.stalled)
                .for_each(|(x, y)| *x += y);
            a
        })
    }
    pub(super) fn record(&mut self, cause: StallCause) {
        self.stalled[cause as usize] += 1;
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
