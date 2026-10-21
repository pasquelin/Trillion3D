//! What a cook checks on a finished DAG before it publishes it (`check`): its error never drops
//! from a cluster to its parent, the nesting a runtime cut relies on.
use crate::dag::DagCluster;
use crate::{CompilerError, Result};

/// Refuses a DAG whose error drops from a cluster to the group replacing it — a runtime cut would
/// then draw both or neither. A reduction's error is never below its children's (`solved.rs`), so
/// a sound build never meets it; nothing else is refused.
pub fn check(dag: &[DagCluster]) -> Result<()> {
    match dag.iter().find(|c| c.parent_error < c.lod_error) {
        Some(c) => Err(CompilerError::new(
            "DAG_ERROR_NOT_MONOTONE",
            format!(
                "A level {} cluster has error {} above its parent's {}",
                c.level, c.lod_error, c.parent_error
            ),
        )),
        None => Ok(()),
    }
}
