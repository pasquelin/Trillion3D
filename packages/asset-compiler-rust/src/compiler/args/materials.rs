//! A job's temporal anti-aliasing settings as the compiler reads them (`materialOptions.ts` writes
//! them): the scene's level (`temporalAntialiasing`), written at the top of the manifest only when
//! the job names it, and the one resolution that gives each material of the scene its history
//! share (`MaterialOptions::history_shares`): the most of its history the temporal anti-aliasing
//! keeps on its pixels, 1 the engine's own blend. By precedence, the first that names it:
//! 1. the `temporalAntialiasing` the `materials` setting names for it by its exact name;
//! 2. its `responsive` there: `true` the responsive share, `false` taking it out of the responsive
//!    shortcuts below (the match and its own `responsive` extra);
//! 3. the `responsive` match — the materials of every object it matches, only those its `material`
//!    pattern names where it has one —: the responsive share;
//! 4. its own `extras`' `temporalAntialiasing` (`TEMPORAL_AA_EXTRA`);
//! 5. its own `extras`' `responsive: true` (`RESPONSIVE_EXTRA`): the responsive share;
//! 6. 1.
//!
//! A share is a number in [0, 1] or a name of `TEMPORAL_AA_SHARES`. A job naming none of the
//! options compiles as before, its cache key unchanged. Read and checked here once; what does not
//! read is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`), never the batch's —
//! an `extras` share that does not read included, when the shares are resolved.
use super::name_match::{name_of, present, NameMatch, NodeNames};
use super::*;
use crate::compiler::validate::OPTIONS;

/// The share `name` names in `TEMPORAL_AA_SHARES`, if it is one.
fn named_share(name: &str) -> Option<f64> {
    TEMPORAL_AA_SHARES
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, share)| *share)
}

/// The history share `value` names, `what` naming it: a number in [0, 1] or a name of
/// `TEMPORAL_AA_SHARES`.
fn share_of(value: &Value, what: &str) -> Result<f64> {
    match (value.as_str().and_then(named_share), value.as_f64()) {
        (Some(share), _) => Ok(share),
        (None, Some(share)) if (0.0..=1.0).contains(&share) => Ok(share),
        _ => {
            let names: Vec<&str> = TEMPORAL_AA_SHARES.iter().map(|(n, _)| *n).collect();
            Err(OPTIONS.bad(format!(
                "{what} must be a number from 0 to 1 or one of {}, got {value}",
                names.join(", ")
            )))
        }
    }
}

/// What the `materials` setting names for one material: its history share, its `responsive`.
#[derive(Clone, Debug, Default)]
pub(crate) struct Named {
    share: Option<f64>,
    responsive: Option<bool>,
}

/// A job's temporal anti-aliasing settings: the scene's level, the responsive match, the settings
/// by material name, and what named them, its cache identity.
#[derive(Clone, Debug, Default)]
pub struct MaterialOptions {
    pub(crate) level: Option<&'static str>,
    responsive: Option<NameMatch>,
    pub(crate) named: Vec<(String, Named)>,
    identity: Map<String, Value>,
}

impl MaterialOptions {
    /// The settings the job's `temporalAntialiasing`, `responsive` and `materials` fields name,
    /// none for none; `Err` with the job's refusal when they do not read.
    pub fn read(
        level: Option<&Value>,
        responsive: Option<&Value>,
        materials: Option<&Value>,
    ) -> std::result::Result<Self, String> {
        Self::parse(level, responsive, materials).map_err(|e| e.message)
    }

