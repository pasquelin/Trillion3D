//! How one mesh keeps its shape as its DAG is built (`MeshShaping`): read from its glTF `extras`
//! and from the job — its shape preservation, the bound on the edges its simplification makes,
//! whether its texture coordinates are held —, the job's `meshBuild` adding what its finest level
//! keeps and whether its near-collapsed triangles are dropped — or, for an HLOD actor's mesh, its
//! layer's `meshBuild` all of them (`hlod/options/meshes.rs`) —; and the rules every solve of its
//! groups keeps that follow from them (`MeshShaping::rules`).
use super::{InputRules, Trim};
use crate::compiler::validate::OPTIONS;
use crate::shared_math::abi::{
    DEFAULT_EDGE_LENGTH_BOUND, DEFAULT_HOLD_TEXTURE, EDGE_LENGTH_SETTING, HOLD_TEXTURE_SETTING,
};
use crate::simplify::SolveRules;
use crate::Result;
use serde_json::{Map, Value};

/// How a mesh keeps its shape as its DAG is built, as its glTF `extras` and the job name it: its
/// shape preservation — voxels far away when the job voxelizes it (`VoxelizeOptions::meshes`),
/// else its `shapePreservation` extra (`voxel::ShapePreservation::of`), none by default —, its
/// edge length bound (`EDGE_LENGTH_SETTING`, `SolveRules::edge_length_bound`: in units of the mean
/// triangle's frame, `simplify/region.rs`), zero — nothing bounded — by default, whether its
/// texture coordinates are held as they are (`HOLD_TEXTURE_SETTING`, `SolveRules::hold_texture`),
/// not by default; and, as the job's `meshBuild` resolves them (`MeshBuildOptions::meshes`), what
/// its finest level keeps (`Trim`), all by default, whether its near-collapsed triangles are
/// dropped (`DagSettings::drop_near_collapsed`), not by default, and how its source is read
/// (`InputRules`). Every default is the reference's.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MeshShaping {
    pub shape: crate::voxel::ShapePreservation,
    pub edge_length_bound: f32,
    pub hold_texture: bool,
    pub trim: Trim,
    pub drop_near_collapsed: bool,
    pub input: InputRules,
}
impl Default for MeshShaping {
    fn default() -> Self {
        Self {
            shape: Default::default(),
            edge_length_bound: DEFAULT_EDGE_LENGTH_BOUND as f32,
            hold_texture: DEFAULT_HOLD_TEXTURE,
            trim: Trim::default(),
            drop_near_collapsed: crate::DEFAULT_DROP_NEAR_COLLAPSED,
            input: InputRules::default(),
        }
    }
}
impl MeshShaping {
    /// The shaping of glTF mesh `mesh` its `extras` name, `voxelized` when the job draws it as
    /// voxels far away, the rest at its defaults; a shape preservation that is not one of its
    /// words (`voxel::ShapePreservation::of`), a bound that is not a finite number of at least
    /// zero, or a hold that is not a boolean, is the job's refusal (`INVALID_OPTIONS`).
    pub fn read(mesh: &Value, voxelized: bool) -> Result<Self> {
        let shape = match voxelized {
            true => crate::voxel::ShapePreservation::Voxelize,
            false => crate::voxel::ShapePreservation::of(mesh)?,
        };
        let extras = mesh.get("extras").and_then(Value::as_object);
        Ok(Self {
            shape,
            ..Self::named(extras, "A mesh's extras.")?
        })
    }

    /// The edge length bound and the texture hold `map` names — a mesh's `extras`, an HLOD layer's
    /// `meshBuild` —, `what` prefixing a key in a refusal, the rest at their defaults; a bound that
    /// is not a finite number of at least zero, or a hold that is not a boolean, is the job's
    /// refusal (`INVALID_OPTIONS`).
    pub(crate) fn named(map: Option<&Map<String, Value>>, what: &str) -> Result<Self> {
        let named = |key: &str| {
            map.and_then(|m| m.get(key))
                .filter(|value| !value.is_null())
        };
        let edge_length_bound = match named(EDGE_LENGTH_SETTING) {
            None => DEFAULT_EDGE_LENGTH_BOUND as f32,
            Some(value) => {
                let key = format!("{what}{EDGE_LENGTH_SETTING}");
                OPTIONS.bounded(value, &key, (0.0, f64::INFINITY), "a number of at least 0")? as f32
            }
        };
        let hold_texture = match named(HOLD_TEXTURE_SETTING) {
            None => DEFAULT_HOLD_TEXTURE,
            Some(value) => {
                OPTIONS.boolean(Some(value), &format!("{what}{HOLD_TEXTURE_SETTING}"))?
            }
        };
        Ok(Self {
            edge_length_bound,
            hold_texture,
            ..Self::default()
        })
    }
    /// The rules every solve of the mesh's groups keeps: its edge length bound, the area kept when
    /// its shape preservation keeps it, and its texture coordinates held when it holds them.
    pub fn rules(&self) -> SolveRules {
        SolveRules {
            edge_length_bound: self.edge_length_bound,
            keep_area: self.shape == crate::voxel::ShapePreservation::Area,
            hold_texture: self.hold_texture,
        }
    }
}
