//! A job's world partition as the compiler reads it (`resolvePartitionScheme` and
//! `resolvePartitionGrid` write it): its scheme (`partitionScheme`, `PartitionScheme`) and the
//! main grid every spatially loaded object streams on (`partitionGrid`,
//! `compiler/tables/partition/grid.rs`) — its cell side and loading range, metres, its load
//! priority among the grids, the lower the sooner, its origin, glTF's `x` and `z` or `x`, `y`,
//! `z`, whether a load waits for its cells near the view (`blockOnSlowStreaming`), and its
//! scheme's own settings (`settings.rs`) —, each the reference's when the job leaves it out
//! (`DEFAULT_PARTITION_SCHEME`, `DEFAULT_PARTITION_CELL_SIZE`, `DEFAULT_PARTITION_LOADING_RANGE`,
//! `DEFAULT_PARTITION_PRIORITY`, the origin, `DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING`, and the
//! defaults of a world the reference creates). For the scheme `true` names the default; for the grid `true` names every default
//! and `false` turns the streaming off: every object is loaded with the scene, no cell is cut and
//! no HLOD is built.
//!
//! A job naming neither keeps its cache key. Read and checked here once; what does not read is
//! the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`), never the batch's.
use super::name_match::present;
use super::*;
pub(crate) use settings::SquareSettings;
pub use settings::StreamBounds;
use settings::{positive_metres, scheme_settings, LooseSettings};

mod settings;

/// How the spatially loaded objects are cut into cells and streamed (`PARTITION_SCHEMES`): a loose
/// hierarchical grid with no top, each cell streaming by its content, the HLOD grids doubling the
/// main one's cell and range level by level — the reference's default (`HashSet`) —; or the older
/// square hierarchical grid over the world, each cell streaming by its square, an object no cell
/// below its top holds always loaded, each HLOD layer naming its own grid (`SpatialHash`). In the
/// order `PARTITION_SCHEMES` names them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartitionScheme {
    HashSet,
    SpatialHash,
}

impl PartitionScheme {
    /// Every scheme, in the order `PARTITION_SCHEMES` names them.
    const ALL: [Self; 2] = [Self::HashSet, Self::SpatialHash];

    /// Its name, as the job and the partition's root write it.
    pub(crate) fn name(self) -> &'static str {
        PARTITION_SCHEMES[self as usize]
    }
}

/// A job's partition: its scheme, whether its objects stream, the main grid's settings — its
/// origin as glTF's `x`, `y` (up) and `z`, whether a load blocks on its slow streaming, and each
/// scheme's own (`LooseSettings`, `SquareSettings`) —, and what the job named of each, their cache
/// identities.
#[derive(Clone, Debug)]
pub struct PartitionGrid {
    pub(crate) scheme: PartitionScheme,
    pub(crate) streams: bool,
    pub(crate) cell_size: f64,
    pub(crate) loading_range: f64,
    pub(crate) priority: u32,
    pub(crate) origin: [f64; 3],
    pub(crate) block_on_slow_streaming: bool,
    pub(crate) loose: LooseSettings,
    pub(crate) square: SquareSettings,
    identity: Option<Value>,
    scheme_identity: Option<Value>,
}

impl Default for PartitionGrid {
    /// The reference's default scheme and main grid, streaming.
    fn default() -> Self {
        Self {
            scheme: PartitionScheme::HashSet,
            streams: true,
            cell_size: DEFAULT_PARTITION_CELL_SIZE,
            loading_range: DEFAULT_PARTITION_LOADING_RANGE,
            priority: DEFAULT_PARTITION_PRIORITY,
            origin: [0.0; 3],
            block_on_slow_streaming: DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING,
            loose: LooseSettings::default(),
            square: SquareSettings::default(),
            identity: None,
            scheme_identity: None,
        }
    }
}

/// The scheme `value` names: the default for none or `true`, one of `PARTITION_SCHEMES` by name;
/// `Err` naming them otherwise — `false` too, `partitionGrid: false` turning the streaming off.
fn scheme(value: Option<&Value>) -> std::result::Result<PartitionScheme, String> {
    let named = match present(value) {
        None | Some(Value::Bool(true)) => DEFAULT_PARTITION_SCHEME,
        Some(value) => value.as_str().unwrap_or_default(),
    };
    match PARTITION_SCHEMES.iter().position(|name| *name == named) {
        Some(at) => Ok(PartitionScheme::ALL[at]),
        None => Err(format!(
            "{PARTITION_SCHEME_FIELD} must be one of {} or true, got {} ({PARTITION_GRID_FIELD}: \
             false turns the streaming off)",
            PARTITION_SCHEMES.join(", "),
            value.map_or(Value::Null, Value::clone)
        )),
    }
}

