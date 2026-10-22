//! The DAG of an assembly, a primitive laid out in blocks (`compiler/source/assembly/flatten.rs`):
//! the mesh's own triangles, then the triangles of each node's part carried by its transform.
//!
//! The reference builds each part's DAG once, copies its clusters into the assembly once, and gives
//! every node the part's root cluster as an instance reference that enters the assembly's own
//! reduction beside the mesh's own level-0 clusters; the levels above are built over those, each
//! instance's error and bounds taken through its transform. Here each block is built as a DAG of
//! its own, its triangles already carried, so its errors are measured where it stands; the mesh's
//! own block is its level-0 clusters alone, as the reference's mesh enters the reduction. The roots
//! of every block are joined into one DAG and the levels above are built over them, as the
//! reference's are: the same groups and reductions as any DAG's (`levels.rs`), over clusters of any
//! level. A root becomes the child of the first group above it, as an instance's root has that
//! group's error as its parent's.
use super::build::finish;
use super::*;
use climb::{climb, unclimbed};
use serde_json::Value;
use splice::{build_block, Splice};
use trillion3d_page_codec::encode::Attribute;

mod climb;
mod splice;

/// One block of the flat arrays: the vertices and the indices it holds, each a first and a count.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Block {
    pub vertices: (usize, usize),
    pub indices: (usize, usize),
}

/// The blocks of an assembly primitive, in order: the mesh's own triangles when `base`, then one
/// block for each node's part.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AssemblyBlocks {
    pub base: bool,
    pub blocks: Vec<Block>,
}

fn refused(message: impl Into<String>) -> CompilerError {
    CompilerError::new("INVALID_ASSEMBLY", message)
}

impl AssemblyBlocks {
    /// The blocks the extras of primitive `p` name (`extras.assembly`, written by the flat
    /// primitives), `None` for a primitive that names none; refused when they do not lie, in order
    /// and whole triangles, within the `vertices` and the `indices` the primitive holds.
    pub(crate) fn of(p: &Value, vertices: usize, indices: usize) -> Result<Option<Self>> {
        let Some(layout) = p.pointer("/extras/assembly") else {
            return Ok(None);
        };
        let numbers = |value: &Value| -> Option<[usize; 4]> {
            let list = value.as_array()?;
            let at = |k: usize| list.get(k)?.as_u64().map(|n| n as usize);
            Some([at(0)?, at(1)?, at(2)?, at(3)?])
        };
        let listed = layout.get("blocks").and_then(Value::as_array);
        let listed = listed.ok_or_else(|| refused("extras.assembly.blocks is not a list"))?;
        let (mut vertex, mut index) = (0, 0);
        let mut blocks = Vec::with_capacity(listed.len());
        for value in listed {
            let [v0, vn, i0, i_n] = numbers(value)
                .ok_or_else(|| refused("an assembly block is not four whole numbers"))?;
            if v0 < vertex || i0 < index || v0 + vn > vertices || i0 + i_n > indices || i_n % 3 != 0
            {
                return Err(refused(
                    "an assembly block lies outside the primitive's arrays",
                ));
            }
            (vertex, index) = (v0 + vn, i0 + i_n);
            blocks.push(Block {
                vertices: (v0, vn),
                indices: (i0, i_n),
            });
        }
        let base = layout.get("base").and_then(Value::as_bool).unwrap_or(false);
        Ok(Some(Self { base, blocks }))
    }
}

/// The DAG of the primitive whose arrays `blocks` cut, built as the module says, before the
/// encoder's steps are done: every cluster of every block and the levels above their roots. Its
/// arrays are the blocks' and the levels' own (`DagBuild::grown`), never the primitive's.
pub(crate) fn build_assembly(
    positions: &[f32],
    attributes: DagAttributes,
    indices: &[u32],
    blocks: &AssemblyBlocks,
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    let mut built = Vec::with_capacity(blocks.blocks.len());
    for (rank, block) in blocks.blocks.iter().enumerate() {
        checkpoint()?;
        let arrays = (positions, attributes, indices);
        let exact = blocks.base && rank == 0;
        built.extend(build_block(arrays, (block, exact), settings, checkpoint)?);
    }
    if built.is_empty() {
        return Err(CompilerError::new(
            "INVALID_TRIANGLES",
            "Every triangle has two corners at one point",
        ));
    }
    let mut spliced = Splice::of(built, attributes.carried);
    let tallies = std::mem::take(&mut spliced.tallies);
    let stalls = std::mem::take(&mut spliced.stalls);
    let mut build = match settings.strategy {
        DagStrategy::ExactClusters => unclimbed(&mut spliced),
        _ => climb(&mut spliced, settings, checkpoint)?,
    };
    build.tallies = tallies.into_iter().chain(build.tallies).collect();
    build.stalls = stalls.into_iter().chain(build.stalls).collect();
    if build.grown.is_none() {
        let (positions, carried) = (spliced.positions, spliced.carried);
        build.grown = Some(Grown {
            positions,
            carried,
            origin: Vec::new(),
        });
    }
    finish(&mut build, &[]);
    Ok(build)
}
