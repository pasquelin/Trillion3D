//! The command line's forms and its usage: the fields each short form leaves out
//! (`SHORT_FORMS`), and the usage line spelled from them and from every flag a job field takes
//! (`usage`), which a command line of no form is refused with.
use super::texture_formats::{texture_format_choices, TEXTURE_FORMAT_OPTION};
use crate::hair_strands::abi::{HAIR_STRANDS_ENDING_POINT_OPTION, HAIR_STRANDS_GROUPS_OPTION};
use crate::volumetric_lightmap::bake::abi::LIGHTMAP_BAKE_OPTION;
use crate::*;

/// The fields each form of the command line leaves out, the full form first: a short form
/// leaves out `simplification`, then `threads` and `ramBudgetMb` too (`abi.rs`).
pub(super) const SHORT_FORMS: [&[&str]; 3] = [
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
pub(super) fn usage() -> String {
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
        "Usage: trillion3d-compiler {} [{TEXTURE_FORMAT_OPTION}{}] [{HLOD_OPTION}JSON] [{TEMPORAL_AA_OPTION}{}|true|false] [{RESPONSIVE_OPTION}JSON] [{MATERIALS_OPTION}JSON] [{VOXELIZE_OPTION}JSON] [{PARTITION_SCHEME_OPTION}{}|true] [{PARTITION_GRID_OPTION}JSON] [{PARTITION_GRIDS_OPTION}JSON] [{MESH_BUILD_OPTION}JSON] [{OBJECT_SETTINGS_OPTION}JSON] [{LIGHTMAP_BAKE_OPTION}JSON|true|false] [{HAIR_STRANDS_ENDING_POINT_OPTION}true|false] [{HAIR_STRANDS_GROUPS_OPTION}JSON]\n       trillion3d-compiler --jobs FILE|-\n       {} is a directory or a file in one of the formats --version lists",
        line.join(" "),
        texture_format_choices().join("|"),
        TEMPORAL_AA_LEVELS.join("|"),
        PARTITION_SCHEMES.join("|"),
        job_field::SOURCE
    )
}
