use crate::volumetric_lightmap::bake::abi::{LIGHTMAP_BAKE_FIELD, LIGHTMAP_BAKE_OPTION};
use crate::*;
pub(crate) use serde_json::Map;
use texture_formats::{
    texture_formats, DEFAULT_TEXTURE_FORMAT, TEXTURES_FORMAT_FIELD, TEXTURE_FORMAT_OPTION,
};
use usage::{usage, SHORT_FORMS};

/// The threads of a job that names none: every core the machine offers, at most `MAX_THREADS`. A
/// job's threads are a bound: it runs as many workers as its memory budget holds (`plan_buffers`).
pub fn machine_threads() -> usize {
    std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(MAX_THREADS)
}

mod lightmap_bake;
mod materials;
pub(crate) mod mesh_build;
pub(crate) mod name_match;
pub(crate) mod objects;
mod partition;
mod texture_formats;
mod usage;
mod voxelize;
pub use crate::hlod::options::{marked, Hlod, HlodBuilder, HlodLayer, HlodLodSelection};
pub use lightmap_bake::LightmapBakeOptions;
pub use materials::MaterialOptions;
pub use mesh_build::MeshBuildOptions;
pub use objects::ObjectSettings;
pub(crate) use partition::{GridSettings, SquareSettings};
pub use partition::{PartitionGrid, PartitionScheme, StreamBounds};
pub use voxelize::VoxelizeOptions;

/// Job fields the command line gives as numbers.
const NUMBER_FIELDS: [&str; 3] = [
    job_field::TRIANGLE_BUDGET,
    job_field::THREADS,
    job_field::RAM_BUDGET_MB,
];

/// A positive integer, `default` when absent or null.
pub fn positive(
    value: Option<&Value>,
    default: usize,
    name: &str,
) -> std::result::Result<usize, String> {
    match value {
        None | Some(Value::Null) => Ok(default),
        Some(v) => v
            .as_u64()
            .filter(|n| *n > 0)
            .map(|n| n as usize)
            .ok_or_else(|| format!("{name} must be a positive integer")),
    }
}

/// What a job takes for the fields it does not name: a batch's scope, thread count and memory
/// share, or the command line's defaults (its every form names the scope: `SHORT_FORMS`).
pub struct JobDefaults {
    pub scope: &'static str,
    pub threads: usize,
    pub ram_budget_mb: usize,
}

/// Batch file field naming a job, read by `parse_batch`.
pub const ID_FIELD: &str = "id";

/// The fields a job names as JSON, beside `JOB_FIELDS`: the HLOD, the scene's temporal
/// anti-aliasing, the responsive objects, the settings by material name, the voxelized objects,
/// the partition's scheme and main grid or its several grids, the mesh build settings, each
/// object's settings and the volumetric lightmap's bake.
const JSON_FIELDS: [&str; 11] = [
    HLOD_FIELD,
    TEMPORAL_AA_FIELD,
    RESPONSIVE_FIELD,
    MATERIALS_FIELD,
    VOXELIZE_FIELD,
    PARTITION_SCHEME_FIELD,
    PARTITION_GRID_FIELD,
    PARTITION_GRIDS_FIELD,
    MESH_BUILD_FIELD,
    OBJECT_SETTINGS_FIELD,
    LIGHTMAP_BAKE_FIELD,
];

