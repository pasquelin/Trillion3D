//! How one mesh's cards are built, every setting resolved (`meshBuild`: `maxMeshCards`,
//! `meshCardMinDensity`, `meshCardNormalThreshold`, read by `compiler::args::mesh_build`), each
//! default the reference's.
use crate::shared_math::abi::{
    DEFAULT_MAX_MESH_CARDS, DEFAULT_MESH_CARD_MIN_DENSITY, DEFAULT_MESH_CARD_NORMAL_THRESHOLD,
};

/// One mesh's card settings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CardSettings {
    /// The most cards the mesh keeps (`maxMeshCards`); 0 builds none.
    pub max_cards: u32,
    /// How much of its box's face a card's surfels must fill to be kept (`meshCardMinDensity`),
    /// from 0 to 1.
    pub min_density: f64,
    /// How squarely a surface must face a card's direction, as the cosine of the angle between
    /// them, to be covered by that card (`meshCardNormalThreshold`), from 0 to 1.
    pub normal_threshold: f64,
}

impl Default for CardSettings {
    fn default() -> Self {
        Self {
            max_cards: DEFAULT_MAX_MESH_CARDS,
            min_density: DEFAULT_MESH_CARD_MIN_DENSITY,
            normal_threshold: DEFAULT_MESH_CARD_NORMAL_THRESHOLD,
        }
    }
}

impl CardSettings {
    /// Whether cards are built for the mesh: the most it keeps is above 0.
    pub(crate) fn builds(&self) -> bool {
        self.max_cards > 0
    }
}