    pub(crate) fn parse(
        level: Option<&Value>,
        responsive: Option<&Value>,
        materials: Option<&Value>,
    ) -> Result<Self> {
        let mut out = Self::default();
        if let Some(value) = present(level) {
            let word = match value {
                Value::Bool(true) => Some(DEFAULT_TEMPORAL_AA_LEVEL),
                Value::Bool(false) => Some(TEMPORAL_AA_LEVELS[0]),
                Value::String(word) => TEMPORAL_AA_LEVELS
                    .iter()
                    .copied()
                    .find(|l| *l == word.as_str()),
                _ => None,
            };
            out.level = Some(word.ok_or_else(|| {
                OPTIONS.bad(format!(
                    "{TEMPORAL_AA_FIELD} must be one of {}, true or false, got {value}",
                    TEMPORAL_AA_LEVELS.join(", ")
                ))
            })?);
            // The level resolved, not its spelling: `true` and `"max"` are one product, one key.
            out.identity
                .insert(TEMPORAL_AA_FIELD.into(), Value::from(out.level));
        }
        if let Some(value) = present(responsive) {
            out.responsive = Some(NameMatch::option(value, RESPONSIVE_FIELD)?);
            out.identity.insert(RESPONSIVE_FIELD.into(), value.clone());
        }
        if let Some(value) = present(materials) {
            for (name, settings) in OPTIONS.object(value, MATERIALS_FIELD)? {
                let what = format!("{MATERIALS_FIELD}.{name}");
                let map = OPTIONS.known(settings, &MATERIAL_SETTINGS, &what)?;
                let share = present(map.get(TEMPORAL_AA_EXTRA))
                    .map(|v| share_of(v, &format!("{what}.{TEMPORAL_AA_EXTRA}")))
                    .transpose()?;
                let responsive = present(map.get(RESPONSIVE_EXTRA))
                    .map(|v| OPTIONS.boolean(Some(v), &format!("{what}.{RESPONSIVE_EXTRA}")))
                    .transpose()?;
                out.named.push((name.clone(), Named { share, responsive }));
            }
            out.identity.insert(MATERIALS_FIELD.into(), value.clone());
        }
        Ok(out)
    }

    /// What named the settings, for the cache key: `None` when the job names none, so its key is
    /// the one it had before the options existed.
    pub fn identity(&self) -> Option<Value> {
        (!self.identity.is_empty()).then(|| Value::Object(self.identity.clone()))
    }

    /// The scene's temporal anti-aliasing level, written at the top of the manifest: none when
    /// the job names none.
    pub fn level(&self) -> Option<&'static str> {
        self.level
    }

    /// The history share of each material of `g`, by its rank: the one resolution, by the
    /// precedence the module states; `Err` when a material's own `extras` share does not read.
    pub fn history_shares(&self, g: &Value) -> Result<Vec<f64>> {
        let materials = g
            .get("materials")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        let mut matched = vec![false; materials.len()];
        if let Some(matcher) = &self.responsive {
            let nodes = g.get("nodes").and_then(Value::as_array).map_or(0, Vec::len);
            for node in 0..nodes {
                let names = NodeNames::of(g, node);
                if !matcher.matches(&names) {
                    continue;
                }
                for rank in matcher.materials(&names) {
                    if let Some(slot) = matched.get_mut(rank) {
                        *slot = true;
                    }
                }
            }
        }
        // The current image weighing at least a quarter, what `responsive` stands for.
        let responsive = named_share("responsive").expect("TEMPORAL_AA_SHARES names responsive");
        (materials.iter().zip(matched).enumerate())
            .map(|(rank, (material, matched))| {
                let named = name_of(Some(material))
                    .and_then(|n| self.named.iter().find(|(m, _)| m == n))
                    .map(|(_, named)| named.clone())
                    .unwrap_or_default();
                let extras = material.get("extras");
                let extra = |key: &str| present(extras.and_then(|e| e.get(key)));
                let shortcut = named.responsive != Some(false);
                if let Some(share) = named.share {
                    return Ok(share);
                }
                if named.responsive == Some(true) || (shortcut && matched) {
                    return Ok(responsive);
                }
                if let Some(value) = extra(TEMPORAL_AA_EXTRA) {
                    let label = name_of(Some(material))
                        .map_or(format!("material {rank}"), |n| format!("material {n}"));
                    return share_of(value, &format!("{label}: extras.{TEMPORAL_AA_EXTRA}"));
                }
                let asked = extra(RESPONSIVE_EXTRA) == Some(&Value::Bool(true));
                Ok(if shortcut && asked { responsive } else { 1.0 })
            })
            .collect()
    }
}
