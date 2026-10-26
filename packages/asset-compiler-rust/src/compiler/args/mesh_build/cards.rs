//! The mesh cards settings of a mesh's build (`meshBuild`, `MeshCardsSettingsWire`): the most cards
//! it keeps, how much of a card's box its surfaces must fill and how squarely they must face it
//! (`card_representation::CardSettings`). Each source names them as it names the others
//! (`mesh_build.rs`); the reference's default where none does.
use crate::card_representation::CardSettings;
use crate::compiler::args::reader::Reader;
use crate::shared_math::abi::{
    MAX_MESH_CARDS, MAX_MESH_CARDS_SETTING, MESH_CARD_MIN_DENSITY_SETTING,
    MESH_CARD_NORMAL_THRESHOLD_SETTING,
};
use crate::Result;

/// The card settings one source names, each none where it names none.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct NamedCards {
    max_cards: Option<u32>,
    min_density: Option<f64>,
    normal_threshold: Option<f64>,
}

impl NamedCards {
    /// The settings `read` holds: the most cards a whole number from 0 to `MAX_MESH_CARDS`, the
    /// density and the threshold numbers from 0 to 1.
    pub(super) fn of(read: &Reader<'_>) -> Result<Self> {
        let takes = format!("a whole number from 0 to {MAX_MESH_CARDS}");
        let share = |key: &str| read.number(key, (0.0, 1.0), "a number from 0 to 1");
        Ok(Self {
            max_cards: (read.whole(
                MAX_MESH_CARDS_SETTING,
                (0, i64::from(MAX_MESH_CARDS)),
                &takes,
            )?)
            .map(|n| n as u32),
            min_density: share(MESH_CARD_MIN_DENSITY_SETTING)?,
            normal_threshold: share(MESH_CARD_NORMAL_THRESHOLD_SETTING)?,
        })
    }

    /// These settings, each that names none taken from `lower`.
    pub(super) fn or(self, lower: Self) -> Self {
        Self {
            max_cards: self.max_cards.or(lower.max_cards),
            min_density: self.min_density.or(lower.min_density),
            normal_threshold: self.normal_threshold.or(lower.normal_threshold),
        }
    }

    /// Every setting, the default where none was named.
    pub(super) fn resolved(self) -> CardSettings {
        let default = CardSettings::default();
        CardSettings {
            max_cards: self.max_cards.unwrap_or(default.max_cards),
            min_density: self.min_density.unwrap_or(default.min_density),
            normal_threshold: self.normal_threshold.unwrap_or(default.normal_threshold),
        }
    }
}

impl super::MeshBuildOptions {
    /// The card settings of the cells an HLOD layer builds: the job's own `meshBuild` ones, the
    /// default where it names none — a cell's actors are new meshes, which no rule or `extras`
    /// names.
    pub(crate) fn hlod_cards(&self) -> CardSettings {
        self.rules.scene.cards.resolved()
    }
}
