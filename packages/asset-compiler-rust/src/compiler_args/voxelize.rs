//! A job's voxelized objects as the compiler reads them (`resolveVoxelize` writes them): the source
//! meshes whose DAG's coarse levels may be bricks of voxels (`voxel::ShapePreservation`). A mesh
//! is voxelized, the first that names it:
//! 1. by the `voxelize` match — the meshes of every object it matches;
//! 2. by the HLOD: the meshes of every object whose layer's chain voxelizes its cells (a `voxel`
//!    layer above it — the simple form's `foliage` group);
//! 3. by its own `extras`' `shapePreservation: "voxelize"` (`VOXELIZE_EXTRA`).
//!
//! A job naming no `voxelize` compiles as before, its cache key unchanged. Read and checked here
//! once; what does not read is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`),
//! never the batch's.
use super::name_match::{present, NameMatch, NodeNames};
use super::*;
use crate::voxel::ShapePreservation;

/// A job's `voxelize` match, none for none, and what named it, its cache identity.
#[derive(Clone, Debug, Default)]
pub struct VoxelizeOptions {
    matcher: Option<NameMatch>,
    identity: Option<Value>,
}

impl VoxelizeOptions {
    /// The match the job's `voxelize` field names, none for none; `Err` with the job's refusal
    /// when it does not read.
    pub fn read(value: Option<&Value>) -> std::result::Result<Self, String> {
        let Some(value) = present(value) else {
            return Ok(Self::default());
        };
        let matcher = NameMatch::option(value, VOXELIZE_FIELD).map_err(|e| e.message)?;
        Ok(Self {
            matcher: Some(matcher),
            identity: Some(value.clone()),
        })
    }

    /// What named the match, for the cache key: `None` when the job names none.
    pub fn identity(&self) -> Option<&Value> {
        self.identity.as_ref()
    }

    /// The source meshes of `g` drawn as voxels far away, by the precedence the module states:
    /// `hlod`'s assignment read as every stage reads it (`Hlod::assigned`).
    pub fn meshes(&self, g: &Value, hlod: &Hlod) -> Result<BTreeSet<usize>> {
        let mut out = BTreeSet::new();
        let nodes = g.get("nodes").and_then(Value::as_array).map_or(0, Vec::len);
        for node in 0..nodes {
            let Some(mesh) = g
                .pointer(&format!("/nodes/{node}/mesh"))
                .and_then(Value::as_u64)
            else {
                continue;
            };
            let matched = (self.matcher.as_ref())
                .is_some_and(|matcher| matcher.matches(&NodeNames::of(g, node)));
            if matched || hlod.voxelizes(hlod.assigned(g, node)?.layer) {
                out.insert(mesh as usize);
            }
        }
        let meshes = g.get("meshes").and_then(Value::as_array);
        for (rank, mesh) in meshes.into_iter().flatten().enumerate() {
            if ShapePreservation::of(mesh) == ShapePreservation::Voxelize {
                out.insert(rank);
            }
        }
        Ok(out)
    }
}
