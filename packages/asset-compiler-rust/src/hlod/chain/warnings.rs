//! What the world stage tells of how the job's objects were assigned to the layers (`stage_world_roots`).
use crate::compiler::tables::partition::CellMembers;
use crate::*;

/// What the job tells of how its objects were assigned: each layer that lost its parent
/// (`Hlod::chains`), each object whose mark won over a rule
/// naming another layer, each node marked that no HLOD takes, each object its settings make an
/// instanced skinned one that stays a plain skinned one, and each batch root whose `runtimeGrid` no
/// streaming grid bears: told, never an error.
pub(super) fn assignment_warnings(
    cells: &CellMembers,
    hlod: &crate::Hlod,
    nodes: &[Value],
) -> Vec<String> {
    let name = |node: usize| {
        nodes
            .get(node)
            .and_then(|n| n["name"].as_str())
            .unwrap_or("")
    };
    let overruled = cells.overruled.iter().map(|&(node, layer, ruled)| {
        format!(
            "node {node} {}: its mark puts it in {}, over the rule naming {}",
            name(node),
            hlod.layers[layer].name,
            hlod.layers[ruled].name
        )
    });
    let unplaced = (cells.unplaced.iter()).map(|&node| {
        format!(
            "node {node} {}: marked, but no HLOD takes it — it moves, itself or through a node \
             above it, or is not spatially loaded, a parent, hidden, held whole by no cell below a \
             grid's top, or turned away by its layer's size filter",
            name(node)
        )
    });
    let banks = (cells.bank_warnings.iter()).map(|(node, why)| {
        format!(
            "node {node} {}: not an instanced skinned object — {why} —: its host's clips move it",
            name(*node)
        )
    });
    let grids = (cells.unknown_grids.iter()).map(|(node, grid)| {
        format!(
            "node {node} {}: its runtimeGrid {grid:?} is no streaming grid of the job: it streams \
             on the first grid",
            name(*node)
        )
    });
    (hlod.dropped.iter().cloned())
        .chain(overruled)
        .chain(unplaced)
        .chain(banks)
        .chain(grids)
        .collect()
}