impl PartitionGrid {
    /// The partition the job's `partitionScheme` and `partitionGrid` fields name, the default for
    /// none; `Err` with the job's refusal when one does not read.
    pub fn read(job: &Map<String, Value>) -> std::result::Result<Self, String> {
        let scheme_identity = present(job.get(PARTITION_SCHEME_FIELD)).cloned();
        let scheme = scheme(job.get(PARTITION_SCHEME_FIELD))?;
        let Some(value) = present(job.get(PARTITION_GRID_FIELD)) else {
            return Ok(Self {
                scheme,
                scheme_identity,
                ..Self::default()
            });
        };
        let identity = Some(value.clone());
        let fields = match value {
            Value::Bool(streams) => {
                let streams = *streams;
                return Ok(Self {
                    scheme,
                    streams,
                    identity,
                    scheme_identity,
                    ..Self::default()
                });
            }
            Value::Object(fields) => fields,
            _ => {
                return Err(format!(
                    "{PARTITION_GRID_FIELD} must be true, false or an object of {}, got {value}",
                    PARTITION_GRID_SETTINGS.join(", ")
                ))
            }
        };
        let named = |key: &&String| PARTITION_GRID_SETTINGS.contains(&key.as_str());
        if let Some(key) = fields.keys().find(|key| !named(key)) {
            return Err(format!(
                "{PARTITION_GRID_FIELD}: the grid has no field {key}: {}",
                PARTITION_GRID_SETTINGS.join(", ")
            ));
        }
        let refuse = |name: &str, takes: &str, got: &Value| {
            format!("{PARTITION_GRID_FIELD}: {name} must be {takes}, got {got}")
        };
        let metres = |name: &str, fallback: f64| match present(fields.get(name)) {
            None => Ok(fallback),
            Some(v) => {
                positive_metres(v).ok_or_else(|| refuse(name, "a number of metres above 0", v))
            }
        };
        let whole = format!("a whole number from 0 to {MAX_PARTITION_PRIORITY}");
        let priority = match present(fields.get("priority")) {
            None => DEFAULT_PARTITION_PRIORITY,
            Some(v) => (v.as_u64())
                .filter(|p| *p <= u64::from(MAX_PARTITION_PRIORITY))
                .map(|p| p as u32)
                .ok_or_else(|| refuse("priority", &whole, v))?,
        };
        // `[x, z]` on the ground, its height 0; or, a loose grid's, `[x, y, z]`: a square grid
        // lies on the ground.
        let (lengths, takes): (&[usize], _) = match scheme {
            PartitionScheme::HashSet => (&[2, 3], "two or three finite numbers"),
            PartitionScheme::SpatialHash => (&[2], "two finite numbers"),
        };
        let origin = match present(fields.get("origin")) {
            None => [0.0; 3],
            Some(v) => (v.as_array())
                .filter(|point| lengths.contains(&point.len()))
                .and_then(|point| {
                    point
                        .iter()
                        .map(Value::as_f64)
                        .collect::<Option<Vec<f64>>>()
                })
                .filter(|point| point.iter().all(|c| c.is_finite()))
                .map(|p| {
                    if p.len() == 2 {
                        [p[0], 0.0, p[1]]
                    } else {
                        [p[0], p[1], p[2]]
                    }
                })
                .ok_or_else(|| refuse("origin", takes, v))?,
        };
        let block_on_slow_streaming = match present(fields.get("blockOnSlowStreaming")) {
            None => DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING,
            Some(v) => {
                (v.as_bool()).ok_or_else(|| refuse("blockOnSlowStreaming", "true or false", v))?
            }
        };
        let (loose, square) = scheme_settings(fields, scheme)?;
        Ok(Self {
            scheme,
            streams: true,
            cell_size: metres("cellSize", DEFAULT_PARTITION_CELL_SIZE)?,
            loading_range: metres("loadingRange", DEFAULT_PARTITION_LOADING_RANGE)?,
            priority,
            origin,
            block_on_slow_streaming,
            loose,
            square,
            identity,
            scheme_identity,
        })
    }

    /// What named the grid, for the cache key: `None` when the job names none.
    pub fn identity(&self) -> Option<&Value> {
        self.identity.as_ref()
    }

    /// What named the scheme, for the cache key: `None` when the job names none.
    pub fn scheme_identity(&self) -> Option<&Value> {
        self.scheme_identity.as_ref()
    }
}