/// The one reading of a compile job, whichever form named it: a batch file's job object, or the
/// command line's values keyed by `JOB_FIELDS`. A key outside `JOB_FIELDS`, `id`,
/// `texturesFormat` and `JSON_FIELDS`, or a text field holding another type, is refused by name: a
/// misspelt or mistyped field never cooks at its default unannounced. The values are checked by
/// `compile`; the HLOD's, the material settings' and the voxelized objects' names and patterns
/// are read here (`Hlod::read`, `MaterialOptions::read`, `VoxelizeOptions::read`), what does not
/// read refused with them.
pub fn job_options(
    job: &Map<String, Value>,
    defaults: &JobDefaults,
    cancelled: Arc<AtomicBool>,
) -> std::result::Result<Options, String> {
    for (key, value) in job {
        let key = key.as_str();
        let named = JOB_FIELDS.contains(&key) || [ID_FIELD, TEXTURES_FORMAT_FIELD].contains(&key);
        if !named && !JSON_FIELDS.contains(&key) {
            return Err(format!("unknown job field {key}"));
        }
        let typed = NUMBER_FIELDS.contains(&key) || JSON_FIELDS.contains(&key);
        if !typed && !value.is_string() && !value.is_null() {
            return Err(format!("{key} must be a string"));
        }
    }
    let text = |name: &str| job.get(name).and_then(Value::as_str);
    let number = |name: &str, default: usize| positive(job.get(name), default, name);
    let source = text(job_field::SOURCE).unwrap_or("");
    let cache = text(job_field::CACHE).unwrap_or("");
    if source.is_empty() || cache.is_empty() {
        let (source, cache) = (job_field::SOURCE, job_field::CACHE);
        return Err(format!("{source} and {cache} are required"));
    }
    Ok(Options {
        source: PathBuf::from(source),
        cache: PathBuf::from(cache),
        // An empty one is refused by the one check of a job's values (`compile`).
        resource_base: text(job_field::RESOURCE_BASE_URL).unwrap_or("").to_string(),
        scope: text(job_field::SCOPE).unwrap_or(defaults.scope).to_string(),
        triangle_budget: number(job_field::TRIANGLE_BUDGET, DEFAULT_TRIANGLE_BUDGET)?,
        threads: number(job_field::THREADS, defaults.threads)?,
        ram_budget_mb: number(job_field::RAM_BUDGET_MB, defaults.ram_budget_mb)?,
        simplification: text(job_field::SIMPLIFICATION)
            .unwrap_or(SIMPLIFICATIONS[0])
            .to_string(),
        texture_formats: texture_formats(
            text(TEXTURES_FORMAT_FIELD).unwrap_or(DEFAULT_TEXTURE_FORMAT),
        )?,
        // What does not read is the job's refusal (`validate_compile_options`), never the batch's.
        hlod: Hlod::read(job.get(HLOD_FIELD)),
        materials: MaterialOptions::read(
            job.get(TEMPORAL_AA_FIELD),
            job.get(RESPONSIVE_FIELD),
            job.get(MATERIALS_FIELD),
        ),
        voxelize: VoxelizeOptions::read(job.get(VOXELIZE_FIELD)),
        partition_grid: PartitionGrid::read(job),
        mesh_build: MeshBuildOptions::read(job.get(MESH_BUILD_FIELD)),
        object_settings: ObjectSettings::read(job.get(OBJECT_SETTINGS_FIELD)),
        lightmap_bake: LightmapBakeOptions::read(job.get(LIGHTMAP_BAKE_FIELD)),
        cancelled,
    })
}

/// The fields whose flag may hold a bare word, not JSON: the scene's temporal anti-aliasing level
/// and the partition's scheme, each checked by its reader.
const BARE_FIELDS: [&str; 2] = [TEMPORAL_AA_FIELD, PARTITION_SCHEME_FIELD];

/// The command line's job: its values in `JOB_FIELDS` order, read as a batch of one reads its job; an
/// empty value names nothing, so the field takes its default as a batch job that leaves it out.
pub fn parse_compiler_args(
    args: &[String],
    cancelled: Arc<AtomicBool>,
) -> std::result::Result<Options, String> {
    // The flags holding a job field's value, the last one of each kept: JSON, a bare word too for
    // `BARE_FIELDS`.
    let json_flags = [
        (HLOD_OPTION, HLOD_FIELD),
        (TEMPORAL_AA_OPTION, TEMPORAL_AA_FIELD),
        (RESPONSIVE_OPTION, RESPONSIVE_FIELD),
        (MATERIALS_OPTION, MATERIALS_FIELD),
        (VOXELIZE_OPTION, VOXELIZE_FIELD),
        (PARTITION_SCHEME_OPTION, PARTITION_SCHEME_FIELD),
        (PARTITION_GRID_OPTION, PARTITION_GRID_FIELD),
        (PARTITION_GRIDS_OPTION, PARTITION_GRIDS_FIELD),
        (MESH_BUILD_OPTION, MESH_BUILD_FIELD),
        (OBJECT_SETTINGS_OPTION, OBJECT_SETTINGS_FIELD),
        (LIGHTMAP_BAKE_OPTION, LIGHTMAP_BAKE_FIELD),
    ];
    let is_json = |arg: &String| json_flags.iter().any(|(option, _)| arg.starts_with(option));
    let (flags, args): (Vec<String>, Vec<String>) = args
        .iter()
        .cloned()
        .partition(|arg| arg.starts_with(TEXTURE_FORMAT_OPTION) || is_json(arg));
    let (named, flags): (Vec<String>, Vec<String>) = flags.into_iter().partition(is_json);
    let left_out = SHORT_FORMS
        .iter()
        .find(|out| out.len() + args.len() == JOB_FIELDS.len())
        .ok_or_else(usage)?;
    let mut job: Map<String, Value> = JOB_FIELDS
        .iter()
        .filter(|field| !left_out.contains(*field))
        .zip(&args)
        .filter(|(_, raw)| !raw.is_empty())
        .map(|(field, raw)| {
            let value = match raw.parse::<u64>() {
                Ok(n) if NUMBER_FIELDS.contains(field) => Value::from(n),
                _ => Value::from(raw.as_str()),
            };
            (field.to_string(), value)
        })
        .collect();
    if let Some(flag) = flags.last() {
        job.insert(
            TEXTURES_FORMAT_FIELD.into(),
            Value::from(&flag[TEXTURE_FORMAT_OPTION.len()..]),
        );
    }
    for (option, field) in json_flags {
        if let Some(flag) = named.iter().rfind(|arg| arg.starts_with(option)) {
            let raw = &flag[option.len()..];
            let value = match serde_json::from_str(raw) {
                Ok(value) => value,
                // A bare word is a `BARE_FIELDS` field's text, which its reader checks; any other
                // flag that is not JSON is refused here, never read as a name.
                Err(_) if BARE_FIELDS.contains(&field) => Value::from(raw),
                Err(e) => return Err(format!("{option} must hold JSON: {e}")),
            };
            job.insert(field.into(), value);
        }
    }
    let defaults = JobDefaults {
        scope: SCOPES[0],
        threads: machine_threads(),
        ram_budget_mb: DEFAULT_RAM_BUDGET_MB,
    };
    job_options(&job, &defaults, cancelled)
}

