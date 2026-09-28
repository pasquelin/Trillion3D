//! The DAG report of a primitive: its levels, its group tallies, and every stalled group with the
//! cause the builder named, so a primitive left with many roots says why.
use super::*;
use crate::dag::{DagCluster, DagStall, DagStrategy, GroupTally, StallCause};

/// The summary's fields, the keys `StallSummary::json` writes, copied into each stall table row.
const SUMMARY_FIELDS: [&str; 5] = [
    "rootTriangles",
    "cause",
    "seamVertices",
    "lockedVertices",
    "uvIslands",
];

/// What a primitive's stalls come to, read once for the report and its warning.
pub(super) struct StallSummary {
    /// Level-0 triangles that no coarser level replaces.
    pub root_triangles: usize,
    /// Cause of the stalls holding the most triangles, the first named on a tie; `None` without
    /// a stall.
    pub cause: Option<StallCause>,
    /// Seam, locked and island counts summed over the stalled groups.
    pub seam: usize,
    pub locked: usize,
    pub islands: usize,
}
impl StallSummary {
    pub fn of(dag: &[DagCluster], stalls: &[DagStall]) -> Self {
        let mut weights: Vec<(StallCause, usize)> = Vec::new();
        for stall in stalls {
            let (cause, triangles) = (stall.outcome.cause, stall.outcome.triangles);
            match weights.iter_mut().find(|(c, _)| *c == cause) {
                Some((_, weight)) => *weight += triangles,
                None => weights.push((cause, triangles)),
            }
        }
        let cause = weights
            .iter()
            .rev()
            .max_by_key(|(_, weight)| *weight)
            .map(|(cause, _)| *cause);
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
    /// The fields the report, the warning and the stall table carry, named by `SUMMARY_FIELDS`.
    pub fn json(&self) -> Value {
        json!({
            "rootTriangles": self.root_triangles,
            "cause": self.cause.map(StallCause::name),
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
    solved_vertices: usize,
    quality: &[crate::dag::quality::LevelQuality],
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
    let mut levels = compiler_primitive_warn::level_report(dag, shape.depth);
    for row in &mut levels {
        let level = row["level"].as_u64().unwrap_or(0) as usize;
        if let Some(q) = quality.iter().find(|q| q.level == level) {
            row["normalDeviationMax"] = json!(q.normal_deviation);
        }
    }
    let warnings = compiler_primitive_warn::dag_warnings(strategy, &shape, tallies, &summary);
    let mut report = json!({
        "depth": shape.depth,
        "clusterTriangles": crate::dag::DAG_CLUSTER_TRIANGLES,
        "groupMin": crate::dag::DAG_GROUP_MIN,
        "groupMax": crate::dag::DAG_GROUP_MAX,
        "levels": levels,
        "groups": groups,
        "warnings": warnings,
        "stalls": stalls.iter().map(DagStall::json).collect::<Vec<_>>(),
    });
    merge(&mut report, summary.json());
    // The vertices the solve of a seam-locked group placed after the source's (`dag::Grown`).
    report["solvedVertices"] = json!(solved_vertices);
    (report, warnings)
}

/// Rows of the scene's stall table: enough to name where a cook stalls, short enough to read.
const WORST: usize = 10;

/// The scene's stall table, written once in the manifest head (`worstStalls`) and read as is by
/// the CLI and the bench: the `WORST` primitives with a stalled group that left the most level-0
/// triangles as roots, worst first, ties in manifest order, each row the
/// primitive's manifest `index` and its stall summary. A primitive whose stalls left no
/// level-0 root — its coarsest group alone stalled, above a climbed DAG — is not listed: its
/// stalls stay in its own report.
pub(super) fn worst_stalls(primitives: &[Value]) -> Value {
    let roots = |p: &Value| p["dag"]["rootTriangles"].as_u64().unwrap_or(0);
    let mut stalled: Vec<(usize, &Value)> = primitives
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            p["dag"]["stalls"].as_array().is_some_and(|s| !s.is_empty()) && roots(p) > 0
        })
        .collect();
    stalled.sort_by_key(|(_, p)| std::cmp::Reverse(roots(p)));
    stalled
        .iter()
        .take(WORST)
        .map(|&(index, p)| {
            let mut row = json!({"index":index,"mesh":p["mesh"],"primitive":p["primitive"]});
            let summary = SUMMARY_FIELDS.map(|f| (f.to_string(), p["dag"][f].clone()));
            merge(&mut row, Value::Object(summary.into_iter().collect()));
            row
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Behaviour: only primitives with a stalled group that kept level-0 roots are listed, worst
    // first, at most `WORST`; a stall of the coarsest group alone (no level-0 root) is not.
    #[test]
    fn the_table_ranks_level0_roots_and_skips_coarsest_group_stalls() {
        let primitive = |mesh: usize, roots: usize, stalls: usize| {
            json!({"mesh":mesh,"primitive":0,"dag":{"rootTriangles":roots,"cause":"seam-locked",
                "stalls":vec![json!({}); stalls]}})
        };
        let mut primitives = vec![primitive(0, 5_000, 0), primitive(1, 0, 1)];
        primitives.extend((2..14).map(|mesh| primitive(mesh, 100 * mesh, 2)));
        let table = worst_stalls(&primitives);
        let rows = table.as_array().expect("rows");
        assert_eq!(rows.len(), WORST);
        assert_eq!(rows[0]["mesh"], 13);
        assert_eq!(rows[0]["index"], 13);
        assert_eq!(rows[0]["cause"], "seam-locked");
        assert!(rows.iter().all(|r| r["mesh"] != 0 && r["mesh"] != 1));
        assert_eq!(worst_stalls(&[primitive(1, 0, 1)]), json!([]));
    }

    // Behaviour: a table row carries every key of the summary the report writes, and no other.
    #[test]
    fn the_table_row_keys_are_the_summary_keys() {
        let summary = StallSummary::of(&[], &[]).json();
        let mut keys: Vec<&str> = summary
            .as_object()
            .expect("summary")
            .keys()
            .map(String::as_str)
            .collect();
        let mut fields = SUMMARY_FIELDS.to_vec();
        keys.sort_unstable();
        fields.sort_unstable();
        assert_eq!(keys, fields);
    }
}
