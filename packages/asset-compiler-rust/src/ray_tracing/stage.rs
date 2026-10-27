//! The ray-tracing stage: the tree of every compiled primitive is built with its DAG
//! (`primitive_tree`) and the world's with the HLOD actors' (`world_trees`); once they are in hand,
//! all are written in one product, `rayTracing.bin`, the world's last, which the manifest's
//! `rayTracing` section names (`write_ray_tracing`). A scene none of whose primitives nor actors has
//! a triangle writes neither.
use super::abi::RAY_TRACING_FILE;
use super::encode::{encode, report};
use super::tree::PrimitiveTree;
use super::world::WorldTrees;
use crate::compiler::cache::storage::{product, Product};
use crate::Result;
use serde_json::{json, Value};
use std::path::Path;

/// Writes the trees of the primitives, then the world's, as `rayTracing.bin` in `directory`;
/// returns its product and the manifest's `rayTracing` section, none when there is no tree.
pub(crate) fn write_ray_tracing(
    (trees, world): (&[Option<PrimitiveTree>], Option<&WorldTrees>),
    directory: &Path,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Option<(Product, Value)>> {
    let held: Vec<&PrimitiveTree> = (trees.iter().flatten())
        .chain(world.into_iter().flat_map(WorldTrees::in_file_order))
        .collect();
    if held.is_empty() {
        return Ok(None);
    }
    let bytes = encode(&held)?;
    let written = product(directory, RAY_TRACING_FILE, &bytes)?;
    progress(json!({"phase":"rayTracing","completed":1,"total":1,"records":held.len()}));
    Ok(Some((written, report(bytes.len()))))
}
