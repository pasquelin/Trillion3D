//! A job's `lightmapBake` as the compiler reads it: whether the scene gets a volumetric lightmap
//! and how it is baked (`volumetric_lightmap::bake`). The field is `true` (the reference's
//! settings), `false` or none (no bake), or an object naming the settings it changes, each left
//! out for its default — the reference's —, the boxes the volume covers and the sky light it
//! shines. The sky comes from the job alone (`skyLight`): a glTF scene carries no sky light and the
//! runtime sky is not read by the compiler, so a bake with no `skyLight` shines none.
//!
//! A job naming no bake compiles as before, its cache key unchanged. Read and checked here once;
//! what does not read is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`).
use super::name_match::present;
use crate::compiler::validate::OPTIONS;
use crate::volumetric_lightmap::bake::abi::*;
use crate::volumetric_lightmap::bake::{BakeSettings, SkySettings};
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
    )?;
    number(
        map,
        MAXIMUM_BRICK_MEMORY_SETTING,
        MAXIMUM_BRICK_MEMORY_RANGE,
        &mut s.maximum_brick_memory,
    )?;
    number(
        map,
        SPHERICAL_HARMONIC_SMOOTHING_SETTING,
        SPHERICAL_HARMONIC_SMOOTHING_RANGE,
        &mut s.spherical_harmonic_smoothing,
    )?;
    number(
        map,
        LOADING_CELL_SIZE_SETTING,
        LOADING_CELL_SIZE_RANGE,
        &mut s.loading_cell_size,
    )?;
    number(
        map,
        MIN_BRICK_ERROR_SETTING,
        MIN_BRICK_ERROR_RANGE,
        &mut s.min_brick_error,
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

/// A linear colour: three finite numbers.
fn colour(map: &Map<String, Value>, key: &str, into: &mut [f64; 3]) -> Result<()> {
    if let Some(value) = present(map.get(key)) {
        *into = OPTIONS.numbers::<3>(Some(value), key)?;
    }
    Ok(())
}

/// The sky light `skyLight` names: `true` its defaults, `false` none, an object the settings it
/// names, each left out for its default.
fn sky_light(value: &Value) -> Result<Option<SkySettings>> {
    match value {
        Value::Bool(on) => Ok(on.then(SkySettings::default)),
        other => {
            let map = OPTIONS.known(other, &LIGHTMAP_BAKE_SKY_SETTINGS, LIGHTMAP_BAKE_SKY)?;
            let mut sky = SkySettings::default();
            if let Some(value) = present(map.get(SKY_LIGHT_INTENSITY_SETTING)) {
                let takes = "a finite number";
                sky.intensity = OPTIONS.bounded(
                    value,
                    SKY_LIGHT_INTENSITY_SETTING,
                    SKY_LIGHT_INTENSITY_RANGE,
                    takes,
                )?;
            }
            colour(map, SKY_LIGHT_COLOR_SETTING, &mut sky.color)?;
            let lower = SKY_LIGHT_LOWER_HEMISPHERE_COLOR_SETTING;
            colour(map, lower, &mut sky.lower_hemisphere_color)?;
            if let Some(value) = present(map.get(SKY_LIGHT_CAST_SHADOWS_SETTING)) {
                sky.casts_shadows = OPTIONS.boolean(Some(value), SKY_LIGHT_CAST_SHADOWS_SETTING)?;
            }
            Ok(Some(sky))
        }
    }
}

fn settings_of(value: &Value) -> Result<BakeSettings> {
    let mut fields: Vec<&str> = LIGHTMAP_BAKE_SETTINGS.to_vec();
    fields.push(LIGHTMAP_BAKE_VOLUMES);
    fields.push(LIGHTMAP_BAKE_SKY);
    let map = OPTIONS.known(value, &fields, LIGHTMAP_BAKE_FIELD)?;
    let mut s = BakeSettings::default();
    quantities(map, &mut s)?;
    cache(map, &mut s)?;
    if let Some(value) = present(map.get(LIGHTMAP_BAKE_VOLUMES)) {
        s.volumes = volumes(value)?;
    }
    if let Some(value) = present(map.get(LIGHTMAP_BAKE_SKY)) {
        s.sky_light = sky_light(value)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The sky light the bake `bake` names.
    fn sky(bake: Value) -> Option<SkySettings> {
        let read = LightmapBakeOptions::read(Some(&bake)).expect("read");
        read.settings().expect("a bake").sky_light.clone()
    }

    #[test]
    fn a_bake_shines_a_sky_light_only_where_its_job_names_one() {
        assert_eq!(sky(json!(true)), None);
        assert_eq!(sky(json!({})), None);
        assert_eq!(sky(json!({"skyLight": false})), None);
        assert_eq!(sky(json!({"skyLight": true})), Some(SkySettings::default()));
        let named = json!({"skyLight": {"intensity": 2.0, "color": [1.0, 0.5, 0.25], "castShadows": false}});
        let named = sky(named).expect("a sky");
        assert_eq!(named.intensity, 2.0);
        assert_eq!(named.color, [1.0, 0.5, 0.25]);
        assert_eq!(named.lower_hemisphere_color, [0.0; 3]);
        assert!(!named.casts_shadows);
    }

    #[test]
    fn a_sky_light_setting_of_the_wrong_kind_is_the_jobs_refusal_by_name() {
        for (bake, name) in [
            (json!({"skyLight": 3}), "skyLight"),
            (json!({"skyLight": {"color": [1.0, 2.0]}}), "color"),
            (json!({"skyLight": {"intensity": "bright"}}), "intensity"),
            (json!({"skyLight": {"castShadows": 1}}), "castShadows"),
            (json!({"skyLight": {"shine": 1}}), "shine"),
        ] {
            let refusal = LightmapBakeOptions::read(Some(&bake)).expect_err(name);
            assert!(refusal.contains(name), "{refusal}");
        }
    }
}
