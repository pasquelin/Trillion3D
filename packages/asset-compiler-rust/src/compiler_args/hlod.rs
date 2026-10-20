//! A job's HLOD as the compiler reads it (`HlodWire`, `compilerAbi.ts`, which `resolveHlod` writes
//! from either form a host names): HLOD layers — each a builder, its settings and the layer its
//! cells' actors are built by — and how each placed
//! object is assigned to one layer at most, once (`Hlod::assigned`): the mark its node's `extras`
//! carries (`HLOD_MARK`, a layer's name or a word `marks` gives one), else the first rule that
//! matches it, else the default layer if one is named. An object none names has no layer: it
//! enters no HLOD actor, streamed in its cell and drawn while loaded, nothing standing for it
//! beyond. A job naming no HLOD builds none.
//!
//! Read and checked here in one pass — names and parents resolved, each builder's settings
//! admitted and defaulted, patterns compiled, the layers formed into chains —; what does not read
//! is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`), never the batch's.
//! Reading the layers and marks lives in `parse`, the chains and assignment in `chains`.
use super::name_match::NameMatch;
use super::*;
mod chains;
mod parse;
pub use parse::marked;

/// How a layer builds its actors, in `HLOD_BUILDERS` order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodBuilder {
    /// The objects themselves, batched: a layer objects are assigned to.
    Instanced,
    /// One closed shell per cell wearing a flattened material.
    Approximate,
    /// The cell's objects merged into one mesh.
    Merge,
    /// The cell's objects remeshed into one closed surface.
    Proxy,
    /// The cell's objects voxelized together: levels of bricks, no shell, no atlas.
    Voxel,
}

impl HlodBuilder {
    const ALL: [Self; 5] = [
        Self::Instanced,
        Self::Approximate,
        Self::Merge,
        Self::Proxy,
        Self::Voxel,
    ];

    /// Its word (`HLOD_BUILDERS`).
    pub fn name(self) -> &'static str {
        HLOD_BUILDERS[self as usize]
    }

    /// The settings a layer of it may name beside its name, builder and parent: an approximated
    /// layer its voxel, deviation and atlas; a proxy layer its voxel and atlas — its deviation is
    /// its own (`proxy_lod`) —; a merged layer its deviation — the LOD it takes of each source, its
    /// merged mesh never simplified —, its LOD of each source, whether it merges its materials
    /// and, merging them, its atlas. A voxel layer names none: its voxels are as fine as the cut's
    /// pixel error asks where each level is drawn.
    fn settings(self) -> &'static [&'static str] {
        match self {
            Self::Instanced | Self::Voxel => &[],
            Self::Approximate => &[
                "accuracy",
                "accuracyPixels",
                "deviation",
                "deviationPixels",
                "textureSize",
            ],
            Self::Proxy => &["accuracy", "accuracyPixels", "textureSize"],
            Self::Merge => &[
                "deviation",
                "deviationPixels",
                "lodSelection",
                "mergeMaterials",
                "textureSize",
            ],
        }
    }
}

/// Which LOD of each source a merged layer takes (`lodSelection`, `HLOD_LOD_SELECTIONS` order).
/// A choice naming one of a mesh's discrete LODs has no meaning here: a DAG has none.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum HlodLodSelection {
    /// The LOD the source shows at the layer's deviation from where the layer is first seen
    /// (`'calculate'`, the default).
    #[default]
    Calculate,
    /// The source's coarsest LOD (`'lowest'`): its DAG's roots.
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
/// deviation the automatic rule when `None` (`compiler_world_roots::flatten::layer_settings`), the
/// others their defaults resolved.
#[derive(Clone, Debug)]
pub struct HlodLayer {
    pub name: String,
    pub builder: HlodBuilder,
    pub parent: Option<usize>,
    pub accuracy: Option<f64>,
    pub accuracy_pixels: Option<f64>,
    pub deviation: Option<f64>,
    pub deviation_pixels: Option<f64>,
    /// Its atlas side, `DEFAULT_HLOD_TEXTURE_SIZE` when it names none.
    pub texture_size: usize,
    /// A merged layer's LOD of each source (`lodSelection`).
    pub lod_selection: HlodLodSelection,
    /// Whether a merged layer merges its materials into one atlas (`mergeMaterials`, false by
    /// default).
    pub merge_materials: bool,
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
const LAYER_FIELDS: [&str; 3] = ["name", "builder", "parent"];
const ASSIGN_FIELDS: [&str; 2] = ["match", "layer"];
const HLOD_FIELDS: [&str; 4] = ["layers", "assign", "default", "marks"];
