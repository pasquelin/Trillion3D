//! A job's HLOD as the compiler reads it (`HlodWire`, `compilerAbi.ts`, which `resolveHlod` writes
//! from either form a host names): HLOD layers — each a builder, its settings, the grid its actors
//! stream on, or none for actors always loaded, and the layer its cells' actors are built by — and
//! how each placed
//! object is assigned to one layer at most, once (`Hlod::assigned`): the mark its node's `extras`
//! carries (`HLOD_MARK`, a layer's name or a word `marks` gives one), else the first rule that
//! matches it, else the default layer if one is named. An object none names has no layer: it
//! enters no HLOD actor, streamed in its cell and drawn while loaded, nothing standing for it
//! beyond — as one whose `extras` say `hlodInclude: false` (`HLOD_INCLUDE_MARK`), whatever a
//! mark, a rule or the default would give it. A job naming no HLOD builds none.
//!
//! Read and checked here in one pass — names and parents resolved, each builder's settings
//! admitted and defaulted, patterns compiled, the layers formed into chains —; what does not read
//! is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`), never the batch's.
//! Reading the layers and marks lives in `parse`, the chains and assignment in `chains`.
use crate::compiler::args::name_match::NameMatch;
use crate::compiler::args::*;
use crate::*;
mod approximation;
mod chains;
mod fields;
mod instancing;
mod merging;
mod meshes;
mod parse;
mod simplifying;
mod translucency;
pub use approximation::{
    HlodApproximation, HlodAtlasSizing, HlodBaseCapping, HlodBiasFloors, HlodCapture,
    HlodEmptyTexels, HlodGroundClipping, HlodMapSides, HlodOcclusion, HlodPatches,
    HlodSimplification, HlodUvMethod, APPROXIMATION_FLOORS, MERGE_FLOORS,
};
pub use instancing::HlodSizeFilter;
pub use merging::{HlodMerging, HlodTextureSizing};
pub use meshes::HlodMeshBuild;
pub use parse::{included, instanced, marked};
pub use simplifying::{HlodNormalMethod, HlodSimplifying, HlodTransferRays};
pub use translucency::HlodTranslucency;

/// How a layer builds its actors, in `HLOD_BUILDERS` order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodBuilder {
    /// The objects themselves, instanced: at HLOD 0 their own cell rows, above it each their
    /// source mesh placed, drawn by the cut of its own cluster DAG. A layer asking for no cluster
    /// DAG (`clusterDag` false) is read as a `merge` layer (`options/parse.rs`, `layer`).
    Instanced,
    /// One closed shell per cell wearing a flattened material.
    Approximate,
    /// The cell's objects merged into one mesh.
    Merge,
    /// The cell's objects voxelized together: levels of bricks, no shell, no atlas.
    Voxel,
    /// The cell's objects remeshed through their volume, simplified for the distance the actor is
    /// first drawn from, wearing their materials transferred onto one atlas
    /// (`flatten/simplify.rs`).
    Simplify,
}

impl HlodBuilder {
    const ALL: [Self; 5] = [
        Self::Instanced,
        Self::Approximate,
        Self::Merge,
        Self::Voxel,
        Self::Simplify,
    ];

