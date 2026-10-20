use super::*;
use serde_json::Map;
use texture_formats::{
    texture_format_choices, texture_formats, DEFAULT_TEXTURE_FORMAT, TEXTURES_FORMAT_FIELD,
    TEXTURE_FORMAT_OPTION,
};

/// The threads of a job that names none: every core the machine offers, at most `MAX_THREADS`. A
/// job's threads are a bound: it runs as many workers as its memory budget holds (`plan_buffers`).
pub fn machine_threads() -> usize {
    std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(MAX_THREADS)
}

mod hlod;
mod materials;
mod name_match;
mod texture_formats;
pub use hlod::{marked, Hlod, HlodBuilder, HlodLayer, HlodLodSelection};
pub use materials::MaterialOptions;

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
/// anti-aliasing, the responsive objects and the settings by material name.
const JSON_FIELDS: [&str; 4] = [
    HLOD_FIELD,
    TEMPORAL_AA_FIELD,
    RESPONSIVE_FIELD,
    MATERIALS_FIELD,
];

/// The one reading of a compile job, whichever form named it: a batch file's job object, or the
/// command line's values keyed by `JOB_FIELDS`. A key outside `JOB_FIELDS`, `id`,
/// `texturesFormat` and `JSON_FIELDS`, or a text field holding another type, is refused by name: a
/// misspelt or mistyped field never cooks at its default unannounced. The values are checked by
/// `compile`; the HLOD's and the material settings' names and patterns are read here
/// (`Hlod::read`, `MaterialOptions::read`), what does not read refused with them.
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
        cancelled,
    })
}

/// The fields each form of the command line leaves out, the full form first: a short form
/// leaves out `simplification`, then `threads` and `ramBudgetMb` too (`abi.rs`).
const SHORT_FORMS: [&[&str]; 3] = [
    &[],
    &[job_field::SIMPLIFICATION],
    &[
        job_field::THREADS,
        job_field::RAM_BUDGET_MB,
        job_field::SIMPLIFICATION,
    ],
];

/// The command line's usage, spelled from `JOB_FIELDS` and `SHORT_FORMS`: the fields in order,
/// a run of fields the same short form first leaves out in one pair of brackets.
fn usage() -> String {
    let word = |field: &str| match field {
        job_field::SCOPE => SCOPES.join("|"),
        job_field::SIMPLIFICATION => SIMPLIFICATIONS.join("|"),
        _ => field.to_string(),
    };
    let mut runs: Vec<(Option<usize>, Vec<String>)> = Vec::new();
    for field in JOB_FIELDS {
        let form = SHORT_FORMS.iter().position(|out| out.contains(&field));
        match runs.last_mut() {
            Some((at, words)) if form.is_some() && *at == form => words.push(word(field)),
            _ => runs.push((form, vec![word(field)])),
        }
    }
    let line: Vec<String> = runs
        .into_iter()
        .map(|(form, words)| match form {
            Some(_) => format!("[{}]", words.join(" ")),
            None => words.join(" "),
        })
        .collect();
    format!(
        "Usage: trillion3d-compiler {} [{TEXTURE_FORMAT_OPTION}{}] [{HLOD_OPTION}JSON] [{TEMPORAL_AA_OPTION}{}|true|false] [{RESPONSIVE_OPTION}JSON] [{MATERIALS_OPTION}JSON]\n       trillion3d-compiler --jobs FILE|-\n       {} is a directory or a file in one of the formats --version lists",
        line.join(" "),
        texture_format_choices().join("|"),
        TEMPORAL_AA_LEVELS.join("|"),
        job_field::SOURCE
    )
}

/// The command line's job: its values in `JOB_FIELDS` order, read as a batch of one reads its job; an
/// empty value names nothing, so the field takes its default as a batch job that leaves it out.
pub fn parse_compiler_args(
    args: &[String],
    cancelled: Arc<AtomicBool>,
) -> std::result::Result<Options, String> {
    // The flags holding a job field's value, the last one of each kept: JSON, the scene's temporal
    // anti-aliasing a bare level too.
    let json_flags = [
        (HLOD_OPTION, HLOD_FIELD),
        (TEMPORAL_AA_OPTION, TEMPORAL_AA_FIELD),
        (RESPONSIVE_OPTION, RESPONSIVE_FIELD),
        (MATERIALS_OPTION, MATERIALS_FIELD),
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
                // A bare level is the scene's temporal anti-aliasing's text, which its reader
                // checks; any other flag that is not JSON is refused here, never read as a name.
                Err(_) if field == TEMPORAL_AA_FIELD => Value::from(raw),
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

impl Options {
    /// This job's HLOD, or its refusal (`INVALID_OPTIONS`) when it does not read.
    pub(crate) fn hlod(&self) -> crate::Result<&Hlod> {
        (self.hlod.as_ref())
            .map_err(|refusal| crate::CompilerError::new("INVALID_OPTIONS", refusal.clone()))
    }
    /// This job's material settings, or their refusal (`INVALID_OPTIONS`) when they do not read.
    pub(crate) fn materials(&self) -> crate::Result<&MaterialOptions> {
        (self.materials.as_ref())
            .map_err(|refusal| crate::CompilerError::new("INVALID_OPTIONS", refusal.clone()))
    }
    /// This job's RAM budget in bytes, `ramBudgetMb`; past what a `usize` counts, no bound.
    pub fn ram_budget_bytes(&self) -> usize {
        self.ram_budget_mb.saturating_mul(1024 * 1024)
    }
    /// Folder of this job's scope in the cache: its pointer, and one folder per key.
    pub fn scope_directory(&self) -> PathBuf {
        native_dir(&self.cache).join(&self.scope)
    }
    /// This job's scope pointer, the only stable entry of the cache (`compiler_publish::write_pointer`).
    pub fn pointer_path(&self) -> PathBuf {
        self.scope_directory().join(crate::MANIFEST_POINTER)
    }
    /// Folder of the product named `key` under this job's scope.
    pub fn key_directory(&self, key: &str) -> PathBuf {
        self.scope_directory().join(key)
    }
}
