//! The objects standing as themselves in an HLOD actor — every object a cell of an instanced
//! layer's builder takes (an instanced layer's own HLOD 0 is its source meshes, the placed
//! objects' pages, with no actor of its own), one keeping its cluster DAG (`disallowClusterDag`
//! makes it a merged layer, which builds the fallback of each object, `options/layer.rs`), those
//! marked `hlodInstance` in any other layer's (`HLOD_INSTANCE_MARK`) —: nothing is built of them. The actor names each one's source mesh and
//! world matrix (`ActorRow`), a row the runtime places on that mesh's rows as a cell file's node,
//! its own pages instanced, and draws while its cell draws the actor. Each cell's rows are one
//! bundle of the binary its cell holds with its actor's root pages (`lay_rows`): they stream with
//! the actor, never whole.
use super::*;
use crate::compiler::pages::bundles::Bundle;
use crate::compiler::source::node_transform::Mat4;
use crate::hlod::chain::records::{index, nullable};
use crate::HlodBuilder;

/// One object standing as itself in an actor: its mesh, by its published rank, and its world
/// matrix — an instanced skinned object's its skin frame's, with the item of the animation banks
/// it plays (`track`).
#[derive(Clone, Copy, Debug)]
pub(crate) struct ActorRow {
    pub mesh: u64,
    pub matrix: Mat4,
    pub track: Option<usize>,
}

/// Each HLOD cell's rows, by its rank in the chain: none for a cell whose actor builds every
/// object.
pub(crate) type ActorRows = Vec<Vec<ActorRow>>;

/// A cell's objects `members` as its layer's `builder` takes them — every one but those that stand
/// as themselves in every actor their chain builds (`Instance::instanced`); none of an instanced
/// layer's, each standing as itself — and those, apart.
pub(super) fn split(
    instances: &[Instance],
    members: &[usize],
    builder: HlodBuilder,
) -> (Vec<usize>, Vec<usize>) {
    if builder == HlodBuilder::Instanced {
        return (Vec::new(), members.to_vec());
    }
    members
        .iter()
        .copied()
        .partition(|&i| !instances[i].instanced)
}

/// The rows of the objects `standing` of `instances`: one per object — its primitives share it —,
/// in the order of their nodes. Each stands on its fallback mesh where it has one when the actor's
/// layer disallows the cluster DAG (`fallback`), on its source mesh otherwise.
pub(super) fn actor_rows(
    instances: &[Instance],
    standing: &[usize],
    fallback: bool,
) -> Vec<ActorRow> {
    let by_node: BTreeMap<usize, ActorRow> = (standing.iter())
        .map(|&i| {
            let Instance {
                node,
                mesh,
                matrix,
                track,
                fallback: on,
                ..
            } = instances[i];
            let mesh = on.filter(|_| fallback).unwrap_or(mesh);
            (
                node,
                ActorRow {
                    mesh,
                    matrix,
                    track,
                },
            )
        })
        .collect();
    by_node.into_values().collect()
}

/// Bytes a row takes in its cell's rows bundle (`lay_rows`), little-endian: its mesh's published
/// rank and the item of the animation banks it plays (`u32::MAX` for none), as `u32`s, then its
/// world matrix as sixteen `f64`.
pub(crate) const ROW_BYTES: usize = 2 * 4 + 16 * 8;

/// Each cell's rows laid after the world's pages in `payload`, one bundle of no page per cell
/// placing rows, pushed on `bundles` and held by its cell with its actor's root pages (`hlod`): an
/// actor's instances stream with it, as its pages do, and no row is read while its actor is not
/// loaded. Returns each cell's rows bundle, `None` for a cell placing none, and its row count.
pub(in crate::hlod::chain) fn lay_rows(
    rows: &[Vec<ActorRow>],
    (payload, bundles): (&mut Vec<u8>, &mut Vec<Bundle>),
    hlod: &mut [BTreeSet<usize>],
) -> Result<Vec<(Option<usize>, usize)>> {
    let mut laid = Vec::with_capacity(rows.len());
    for (cell, placed) in rows.iter().enumerate() {
        if placed.is_empty() {
            laid.push((None, 0));
            continue;
        }
        let start = payload.len();
        payload.reserve(ROW_BYTES * placed.len());
        for row in placed {
            for word in [index(row.mesh as usize)?, nullable(row.track)?] {
                payload.extend_from_slice(&word.to_le_bytes());
            }
            for value in row.matrix {
                payload.extend_from_slice(&value.to_le_bytes());
            }
        }
        bundles.push(Bundle {
            start,
            bytes: payload.len() - start,
            count: 0,
            dependencies: Vec::new(),
            sha256: digest_bytes(&payload[start..]),
            band: None,
        });
        hlod[cell].insert(bundles.len() - 1);
        laid.push((Some(bundles.len() - 1), placed.len()));
    }
    Ok(laid)
}
