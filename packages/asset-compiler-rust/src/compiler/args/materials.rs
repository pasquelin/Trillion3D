//! A job's temporal anti-aliasing settings as the compiler reads them (`materialOptions.ts` writes
//! them): the scene's level (`temporalAntialiasing`), written at the top of the manifest only when
//! the job names it, and the one resolution that gives each material of the scene its responsive
//! level (`MaterialOptions::responsive_levels`): how far the temporal anti-aliasing trusts the
//! history on its pixels, a name of `RESPONSIVE_LEVELS`, `off` the normal accumulation. By
//! precedence, the first that names it:
//! 1. the `responsive` the `materials` setting names for it by its exact name: a level, `true` for
//!    `DEFAULT_RESPONSIVE_LEVEL`, `false` for `off`;
//! 2. the `responsive` match — the materials of every object it matches, only those its `material`
//!    pattern names where it has one —: `DEFAULT_RESPONSIVE_LEVEL`;
//! 3. its own `extras`' `responsive` (`RESPONSIVE_EXTRA`): a level, `true` or `false` as in 1;
//! 4. `off`.
//!
//! Each material's sky property (`MaterialOptions::sky_flags`), the material of a sky dome mesh, is
//! resolved the same way, the first that names it: the `sky` the `materials` setting names for it
//! by its exact name (a boolean), then its own `extras`' `sky` (`SKY_EXTRA`, a boolean; one that is
//! no boolean is ignored and told as a `SKY_EXTRA_IGNORED` warning), then `false`.
//!
//! A job naming none of the options compiles as before, its cache key unchanged. Read and checked
//! here once; what does not read is the job's refusal (`INVALID_OPTIONS`,
//! `validate_compile_options`), never the batch's. A material's own `extras` is the scene
//! document's free data, not the job's: a `responsive` there that is no level is ignored, the
//! material left at the level the rules below it give, and told as a warning
//! (`RESPONSIVE_EXTRA_IGNORED`).
use super::name_match::{name_of, present, NameMatch, NodeNames};
use super::*;
use crate::compiler::validate::OPTIONS;

/// The level `value` names among `levels`, `what` naming it: one of them by its name, `true` the
/// level `default`, `false` the first, `off`.
fn level_among(
    value: &Value,
    levels: &[&'static str],
    default: &'static str,
    what: &str,
) -> Result<&'static str> {
    match value {
        Value::Bool(true) => Some(default),
        Value::Bool(false) => levels.first().copied(),
        Value::String(word) => levels.iter().copied().find(|l| *l == word.as_str()),
        _ => None,
    }
    .ok_or_else(|| {
        OPTIONS.bad(format!(
            "{what} must be one of {}, true or false, got {value}",
            levels.join(", ")
        ))
    })
}

/// The responsive level `value` names, `what` naming it.
fn responsive_level(value: &Value, what: &str) -> Result<&'static str> {
    level_among(value, &RESPONSIVE_LEVELS, DEFAULT_RESPONSIVE_LEVEL, what)
}

/// A job's temporal anti-aliasing settings: the scene's level, the responsive match, the levels
/// by material name, and what named them, its cache identity.
#[derive(Clone, Debug, Default)]
pub struct MaterialOptions {
    pub(crate) level: Option<&'static str>,
    responsive: Option<NameMatch>,
    pub(crate) named: Vec<(String, &'static str)>,
    sky_named: Vec<(String, bool)>,
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
            out.level = Some(level_among(
                value,
                &TEMPORAL_AA_LEVELS,
                DEFAULT_TEMPORAL_AA_LEVEL,
                TEMPORAL_AA_FIELD,
            )?);
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
                if let Some(setting) = present(map.get(RESPONSIVE_EXTRA)) {
                    let level = responsive_level(setting, &format!("{what}.{RESPONSIVE_EXTRA}"))?;
                    out.named.push((name.clone(), level));
                }
                if let Some(setting) = present(map.get(SKY_EXTRA)) {
                    let sky = OPTIONS.boolean(Some(setting), &format!("{what}.{SKY_EXTRA}"))?;
                    out.sky_named.push((name.clone(), sky));
                }
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

    /// The responsive level of each material of `g`, by its rank: the one resolution, by the
    /// precedence the module states, and the warnings of the `extras` it ignored.
    pub fn responsive_levels(&self, g: &Value) -> (Vec<&'static str>, Vec<Value>) {
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
        let mut ignored = Vec::new();
        let levels = (materials.iter().zip(matched).enumerate())
            .map(|(rank, (material, matched))| {
                let name = name_of(Some(material));
                if let Some((_, level)) = name.and_then(|n| self.named.iter().find(|(m, _)| m == n))
                {
                    return *level;
                }
                if matched {
                    return DEFAULT_RESPONSIVE_LEVEL;
                }
                match present(material.get("extras").and_then(|e| e.get(RESPONSIVE_EXTRA))) {
                    Some(value) => {
                        let label =
                            name.map_or(format!("material {rank}"), |n| format!("material {n}"));
                        responsive_level(value, &format!("{label}: extras.{RESPONSIVE_EXTRA}"))
                            .unwrap_or_else(|why| {
                                ignored.push(json!({"code": "RESPONSIVE_EXTRA_IGNORED",
                                    "material": rank, "message": why.message}));
                                RESPONSIVE_LEVELS[0]
                            })
                    }
                    None => RESPONSIVE_LEVELS[0],
                }
            })
            .collect();
        (levels, ignored)
    }
    /// The sky property of each material of `g`, by its rank: the one resolution, by the precedence
    /// the module states, and the warnings of the `extras` it ignored.
    pub fn sky_flags(&self, g: &Value) -> (Vec<bool>, Vec<Value>) {
        let materials = g
            .get("materials")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        let mut ignored = Vec::new();
        let flags = (materials.iter().enumerate())
            .map(|(rank, material)| {
                let name = name_of(Some(material));
                if let Some((_, sky)) = name.and_then(|n| self.sky_named.iter().find(|(m, _)| m == n))
                {
                    return *sky;
                }
                match present(material.get("extras").and_then(|e| e.get(SKY_EXTRA))) {
                    Some(Value::Bool(sky)) => *sky,
                    Some(value) => {
                        let label =
                            name.map_or(format!("material {rank}"), |n| format!("material {n}"));
                        ignored.push(json!({"code": "SKY_EXTRA_IGNORED", "material": rank,
                            "message": format!("{label}: extras.{SKY_EXTRA} must be a boolean, got {value}")}));
                        false
                    }
                    None => false,
                }
            })
            .collect();
        (flags, ignored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The sky property by precedence: the job's name, then the material's own `extras`, then false;
    /// an `extras.sky` that is no boolean is ignored and told.
    #[test]
    fn sky_property_follows_the_precedence() {
        let scene = json!({"materials": [
            {"name": "dome", "extras": {"sky": true}},
            {"name": "forced off", "extras": {"sky": true}},
            {"name": "named on"},
            {"name": "plain"},
            {"name": "bad", "extras": {"sky": "yes"}},
        ]});
        let settings = json!({"forced off": {"sky": false}, "named on": {"sky": true}});
        let options = MaterialOptions::read(None, None, Some(&settings)).expect("settings read");
        let (flags, ignored) = options.sky_flags(&scene);
        assert_eq!(flags, vec![true, false, true, false, false]);
        assert_eq!(ignored.len(), 1);
        assert_eq!(ignored[0]["code"], "SKY_EXTRA_IGNORED");
        let refused = MaterialOptions::read(None, None, Some(&json!({"dome": {"sky": "yes"}})));
        assert!(refused.is_err());
    }
}
