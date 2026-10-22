//! A job's `lightmapBake` as the compiler reads it: whether the scene gets a volumetric lightmap
//! and how it is baked (`volumetric_lightmap::bake`). The field is `true` (the reference's
//! settings), `false` or none (no bake), or an object naming the settings it changes, each left
//! out for its default — the reference's — and the boxes the volume covers.
//!
//! A job naming no bake compiles as before, its cache key unchanged. Read and checked here once;
//! what does not read is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`).
use super::name_match::present;
use crate::compiler::validate::OPTIONS;
use crate::volumetric_lightmap::bake::abi::*;
use crate::volumetric_lightmap::bake::BakeSettings;
use crate::Result;
use serde_json::{Map, Value};

/// A job's `lightmapBake`: the settings it asks for, none for no bake, and what named them, its
/// cache identity.
#[derive(Clone, Debug, Default)]
pub struct LightmapBakeOptions {
    settings: Option<BakeSettings>,
    identity: Option<Value>,
}

/// A whole number setting within its range.
fn whole(map: &Map<String, Value>, key: &str, range: (u32, u32), into: &mut u32) -> Result<()> {
    if let Some(value) = present(map.get(key)) {
        let takes = format!("a whole number from {} to {}", range.0, range.1);
        let bounds = (i64::from(range.0), i64::from(range.1));
        *into = OPTIONS.whole(value, key, bounds, &takes)? as u32;
    }
    Ok(())
}

/// A number setting within its range.
fn number(map: &Map<String, Value>, key: &str, range: (f64, f64), into: &mut f64) -> Result<()> {
    if let Some(value) = present(map.get(key)) {
        let takes = format!("a number from {} to {}", range.0, range.1);
        *into = OPTIONS.bounded(value, key, range, &takes)?;
    }
    Ok(())
}

/// The boxes of `volumes`: each a lower then an upper corner, three finite numbers each, the
/// upper above the lower.
fn volumes(value: &Value) -> Result<Vec<([f64; 3], [f64; 3])>> {
    let name = LIGHTMAP_BAKE_VOLUMES;
    OPTIONS
        .array(value, name)?
        .iter()
        .map(|item| {
            let corners = OPTIONS.array(item, name)?;
            let [low, high] = corners.as_slice() else {
                return Err(
                    OPTIONS.bad(format!("{name} holds boxes of a lower and an upper corner"))
                );
            };
            let (low, high) = (
                OPTIONS.numbers::<3>(Some(low), name)?,
                OPTIONS.numbers::<3>(Some(high), name)?,
            );
            if (0..3).any(|k| low[k] >= high[k]) {
                return Err(OPTIONS.bad(format!(
                    "{name} holds boxes whose upper corner is above the lower"
                )));
            }
            Ok((low, high))
        })
        .collect()
}

/// The sizes and counts of the bake the map names.
fn quantities(map: &Map<String, Value>, s: &mut BakeSettings) -> Result<()> {
    number(
        map,
        DETAIL_CELL_SIZE_SETTING,
        DETAIL_CELL_SIZE_RANGE,
        &mut s.detail_cell_size,
    )?;
    whole(
        map,
        QUALITY_MULTIPLIER_SETTING,
        QUALITY_MULTIPLIER_RANGE,
        &mut s.quality_multiplier,
    )?;
    whole(map, GI_SAMPLES_SETTING, GI_SAMPLES_RANGE, &mut s.gi_samples)?;
    whole(
        map,
        MAX_REFINEMENT_LEVELS_SETTING,
        MAX_REFINEMENT_LEVELS_RANGE,
        &mut s.max_refinement_levels,
    )?;
    number(
        map,
        AUTOMATIC_VOLUME_EXPAND_SETTING,
        AUTOMATIC_VOLUME_EXPAND_RANGE,
        &mut s.automatic_volume_expand,
    )?;
    let limit = (f64::MIN_POSITIVE, AUTOMATIC_VOLUME_LIMIT_RANGE.1);
    number(
        map,
        AUTOMATIC_VOLUME_LIMIT_SETTING,
        limit,
        &mut s.automatic_volume_limit,
    )
}

/// The irradiance cache the map names.
fn cache(map: &Map<String, Value>, s: &mut BakeSettings) -> Result<()> {
    if let Some(value) = present(map.get(IRRADIANCE_CACHING_SETTING)) {
        s.irradiance_caching = OPTIONS.boolean(Some(value), IRRADIANCE_CACHING_SETTING)?;
    }
    whole(
        map,
        IRRADIANCE_CACHE_QUALITY_SETTING,
        IRRADIANCE_CACHE_QUALITY_RANGE,
        &mut s.irradiance_cache_quality,
    )?;
    number(
        map,
        IRRADIANCE_CACHE_SPACING_SETTING,
        IRRADIANCE_CACHE_SPACING_RANGE,
        &mut s.irradiance_cache_spacing,
    )?;
    number(
        map,
        IRRADIANCE_CACHE_CORNER_REJECTION_SETTING,
        IRRADIANCE_CACHE_CORNER_REJECTION_RANGE,
        &mut s.irradiance_cache_corner_rejection,
    )
}

fn settings_of(value: &Value) -> Result<BakeSettings> {
    let mut fields: Vec<&str> = LIGHTMAP_BAKE_SETTINGS.to_vec();
    fields.push(LIGHTMAP_BAKE_VOLUMES);
    let map = OPTIONS.known(value, &fields, LIGHTMAP_BAKE_FIELD)?;
    let mut s = BakeSettings::default();
    quantities(map, &mut s)?;
    cache(map, &mut s)?;
    if let Some(value) = present(map.get(LIGHTMAP_BAKE_VOLUMES)) {
        s.volumes = volumes(value)?;
    }
    Ok(s)
}

impl LightmapBakeOptions {
    /// The bake the job's `lightmapBake` field names, none for none; `Err` with the job's refusal
    /// when it does not read.
    pub fn read(value: Option<&Value>) -> std::result::Result<Self, String> {
        Self::parse(value).map_err(|e| e.message)
    }

    fn parse(value: Option<&Value>) -> Result<Self> {
        let settings = match present(value) {
            None | Some(Value::Bool(false)) => return Ok(Self::default()),
            Some(Value::Bool(true)) => BakeSettings::default(),
            Some(other) => settings_of(other)?,
        };
        Ok(Self {
            settings: Some(settings),
            identity: value.cloned(),
        })
    }

    /// The settings of the bake, none when the job asks for none.
    pub fn settings(&self) -> Option<&BakeSettings> {
        self.settings.as_ref()
    }

    /// What named the bake, for the cache key: `None` when the job names none.
    pub fn identity(&self) -> Option<&Value> {
        self.identity.as_ref()
    }
}
