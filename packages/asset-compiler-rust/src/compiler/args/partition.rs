//! A job's world partition as the compiler reads it (`resolvePartitionScheme`,
//! `resolvePartitionGrid` and `resolvePartitionGrids` write it): its scheme (`partitionScheme`,
//! `PartitionScheme`) and the grids every spatially loaded object streams on (`partitionGrid`, or
//! `partitionGrids`, `compiler/tables/partition/grid.rs`). A grid has its cell side and loading
//! range, metres, its load priority among the grids, the lower the sooner, its origin, glTF's `x`
//! and `z` or `x`, `y`, `z`, whether a load waits for its cells near the view
//! (`blockOnSlowStreaming`), and its scheme's own settings (`settings.rs`): each the reference's
//! when the job leaves it out (`DEFAULT_PARTITION_SCHEME`, `DEFAULT_PARTITION_CELL_SIZE`,
//! `DEFAULT_PARTITION_LOADING_RANGE`, `DEFAULT_PARTITION_PRIORITY`, the origin,
//! `DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING`, and the defaults of a world the reference
//! creates). For the scheme `true` names the default; for the grid `true` names every default and
//! `false` turns the streaming off: every object is loaded with the scene, no cell is cut and no
//! HLOD is built.
//!
//! A job may name several grids instead (`partitionGrids`, `grids.rs`): a list of the settings a
//! grid takes, each under a name, the first the default grid. An object streams on the grid its
//! `runtimeGrid` setting names (`ObjectSetting::runtime_grid`, `PartitionGrid::rank_of`).
//!
//! A job naming none of them keeps its cache key. Read and checked here once; what does not read
//! is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`), never the batch's.
use super::name_match::present;
use super::reader::Reader;
use super::*;
pub(crate) use settings::SquareSettings;
pub use settings::StreamBounds;
use settings::{origin_of, refusal, scheme_settings, unknown_setting, LooseSettings};

mod grids;
mod settings;

pub(crate) use grids::grid_name_of;

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

/// One grid's settings: its name — the one `runtimeGrid` names —, cell side and loading range,
/// priority, origin as glTF's `x`, `y` (up) and `z`, whether a load blocks on its slow streaming,
/// and each scheme's own (`LooseSettings`, `SquareSettings`).
#[derive(Clone, Debug)]
pub(crate) struct GridSettings {
    pub name: String,
    pub cell_size: f64,
    pub loading_range: f64,
    pub priority: u32,
    pub origin: [f64; 3],
    pub block_on_slow_streaming: bool,
    pub loose: LooseSettings,
    pub square: SquareSettings,
}

impl Default for GridSettings {
    /// The reference's main grid.
    fn default() -> Self {
        Self {
            name: DEFAULT_PARTITION_GRID_NAME.to_string(),
            cell_size: DEFAULT_PARTITION_CELL_SIZE,
            loading_range: DEFAULT_PARTITION_LOADING_RANGE,
            priority: DEFAULT_PARTITION_PRIORITY,
            origin: [0.0; 3],
            block_on_slow_streaming: DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING,
            loose: LooseSettings::default(),
            square: SquareSettings::default(),
        }
    }
}

/// A job's partition: its scheme, whether its objects stream, its grids — one or more, the first
/// the default one — and what the job named of the grids and of the scheme, their cache
/// identities.
#[derive(Clone, Debug)]
pub struct PartitionGrid {
    pub(crate) scheme: PartitionScheme,
    pub(crate) streams: bool,
    pub(crate) grids: Vec<GridSettings>,
    identity: Option<Value>,
    grids_identity: Option<Value>,
    scheme_identity: Option<Value>,
}

impl Default for PartitionGrid {
    /// The reference's default scheme and main grid, streaming.
    fn default() -> Self {
        Self {
            scheme: PartitionScheme::HashSet,
            streams: true,
            grids: vec![GridSettings::default()],
            identity: None,
            grids_identity: None,
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
    /// The partition the job's `partitionScheme`, `partitionGrid` and `partitionGrids` fields
    /// name, the default for none; `Err` with the job's refusal when one does not read, or when
    /// the job names both `partitionGrid` and `partitionGrids`.
    pub fn read(job: &Map<String, Value>) -> std::result::Result<Self, String> {
        let scheme_identity = present(job.get(PARTITION_SCHEME_FIELD)).cloned();
        let scheme = scheme(job.get(PARTITION_SCHEME_FIELD))?;
        let listed = present(job.get(PARTITION_GRIDS_FIELD));
        let Some(value) = present(job.get(PARTITION_GRID_FIELD)) else {
            return match listed {
                Some(list) => Self::listed(list, scheme, scheme_identity),
                None => Ok(Self {
                    scheme,
                    scheme_identity,
                    ..Self::default()
                }),
            };
        };
        if listed.is_some() {
            return Err(format!(
                "{PARTITION_GRIDS_FIELD}: {PARTITION_GRID_FIELD} and {PARTITION_GRIDS_FIELD} both \
                 name the grids: name them once"
            ));
        }
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
        if let Some(refusal) =
            unknown_setting(fields, &PARTITION_GRID_SETTINGS, PARTITION_GRID_FIELD)
        {
            return Err(refusal);
        }
        Ok(Self {
            identity,
            scheme_identity,
            grids: vec![GridSettings::from_fields(
                fields,
                scheme,
                PARTITION_GRID_FIELD,
            )?],
            ..Self::default()
        })
    }

    /// What named the grid, for the cache key: `None` when the job names none.
    pub fn identity(&self) -> Option<&Value> {
        self.identity.as_ref()
    }

    /// What named the grids, for the cache key: `None` when the job names none.
    pub fn grids_identity(&self) -> Option<&Value> {
        self.grids_identity.as_ref()
    }

    /// What named the scheme, for the cache key: `None` when the job names none.
    pub fn scheme_identity(&self) -> Option<&Value> {
        self.scheme_identity.as_ref()
    }
}

impl GridSettings {
    /// The grid `fields` name, each setting its default when left out, `field` naming where it was
    /// read from; `Err` with the job's refusal for a setting that does not read. It has no name.
    fn from_fields(
        fields: &Map<String, Value>,
        scheme: PartitionScheme,
        field: &str,
    ) -> std::result::Result<Self, String> {
        let refuse = refusal(field);
        let prefix = format!("{field}: ");
        let read = Reader {
            map: fields,
            what: &prefix,
        };
        let text = |refusal: CompilerError| refusal.message;
        let metres = |name: &str, fallback: f64| {
            (read.metres(name).map_err(text)).map(|named| named.unwrap_or(fallback))
        };
        let takes = format!("a whole number from 0 to {MAX_PARTITION_PRIORITY}");
        let bounds = (0, i64::from(MAX_PARTITION_PRIORITY));
        let priority = (read.whole("priority", bounds, &takes).map_err(text)?)
            .map_or(DEFAULT_PARTITION_PRIORITY, |p| p as u32);
        let origin = match present(fields.get("origin")) {
            None => [0.0; 3],
            Some(v) => origin_of(v, scheme).map_err(|takes| refuse("origin", takes, v))?,
        };
        let block_on_slow_streaming = (read.boolean("blockOnSlowStreaming").map_err(text)?)
            .unwrap_or(DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING);
        let (loose, square) = scheme_settings(&read, scheme, field)?;
        Ok(Self {
            cell_size: metres("cellSize", DEFAULT_PARTITION_CELL_SIZE)?,
            loading_range: metres("loadingRange", DEFAULT_PARTITION_LOADING_RANGE)?,
            priority,
            origin,
            block_on_slow_streaming,
            loose,
            square,
            ..Self::default()
        })
    }
}