    /// Its word (`HLOD_BUILDERS`).
    pub fn name(self) -> &'static str {
        HLOD_BUILDERS[self as usize]
    }

    /// The settings a layer of it may name beside its name, builder and parent: an instanced layer
    /// its size filter (`options/instancing.rs`); an approximated layer its voxel and deviation,
    /// metres, its atlas's side and sizing (`textureSizing`, `options/approximation/sizing.rs`)
    /// and the rest of its steps' settings (`approximation`, `options/approximation.rs`); a merged layer its LOD of each source and the screen size it
    /// is taken at — its merged mesh never simplified —, whether equivalent materials collapse,
    /// whether it merges its materials and, keeping them, whether its mesh keeps its sources'
    /// vertex colours, merging them, its atlas, sized, gridded and baked as it names, on the
    /// texture coordinates it names (`options/merging.rs`); a simplified layer its method's
    /// settings (`simplification`) and its atlas, sized, guttered and baked as a merged layer's,
    /// whether it bakes identical meshes once, carries the sources' vertex colours and reuses
    /// their lightmap coordinates (`options/simplifying.rs`). A layer that builds a mesh names
    /// whether that mesh gets a cluster DAG (`clusterDag`) — an instanced layer too: its objects
    /// then keep their own DAG, or, asking for none, are drawn at the last LOD of their meshes
    /// (`parse::layer`) — and, baking an atlas, how a translucent source shows in it
    /// (`translucency`, `options/translucency.rs`); an approximated or simplified layer, what its
    /// atlas holds where it holds no chart's value (`emptyTexels`); a merged or simplified layer,
    /// how its actors' meshes are built (`meshBuild`, `options/meshes.rs`), as the reference reads
    /// it from those layers alone. A voxel layer names that alone, how its voxels are sampled:
    /// they are as fine as the cut's pixel error asks where each level is drawn, its levels its
    /// bricks'.
    fn settings(self) -> &'static [&'static str] {
        match self {
            Self::Instanced => &[
                "sizeFilter",
                "minExtent",
                "minArea",
                "minVolume",
                "clusterDag",
            ],
            Self::Voxel => &["meshBuild"],
            Self::Approximate => &[
                "accuracy",
                "deviation",
                "textureSize",
                "textureSizing",
                "texelsPerMetre",
                "atlasScreenSize",
                "mapSizes",
                "approximation",
                "clusterDag",
                "translucency",
                "emptyTexels",
            ],
            Self::Merge => &[
                "lodSelection",
                "lodScreenSize",
                "collapseEquivalentMaterials",
                "mergeMaterials",
                "bakeVertexColors",
                "textureSize",
                "textureSizing",
                "texelsPerMetre",
                "atlasScreenSize",
                "mapSizes",
                "atlasGutter",
                "binByTextureSize",
                "bakeOnMesh",
                "reuseLightmapUVs",
                "uvMethod",
                "allowDoubleSided",
                "maps",
                "translucency",
                "clusterDag",
                "meshBuild",
            ],
            Self::Simplify => &[
                "simplification",
                "textureSize",
                "textureSizing",
                "texelsPerMetre",
                "atlasScreenSize",
                "mapSizes",
                "atlasGutter",
                "allowDoubleSided",
                "maps",
                "reuseLightmapUVs",
                "groupIdenticalMeshes",
                "allowVertexColors",
                "translucency",
                "emptyTexels",
                "clusterDag",
                "meshBuild",
            ],
        }
    }
}

/// Which LOD of each source a merged layer takes (`lodSelection`, `HLOD_LOD_SELECTIONS` order).
/// A choice naming one of a mesh's discrete LODs has no meaning here: a DAG has none.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum HlodLodSelection {
    /// The LOD the source shows when its bounding sphere spans the layer's `lodScreenSize` of the
    /// view (`'calculate'`, the default).
    #[default]
    Calculate,
    /// The source's fallback mesh (`'lowest'`), made as `flatten::merge::fallback` makes it, by
    /// its `RELATIVE_ERROR`, `AT_LEAST`, `OVERSHOOT` and `LIMIT`.
    Lowest,
}

impl HlodLodSelection {
    const ALL: [Self; 2] = [Self::Calculate, Self::Lowest];

    /// Its word (`HLOD_LOD_SELECTIONS`).
    pub fn name(self) -> &'static str {
        HLOD_LOD_SELECTIONS[self as usize]
    }
}

