//! Each scheme's own settings of the main grid (`HASH_SET_GRID_SETTINGS`,
//! `SPATIAL_HASH_GRID_SETTINGS`), as the job names them and the reference defaults them for a world
//! it creates: under `hashSet`, the bounds a cell of the finest level streams by, whether the grids
//! lie flat on the ground, and each HLOD level's grid; under `spatialHash`, whether each level's
//! cells nest in the next one's, whether a wished cell pulls in the coarser cells overlapping it,
//! and whether a small object goes to the finest cell under its centre. A setting of the scheme the
//! job does not take refuses it.
use super::super::name_match::present;
use super::super::*;
use super::PartitionScheme;

/// The bounds a cell of a loose grid's finest level streams by (`PARTITION_STREAM_BOUNDS`, in that
/// order): the box around its content (`Content`), its cell's box (`Cell`), or the first clipped to
/// the second (`Clipped`). A coarser level's cell streams by its content whatever it says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamBounds {
    Content,
    Cell,
    Clipped,
}

impl StreamBounds {
    /// Every kind, in the order `PARTITION_STREAM_BOUNDS` names them.
    const ALL: [Self; 3] = [Self::Content, Self::Cell, Self::Clipped];
}

/// The `hashSet` scheme's own settings: the main grid's stream bounds, whether the grids lie flat
/// on the ground, and per HLOD level from 0 the cell side and loading range its grid names, each
/// the main grid's times `2 << level` where `None`.
#[derive(Clone, Debug)]
pub(crate) struct LooseSettings {
    pub stream_bounds: StreamBounds,
    pub flat: bool,
    pub hlod_grids: Vec<[Option<f64>; 2]>,
}

/// The `spatialHash` scheme's own settings: whether each level's cells nest in the next one's,
/// whether a wished cell pulls in the coarser cells overlapping it, and whether an object whose
/// ground box is no larger than a finest cell goes to the one under its centre.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SquareSettings {
    pub nested_levels: bool,
    pub pull_coarser: bool,
    pub small_by_centre: bool,
}

impl Default for LooseSettings {
    /// A loose grid as the reference creates one.
    fn default() -> Self {
        Self {
            stream_bounds: bounds_named(DEFAULT_PARTITION_STREAM_BOUNDS).expect("a default bound"),
            flat: DEFAULT_PARTITION_FLAT,
            hlod_grids: Vec::new(),
        }
    }
}

impl Default for SquareSettings {
    /// A square grid as the reference creates one.
    fn default() -> Self {
        Self {
            nested_levels: DEFAULT_PARTITION_NESTED_LEVELS,
            pull_coarser: DEFAULT_PARTITION_PULL_COARSER,
            small_by_centre: DEFAULT_PARTITION_SMALL_BY_CENTRE,
        }
    }
}

/// The stream bounds `PARTITION_STREAM_BOUNDS` names `name`, `None` for another name.
fn bounds_named(name: &str) -> Option<StreamBounds> {
    let at = PARTITION_STREAM_BOUNDS.iter().position(|b| *b == name)?;
    Some(StreamBounds::ALL[at])
}

/// `value` as a number of metres above 0, `None` for any other.
pub(super) fn positive_metres(value: &Value) -> Option<f64> {
    value.as_f64().filter(|m| m.is_finite() && *m > 0.0)
}

/// The settings of `scheme` the grid's `fields` name, each its default when left out; `Err` with
/// the job's refusal for a setting of the other scheme or one that does not read.
pub(super) fn scheme_settings(
    fields: &Map<String, Value>,
    scheme: PartitionScheme,
) -> std::result::Result<(LooseSettings, SquareSettings), String> {
    let (foreign, other) = match scheme {
        PartitionScheme::HashSet => (
            &SPATIAL_HASH_GRID_SETTINGS[..],
            PartitionScheme::SpatialHash,
        ),
        PartitionScheme::SpatialHash => (&HASH_SET_GRID_SETTINGS[..], PartitionScheme::HashSet),
    };
    if let Some(name) = foreign
        .iter()
        .find(|name| present(fields.get(**name)).is_some())
    {
        let other = other.name();
        return Err(format!(
            "{PARTITION_GRID_FIELD}: {name} is read by {PARTITION_SCHEME_FIELD} {other} alone"
        ));
    }
    let refuse = |name: &str, takes: &str, got: &Value| {
        format!("{PARTITION_GRID_FIELD}: {name} must be {takes}, got {got}")
    };
    let flag = |name: &str, fallback: bool| match present(fields.get(name)) {
        None => Ok(fallback),
        Some(v) => v.as_bool().ok_or_else(|| refuse(name, "true or false", v)),
    };
    let mut loose = LooseSettings::default();
    if let Some(v) = present(fields.get("streamBounds")) {
        let takes = format!("one of {}", PARTITION_STREAM_BOUNDS.join(", "));
        loose.stream_bounds =
            (v.as_str().and_then(bounds_named)).ok_or_else(|| refuse("streamBounds", &takes, v))?;
    }
    loose.flat = flag("flat", DEFAULT_PARTITION_FLAT)?;
    if let Some(v) = present(fields.get("hlodGrids")) {
        let levels = v
            .as_array()
            .ok_or_else(|| refuse("hlodGrids", "an array", v))?;
        loose.hlod_grids = (levels.iter().enumerate())
            .map(|(at, level)| hlod_grid(level, at))
            .collect::<std::result::Result<_, _>>()?;
    }
    let square = SquareSettings {
        nested_levels: flag("nestedLevels", DEFAULT_PARTITION_NESTED_LEVELS)?,
        pull_coarser: flag("pullCoarser", DEFAULT_PARTITION_PULL_COARSER)?,
        small_by_centre: flag("smallByCentre", DEFAULT_PARTITION_SMALL_BY_CENTRE)?,
    };
    Ok((loose, square))
}

/// HLOD level `at`'s grid as `value` names it: its cell side and loading range, each `None` left
/// out, `null` naming neither; `Err` for a field it does not hold or a size not above 0.
fn hlod_grid(value: &Value, at: usize) -> std::result::Result<[Option<f64>; 2], String> {
    let what = format!("{PARTITION_GRID_FIELD}: hlodGrids[{at}]");
    let Some(value) = present(Some(value)) else {
        return Ok([None, None]);
    };
    let settings = PARTITION_HLOD_GRID_SETTINGS.join(", ");
    let fields =
        (value.as_object()).ok_or_else(|| format!("{what} must be an object of {settings}"))?;
    let named = |key: &&String| PARTITION_HLOD_GRID_SETTINGS.contains(&key.as_str());
    if let Some(key) = fields.keys().find(|key| !named(key)) {
        return Err(format!("{what} has no field {key}: {settings}"));
    }
    let metres = |name: &str| match present(fields.get(name)) {
        None => Ok(None),
        Some(v) => positive_metres(v)
            .map(Some)
            .ok_or_else(|| format!("{what}.{name} must be a number of metres above 0, got {v}")),
    };
    Ok([metres("cellSize")?, metres("loadingRange")?])
}