/// A job's option as it read, or its refusal (`INVALID_OPTIONS`) when it did not.
fn refused<T>(read: &std::result::Result<T, String>) -> crate::Result<&T> {
    read.as_ref()
        .map_err(|refusal| crate::CompilerError::new("INVALID_OPTIONS", refusal.clone()))
}

impl Options {
    /// This job's HLOD, or its refusal (`INVALID_OPTIONS`) when it does not read.
    pub(crate) fn hlod(&self) -> crate::Result<&Hlod> {
        refused(&self.hlod)
    }
    /// This job's material settings, or their refusal (`INVALID_OPTIONS`) when they do not read.
    pub(crate) fn materials(&self) -> crate::Result<&MaterialOptions> {
        refused(&self.materials)
    }
    /// This job's voxelized objects, or their refusal (`INVALID_OPTIONS`) when they do not read.
    pub(crate) fn voxelize(&self) -> crate::Result<&VoxelizeOptions> {
        refused(&self.voxelize)
    }
    /// This job's main partition grid, or its refusal (`INVALID_OPTIONS`) when it does not read.
    pub(crate) fn partition_grid(&self) -> crate::Result<&PartitionGrid> {
        refused(&self.partition_grid)
    }
    /// This job's mesh build settings, or their refusal (`INVALID_OPTIONS`) when they do not read.
    pub(crate) fn mesh_build(&self) -> crate::Result<&MeshBuildOptions> {
        refused(&self.mesh_build)
    }
    /// This job's object settings, or their refusal (`INVALID_OPTIONS`) when they do not read.
    pub(crate) fn object_settings(&self) -> crate::Result<&ObjectSettings> {
        refused(&self.object_settings)
    }
    /// This job's lightmap bake, or its refusal (`INVALID_OPTIONS`) when it does not read.
    pub(crate) fn lightmap_bake(&self) -> crate::Result<&LightmapBakeOptions> {
        refused(&self.lightmap_bake)
    }
    /// This job's RAM budget in bytes, `ramBudgetMb`; past what a `usize` counts, no bound.
    pub fn ram_budget_bytes(&self) -> usize {
        self.ram_budget_mb.saturating_mul(1024 * 1024)
    }
    /// Folder of this job's scope in the cache: its pointer, and one folder per key.
    pub fn scope_directory(&self) -> PathBuf {
        native_dir(&self.cache).join(&self.scope)
    }
    /// This job's scope pointer, the only stable entry of the cache (`cache/publish.rs`,
    /// `write_pointer`).
    pub fn pointer_path(&self) -> PathBuf {
        self.scope_directory().join(crate::MANIFEST_POINTER)
    }
    /// Folder of the product named `key` under this job's scope.
    pub fn key_directory(&self, key: &str) -> PathBuf {
        self.scope_directory().join(key)
    }
}