/// One layer: its name, builder, parent's rank, and its builder's settings, the voxel and the
/// deviation their builder's default when `None` (`hlod::flatten::layer_settings`), the others
/// their defaults resolved.
#[derive(Clone, Debug)]
pub struct HlodLayer {
    pub name: String,
    pub builder: HlodBuilder,
    pub parent: Option<usize>,
    /// An approximated layer's voxel, metres, `DEFAULT_HLOD_ACCURACY` when it names none.
    pub accuracy: Option<f64>,
    /// An approximated layer's deviation, metres, `DEFAULT_HLOD_DEVIATION` when it names none.
    pub deviation: Option<f64>,
    /// Its atlas side, `DEFAULT_HLOD_TEXTURE_SIZE` when it names none: a merged layer's when its
    /// atlas is sized `fixed` (`HlodMerging::sizing`).
    pub texture_size: usize,
    /// An approximated layer's other settings (`approximation`), each defaulted.
    pub approximation: HlodApproximation,
    /// A merged layer's LOD of each source (`lodSelection`); `Lowest` for an instanced layer
    /// asking for no cluster DAG, read as a merged layer (`parse::layer`).
    pub lod_selection: HlodLodSelection,
    /// Whether a merged layer merges its materials into one atlas (`mergeMaterials`, false by
    /// default).
    pub merge_materials: bool,
    /// A merged layer's other settings (`options/merging.rs`), each defaulted.
    pub merging: HlodMerging,
    /// An instanced layer's size filter (`sizeFilter`), none by default.
    pub size_filter: HlodSizeFilter,
    /// A simplified layer's settings (`options/simplifying.rs`), each defaulted.
    pub simplifying: HlodSimplifying,
    /// Whether the mesh of each actor it builds — approximated or merged — gets a cluster DAG, its
    /// coarser levels drawn by the cut within the pixel error (`clusterDag`, true by default);
    /// not, the mesh alone, one level drawn whole at every distance. An instanced layer builds no
    /// mesh while it is true: its objects keep their own DAG; false, it is a merged layer taking
    /// each object's fallback (`parse::layer`).
    pub cluster_dag: bool,
    /// How the mesh of each actor it builds is built, and the root pages its cell holds
    /// (`meshBuild`, `options/meshes.rs`): a merged or simplified layer's as it names it, every
    /// other's the defaults.
    pub mesh_build: HlodMeshBuild,
    /// Whether the actors it builds stream on a grid of their own (`spatiallyLoaded`, true by
    /// default); not, they are always loaded and nothing is built of them — the parent it names is
    /// let go (`Hlod::chains`) —: its chain's top.
    pub spatially_loaded: bool,
    /// Its grid's cell side and loading range, metres (`cellSize`, `loadingRange`),
    /// `DEFAULT_HLOD_CELL_SIZE` and `DEFAULT_HLOD_LOADING_RANGE` when it names none: the actors
    /// it builds lie on the grid of its level (`Hlod::levels`), cell and range
    /// (`hlod::cells::Grids`).
    pub cell_size: f64,
    pub loading_range: f64,
}

/// A rule: what it matches and the rank of the layer it assigns.
#[derive(Clone, Debug)]
pub struct HlodAssign {
    pub matcher: NameMatch,
    pub layer: usize,
}

/// A job's HLOD: its layers — none for a job naming no HLOD —, its rules, the rank of the layer of
/// an object no rule matches, if any, the layer each mark word names beside the layers' own names,
/// and what named it, its cache identity. The default is a job naming no HLOD.
#[derive(Clone, Debug, Default)]
pub struct Hlod {
    pub layers: Vec<HlodLayer>,
    pub assign: Vec<HlodAssign>,
    pub default: Option<usize>,
    marks: Vec<(String, usize)>,
    pub named: Value,
}

/// One object's assignment (`Hlod::assigned`): its layer, if any, and, where its mark won over a
/// rule naming another layer, that rule's layer — the compile's warning.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Assigned {
    pub layer: Option<usize>,
    pub overruled: Option<usize>,
}

/// The fields a layer names whatever its builder, a rule and the HLOD.
const LAYER_FIELDS: [&str; 6] = [
    "name",
    "builder",
    "parent",
    "spatiallyLoaded",
    "cellSize",
    "loadingRange",
];
const ASSIGN_FIELDS: [&str; 2] = ["match", "layer"];
const HLOD_FIELDS: [&str; 4] = ["layers", "assign", "default", "marks"];
