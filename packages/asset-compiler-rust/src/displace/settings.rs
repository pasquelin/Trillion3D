//! The settings of a mesh's baked displacement (`meshBuild`, `MeshDisplacementBakeSettingsWire`):
//! its height maps — a glTF texture each, with the magnitude and the centre of its heights —, the
//! set of texture coordinates they are read at, and how the tessellation shares the vertices it
//! adds along an edge. A mesh that names no map bakes nothing.
use super::abi::{DEFAULT_DISPLACEMENT_UV_CHANNEL, DISPLACEMENT_EDGE_SPLITS};

/// How the tessellation shares the vertex it adds on an edge between two triangles.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum EdgeSplit {
    /// One vertex for both sides, unless a material or a texture coordinate differs across the
    /// edge (`seams`): then one a side.
    #[default]
    Seams,
    /// One vertex a side, whatever the edge (`always-duplicate`).
    AlwaysDuplicate,
}

impl EdgeSplit {
    /// The way `name` names, none for a name that is no way.
    pub(crate) fn named(name: &str) -> Option<Self> {
        let [seams, duplicate] = DISPLACEMENT_EDGE_SPLITS;
        if name == seams {
            Some(Self::Seams)
        } else if name == duplicate {
            Some(Self::AlwaysDuplicate)
        } else {
            None
        }
    }
}

/// One height map a mesh names: the glTF texture whose first channel holds the height, the
/// distance in the units of the scene the height 1 lies from the height `center` along the normal,
/// and the height that stays on the surface.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MapSpec {
    pub texture: usize,
    pub magnitude: f32,
    pub center: f32,
}

/// A mesh's baked displacement: its maps, the set of texture coordinates they are read at and the
/// way the added vertices are shared.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DisplacementSettings {
    pub maps: Vec<MapSpec>,
    pub uv_channel: usize,
    pub edge_split: EdgeSplit,
}

impl Default for DisplacementSettings {
    fn default() -> Self {
        Self {
            maps: Vec::new(),
            uv_channel: DEFAULT_DISPLACEMENT_UV_CHANNEL,
            edge_split: EdgeSplit::default(),
        }
    }
}

impl DisplacementSettings {
    /// Whether the mesh names no map: it bakes nothing.
    pub(crate) fn is_off(&self) -> bool {
        self.maps.is_empty()
    }
}
