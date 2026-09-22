//! The primitives whose DAG stalled worst, told on stderr at the end of a cook. stderr carries one
//! JSON event per line — hosts parse every line — so the table is one `stall` event per row,
//! ranked by the level-0 triangles each primitive left as roots. stdout is not touched.
use super::emit;
use serde_json::{json, Value};

/// Rows told per job: enough to name where a cook stalls, short enough to read in a terminal.
const WORST: usize = 10;

/// One `stall` event per primitive among the `WORST` that left the most level-0 triangles as
/// roots, over the primitives with at least one stalled group, worst first.
fn rows(result: &Value) -> Vec<Value> {
    let mut stalled: Vec<&Value> = result["primitives"]
        .as_array()
        .map(|primitives| {
            primitives
                .iter()
                .filter(|p| p["dag"]["stalls"].as_array().is_some_and(|s| !s.is_empty()))
                .collect()
        })
        .unwrap_or_default();
    let roots = |p: &Value| p["dag"]["rootTriangles"].as_u64().unwrap_or(0);
    stalled.sort_by_key(|p| std::cmp::Reverse(roots(p)));
    stalled
        .iter()
        .take(WORST)
        .enumerate()
        .map(|(rank, p)| {
            let dag = &p["dag"];
            json!({"event":"stall","rank":rank + 1,"mesh":p["mesh"],"primitive":p["primitive"],
             "rootTriangles":dag["rootTriangles"],"cause":dag["cause"],"seamVertices":dag["seamVertices"],
             "lockedVertices":dag["lockedVertices"],"uvIslands":dag["uvIslands"]})
        })
        .collect()
}

/// Emits the `stall` events of a finished job, in batch mode as for a single job.
pub(super) fn emit_worst(result: &Value, job: &str) {
    for row in rows(result) {
        emit(row, job);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Behaviour: only primitives with a stalled group are told, worst first, at most `WORST`.
    #[test]
    fn stalls_are_ranked_by_the_triangles_left_as_roots() {
        let primitive = |mesh: usize, roots: usize, stalls: usize| {
            json!({"mesh":mesh,"primitive":0,"dag":{"rootTriangles":roots,"cause":"seam-locked",
                "stalls":vec![json!({}); stalls]}})
        };
        let mut primitives = vec![primitive(0, 5_000, 0), primitive(1, 40, 1)];
        primitives.extend((2..14).map(|mesh| primitive(mesh, 100 * mesh, 2)));
        let rows = rows(&json!({ "primitives": primitives }));
        assert_eq!(rows.len(), WORST);
        assert_eq!(rows[0]["mesh"], 13);
        assert_eq!(rows[0]["rank"], 1);
        assert_eq!(rows[0]["event"], "stall");
        assert_eq!(rows[0]["cause"], "seam-locked");
        assert!(rows.iter().all(|r| r["mesh"] != 0 && r["mesh"] != 1));
    }
}
