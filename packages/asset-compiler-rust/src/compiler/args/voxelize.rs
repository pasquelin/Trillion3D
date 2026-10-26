//! A job's voxelized objects as the compiler reads them (`resolveVoxelize` writes them): the source
//! meshes whose DAG's coarse levels may be bricks of voxels (`voxel::ShapePreservation`). A mesh
//! is voxelized, the first that names it:
//! 1. by the `voxelize` match — the meshes of every object it matches;
//! 2. by the HLOD: the meshes of every object whose layer's chain voxelizes its cells (a `voxel`
//!    layer, its own or one above it);
//! 3. by its own `extras`' `shapePreservation: "voxelize"` (`VOXELIZE_EXTRA`).
//!
//! A mesh drawn as a part of an assembly (`source/assembly/parts.rs`) is voxelized where its
//! assembly is, whatever names it.
//!
//! A job naming no `voxelize` compiles as before, its cache key unchanged. Read and checked here
//! once; what does not read is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`),
//! never the batch's.
use super::name_match::{present, NameMatch, NodeNames};
use super::*;
use crate::compiler::source::assembly::parts::inherit_voxelized;
use crate::hlod::options::Assigned;
use crate::voxel::ShapePreservation;

/// A job's `voxelize` match, none for none, and what named it, its cache identity.
#[derive(Clone, Debug, Default)]
pub struct VoxelizeOptions {
    pub(crate) matcher: Option<NameMatch>,
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
    /// `hlod`'s assignment of each node, `assignments`, read as every stage reads it
    /// (`Hlod::assignments`).
    pub fn meshes(
        &self,
        g: &Value,
        hlod: &Hlod,
        assignments: &[Assigned],
    ) -> Result<BTreeSet<usize>> {
        let mut out = BTreeSet::new();
        let nodes = g.get("nodes").and_then(Value::as_array);
        for (node, declared) in nodes.into_iter().flatten().enumerate() {
            let Some(mesh) = declared.get("mesh").and_then(Value::as_u64) else {
                continue;
            };
            let matched = (self.matcher.as_ref())
                .is_some_and(|matcher| matcher.matches(&NodeNames::of(g, node)));
            if matched || hlod.voxelizes(assignments[node].layer) {
                out.insert(mesh as usize);
            }
        }
        let meshes = g.get("meshes").and_then(Value::as_array);
        for (rank, mesh) in meshes.into_iter().flatten().enumerate() {
            if ShapePreservation::of(mesh)? == ShapePreservation::Voxelize {
                out.insert(rank);
            }
        }
        inherit_voxelized(meshes.map_or(&[][..], Vec::as_slice), &mut out);
        Ok(out)
    }
}
