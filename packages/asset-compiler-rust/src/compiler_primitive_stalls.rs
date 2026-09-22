//! The DAG report of a primitive: its levels, its group tallies, and every stalled group with the
//! cause the builder named, so a primitive left with many roots says why.
use super::*;
use crate::dag::{DagCluster, DagStall, DagStrategy, GroupTally};

/// What a primitive's stalls come to, read once for the report and its warning.
pub(super) struct StallSummary {
    /// Level-0 triangles that no coarser level replaces.
    pub root_triangles: usize,
    /// Cause of the stalls holding the most triangles, the first named on a tie; `None` without
    /// a stall.
    pub cause: Option<&'static str>,
    /// Seam, locked and island counts summed over the stalled groups.
    pub seam: usize,
    pub locked: usize,
    pub islands: usize,
}
impl StallSummary {
    pub fn of(dag: &[DagCluster], stalls: &[DagStall]) -> Self {
        let mut weights: Vec<(&'static str, usize)> = Vec::new();
        for stall in stalls {
            let (name, triangles) = (stall.outcome.cause.name(), stall.outcome.triangles);
            match weights.iter_mut().find(|(n, _)| *n == name) {
                Some((_, weight)) => *weight += triangles,
                None => weights.push((name, triangles)),
            }
        }
        let cause = weights
            .iter()
            .rev()
            .max_by_key(|(_, weight)| *weight)
            .map(|(name, _)| *name);
        Self {
            root_triangles: dag
                .iter()
                .filter(|c| c.level == 0 && c.is_root())
                .map(|c| c.triangles())
                .sum(),
            cause,
            seam: stalls.iter().map(|s| s.outcome.seam).sum(),
            locked: stalls.iter().map(|s| s.outcome.locked).sum(),
            islands: stalls.iter().map(|s| s.outcome.islands).sum(),
        }
    }
    /// The fields the report and the warning both carry.
    pub fn json(&self) -> Value {
        json!({
            "rootTriangles": self.root_triangles,
            "cause": self.cause,
            "seamVertices": self.seam,
            "lockedVertices": self.locked,
            "uvIslands": self.islands,
        })
    }
}

/// Copies every field of `fields`, an object, into `target`, an object.
pub(super) fn merge(target: &mut Value, fields: Value) {
    if let (Some(target), Value::Object(fields)) = (target.as_object_mut(), fields) {
        target.extend(fields);
    }
}

/// The DAG report of a primitive and its warnings.
pub(super) fn dag_report(
    strategy: DagStrategy,
    dag: &[DagCluster],
    tallies: &[GroupTally],
    stalls: &[DagStall],
) -> (Value, Vec<Value>) {
    let shape = compiler_primitive_warn::DagShape::of(dag);
    let summary = StallSummary::of(dag, stalls);
    let groups: Vec<Value> = tallies
        .iter()
        .enumerate()
        .map(|(i, tally)| {
            let mut level = tally.json();
            level["level"] = json!(i + 1);
            level
        })
        .collect();
    let warnings = compiler_primitive_warn::dag_warnings(strategy, &shape, tallies, &summary);
    let mut report = json!({
        "depth": shape.depth,
        "clusterTriangles": crate::dag::DAG_CLUSTER_TRIANGLES,
        "groupMin": crate::dag::DAG_GROUP_MIN,
        "groupMax": crate::dag::DAG_GROUP_MAX,
        "levels": compiler_primitive_warn::level_report(dag, shape.depth),
        "groups": groups,
        "warnings": warnings,
        "stalls": stalls.iter().map(DagStall::json).collect::<Vec<_>>(),
    });
    merge(&mut report, summary.json());
    (report, warnings)
}
