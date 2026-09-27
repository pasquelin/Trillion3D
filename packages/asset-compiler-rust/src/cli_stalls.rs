//! The scene's stall table, told on stderr at the end of a cook. stderr carries one JSON event per
//! line — hosts parse every line — so the table is one `stall` event per row, in the order the
//! compiler ranked it once in the manifest (`worstStalls`). stdout is not touched.
use super::emit;
use serde_json::Value;

/// Emits the `stall` events of a finished job, in batch mode as for a single job.
pub(super) fn emit_worst(result: &Value, job: &str) {
    let rows = result["worstStalls"].as_array().into_iter().flatten();
    for (rank, row) in rows.enumerate() {
        let mut event = row.clone();
        event["event"] = "stall".into();
        event["rank"] = (rank + 1).into();
        emit(event, job);
    }
}
