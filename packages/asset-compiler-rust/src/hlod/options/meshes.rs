//! A merged or simplified layer's `meshBuild` (`HLOD_MESH_BUILD_SETTINGS`, `compilerAbi.ts`): how
//! the mesh of each actor it builds is built — what its finest level keeps and whether its
//! near-collapsed triangles are dropped (`compiler/args/mesh_build.rs`), the size its cell keeps
//! resident while the actor is loaded (`root_page_count`), and how it keeps its shape
//! (`dag::MeshShaping`) —, each setting its default, the reference's, when left out. The reference
//! reads it from those layers alone: an approximated layer's actors are built at every default. A
//! layer naming none builds as one naming every default. The layer's JSON is the cache's identity
//! (`Hlod::named`): a value named changes the key, one left out keeps it.
use super::*;
use crate::compiler::args::mesh_build::mesh_build_of;
use crate::compiler::args::name_match::present;
use crate::compiler::pages::bundles::root_page_count;
use crate::compiler::validate::{Fields, OPTIONS};
use crate::dag::MeshShaping;
use crate::voxel::ShapePreservation;

/// How the mesh of an actor a layer builds is built: its shaping — what its finest level keeps,
/// whether its near-collapsed triangles are dropped, how it keeps its shape — and the root pages
/// its actor's cell holds at least (`root_page_count`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HlodMeshBuild {
    pub(crate) shaping: MeshShaping,
    pub root_pages: usize,
}

impl Default for HlodMeshBuild {
    /// Every setting the reference's default.
    fn default() -> Self {
        Self {
            shaping: MeshShaping::default(),
            root_pages: root_page_count(DEFAULT_ALWAYS_RESIDENT_KIB),
        }
    }
}

/// The shapes `HLOD_SHAPE_PRESERVATIONS` names, in its order.
const SHAPES: [ShapePreservation; HLOD_SHAPE_PRESERVATIONS.len()] =
    [ShapePreservation::None, ShapePreservation::Area];

/// The `meshBuild` layer `map` names, `what` naming the layer: the settings of
/// `HLOD_MESH_BUILD_SETTINGS`, each read and checked — `shapePreservation` a word of
/// `HLOD_SHAPE_PRESERVATIONS` —, any other refused; every default when absent or null.
pub(super) fn mesh_build(map: &Map<String, Value>, what: &str) -> Result<HlodMeshBuild> {
    let Some(named) = present(map.get(MESH_BUILD_FIELD)) else {
        return Ok(HlodMeshBuild::default());
    };
    let what = format!("{what}.{MESH_BUILD_FIELD}");
    let named = OPTIONS.known(named, &HLOD_MESH_BUILD_SETTINGS, &what)?;
    let prefix = format!("{what}.");
    let build = mesh_build_of(named, &prefix)?;
    let key = format!("{prefix}{VOXELIZE_EXTRA}");
    let rank = |word: &str| HLOD_SHAPE_PRESERVATIONS.iter().position(|&w| w == word);
    let shape = match OPTIONS.optional(named.get(VOXELIZE_EXTRA), &key, Fields::text)? {
        None => rank(DEFAULT_SHAPE_PRESERVATION).expect("the default is one of its words"),
        Some(word) => rank(word).ok_or_else(|| {
            let words = HLOD_SHAPE_PRESERVATIONS.join(" or ");
            OPTIONS.bad(format!("{key} must be {words}: voxels are a voxel layer's"))
        })?,
    };
    let shaping = MeshShaping {
        shape: SHAPES[shape],
        trim: build.trim,
        drop_near_collapsed: build.drop_near_collapsed,
        ..MeshShaping::named(Some(named), &prefix)?
    };
    Ok(HlodMeshBuild {
        shaping,
        root_pages: build.root_pages,
    })
}
