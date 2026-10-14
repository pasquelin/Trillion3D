use super::*;
use serde_json::Map;
use texture_formats::{
    texture_format_choices, texture_formats, ALL_TEXTURE_FORMATS, TEXTURES_FORMAT_FIELD,
    TEXTURE_FORMAT_OPTION,
};

mod texture_formats;

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

/// The one reading of a compile job, whichever form named it: a batch file's job object, or the
/// command line's values keyed by `JOB_FIELDS`. A key outside `JOB_FIELDS`, `id` and
/// `texturesFormat`, or a text field holding another type, is refused by name: a misspelt or
/// mistyped field never cooks at its default unannounced. The values are checked by `compile`.
pub fn job_options(
    job: &Map<String, Value>,
    defaults: &JobDefaults,
    cancelled: Arc<AtomicBool>,
) -> std::result::Result<Options, String> {
    for (key, value) in job {
        let key = key.as_str();
        if !JOB_FIELDS.contains(&key) && key != ID_FIELD && key != TEXTURES_FORMAT_FIELD {
            return Err(format!("unknown job field {key}"));
        }
        if !NUMBER_FIELDS.contains(&key) && !value.is_string() && !value.is_null() {
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
            text(TEXTURES_FORMAT_FIELD).unwrap_or(ALL_TEXTURE_FORMATS),
        )?,
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
        "Usage: trillion3d-compiler {} [{TEXTURE_FORMAT_OPTION}{}]\n       trillion3d-compiler --jobs FILE|-\n       {} is a directory or a file in one of the formats --version lists",
        line.join(" "),
        texture_format_choices().join("|"),
        job_field::SOURCE
    )
}

/// The command line's job: its values in `JOB_FIELDS` order, read as a batch of one reads its job.
pub fn parse_compiler_args(
    args: &[String],
    cancelled: Arc<AtomicBool>,
) -> std::result::Result<Options, String> {
    let (flags, args): (Vec<String>, Vec<String>) = args
        .iter()
        .cloned()
        .partition(|arg| arg.starts_with(TEXTURE_FORMAT_OPTION));
    let left_out = SHORT_FORMS
        .iter()
        .find(|out| out.len() + args.len() == JOB_FIELDS.len())
        .ok_or_else(usage)?;
    let mut job: Map<String, Value> = JOB_FIELDS
        .iter()
        .filter(|field| !left_out.contains(*field))
        .zip(&args)
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
    let defaults = JobDefaults {
        scope: SCOPES[0],
        threads: DEFAULT_THREADS,
        ram_budget_mb: DEFAULT_RAM_BUDGET_MB,
    };
    job_options(&job, &defaults, cancelled)
}

impl Options {
    /// This job's RAM budget in bytes, `ramBudgetMb`; past what a `usize` counts, no bound.
    pub fn ram_budget_bytes(&self) -> usize {
        self.ram_budget_mb.saturating_mul(1024 * 1024)
    }
    /// Folder of this job's scope in the cache: its pointer, and one folder per key.
    pub fn scope_directory(&self) -> PathBuf {
        self.cache.join("native").join(&self.scope)
    }
    /// Folder of the product named `key` under this job's scope.
    pub fn key_directory(&self, key: &str) -> PathBuf {
        self.scope_directory().join(key)
    }
}
