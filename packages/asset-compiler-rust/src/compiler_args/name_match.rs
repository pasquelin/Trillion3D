//! What a job's option names objects by on what the glTF already carries — a node's name, its
//! mesh's name, one of its primitives' material names, values its `extras` holds — as the
//! compiler reads it (`HlodWirePattern`, `HlodMatchOf`, `compilerAbi.ts`, which `nameMatch.ts`
//! writes): the HLOD's rules (`hlod.rs`) and the responsive objects (`materials.rs`) read it.
use super::*;
use crate::compiler_validate::{Fields, OPTIONS};
use regex_lite::Regex;

/// A pattern: the exact text, or a regular expression (`{"regex": source, "flags": …}` on the
/// wire, `HlodWirePattern`).
#[derive(Clone, Debug)]
pub enum Pattern {
    Exact(String),
    Regex(Regex),
}

impl Pattern {
    /// The regular expression `{"regex": source, "flags": flags}` names: flags `i`, `m`, `s` set
    /// inline, `g`, `u` and `y` meaning nothing to a single test. `i` on a source holding a letter
    /// past ASCII is refused: the engine folds ASCII letters only, where the host's own regular
    /// expression folds every letter (`nameMatch.ts` refuses it too).
    pub(super) fn regex(value: &Value, what: &str) -> Result<Self> {
        let map = OPTIONS.known(value, &["regex", "flags"], what)?;
        let source = OPTIONS.text(map.get("regex"), &format!("{what}.regex"))?;
        let flags = OPTIONS.optional(map.get("flags"), &format!("{what}.flags"), Fields::text)?;
        let mut inline = String::new();
        for flag in flags.unwrap_or("").chars() {
            match flag {
                'i' | 'm' | 's' => inline.push(flag),
                'g' | 'u' | 'y' => {}
                _ => {
                    return Err(
                        OPTIONS.bad(format!("{what}: flag {flag} is not supported (i, m, s)"))
                    )
                }
            }
        }
        if inline.contains('i') && !source.is_ascii() {
            return Err(OPTIONS.bad(format!(
                "{what}: flag i folds ASCII letters only; write both cases in /{source}/"
            )));
        }
        let full = if inline.is_empty() {
            source.to_string()
        } else {
            format!("(?{inline}){source}")
        };
        Regex::new(&full).map(Self::Regex).map_err(|e| {
            OPTIONS.bad(format!(
                "{what}: /{source}/ is not a regular expression: {e}"
            ))
        })
    }

    /// The pattern `value` names: a text the exact text, an object a regular expression.
    pub(super) fn of(value: &Value, what: &str) -> Result<Self> {
        match value {
            Value::String(text) => Ok(Self::Exact(text.clone())),
            Value::Object(_) => Self::regex(value, what),
            _ => Err(OPTIONS.bad(format!("{what} must be a name or {{\"regex\": …}}"))),
        }
    }

    pub(super) fn matches(&self, text: &str) -> bool {
        match self {
            Self::Exact(exact) => exact == text,
            Self::Regex(regex) => regex.is_match(text),
        }
    }
}

/// What a match names: a node's name, its mesh's name, one of its primitives' material names,
/// and values its `extras` holds — a regular expression for a text, else the exact value.
#[derive(Clone, Debug, Default)]
pub struct NameMatch {
    node: Option<Pattern>,
    mesh: Option<Pattern>,
    material: Option<Pattern>,
    extras: Vec<(String, std::result::Result<Pattern, Value>)>,
}

/// A job field's value, none when it is left out or `null`: the one reading of an absent option
/// every reader of a job's JSON shares (`hlod.rs`, `materials.rs`, and the TypeScript forms).
pub(super) fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}

/// The fields a match may hold.
const MATCH_FIELDS: [&str; 4] = ["node", "mesh", "material", "extras"];

/// What published node `node` of `g` is named by: its name, its mesh's, its primitives' materials
/// — each its rank and its name, if it has one —, and its `extras`.
pub struct NodeNames<'a> {
    pub node: Option<&'a str>,
    pub mesh: Option<&'a str>,
    pub materials: Vec<(usize, Option<&'a str>)>,
    pub extras: Option<&'a Value>,
}

/// The name an entry of the glTF carries, if any.
pub(super) fn name_of(v: Option<&Value>) -> Option<&str> {
    v.and_then(|v| v.get("name")).and_then(Value::as_str)
}

impl<'a> NodeNames<'a> {
    /// The names of published node `node` of `g`.
    pub fn of(g: &'a Value, node: usize) -> Self {
        let at = |pointer: String| g.pointer(&pointer);
        let entry = at(format!("/nodes/{node}"));
        let mesh = entry
            .and_then(|n| n.get("mesh"))
            .and_then(Value::as_u64)
            .and_then(|m| at(format!("/meshes/{m}")));
        let materials = mesh
            .and_then(|m| m.get("primitives"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|p| p.get("material").and_then(Value::as_u64))
            .map(|m| (m as usize, name_of(at(format!("/materials/{m}")))))
            .collect();
        Self {
            node: name_of(entry),
            mesh: name_of(mesh),
            materials,
            extras: entry.and_then(|n| n.get("extras")),
        }
    }
}

impl NameMatch {
    /// The match of the nodes `pattern` names.
    pub fn node(pattern: Pattern) -> Self {
        Self {
            node: Some(pattern),
            ..Self::default()
        }
    }

    /// The match a job field naming objects holds (`responsive`, `voxelize`): a name or a regular
    /// expression a node's, as a match names it, else a match (`read`).
    pub fn option(value: &Value, field: &str) -> Result<Self> {
        match value.is_string() || value.get("regex").is_some() {
            true => Ok(Self::node(Pattern::of(value, field)?)),
            false => Self::read(value, field),
        }
    }

    /// The match `value` names; one naming nothing — which would take every object — refused.
    pub fn read(value: &Value, what: &str) -> Result<Self> {
        let map = OPTIONS.known(value, &MATCH_FIELDS, what)?;
        let pattern = |key: &str| {
            let what = format!("{what}.{key}");
            OPTIONS.optional(map.get(key), &what, |_, value, what| {
                Pattern::of(value.unwrap_or(&Value::Null), what)
            })
        };
        let extras = present(map.get("extras"))
            .map(|extras| {
                (OPTIONS.object(extras, &format!("{what}.extras"))?.iter())
                    .map(|(key, value)| {
                        let wanted = match value {
                            Value::Object(_) => {
                                Ok(Pattern::regex(value, &format!("{what}.extras.{key}"))?)
                            }
                            other => Err(other.clone()),
                        };
                        Ok((key.clone(), wanted))
                    })
                    .collect::<Result<_>>()
            })
            .transpose()?
            .unwrap_or_default();
        let matched = Self {
            node: pattern("node")?,
            mesh: pattern("mesh")?,
            material: pattern("material")?,
            extras,
        };
        let names = [&matched.node, &matched.mesh, &matched.material];
        if names.iter().all(|p| p.is_none()) && matched.extras.is_empty() {
            return Err(OPTIONS.bad(format!(
                "{what} matches every object: name a node, mesh, material or extras"
            )));
        }
        Ok(matched)
    }

    /// Whether the object `names` describes matches every field named.
    pub fn matches(&self, names: &NodeNames) -> bool {
        let name = |pattern: &Option<Pattern>, value: Option<&str>| {
            (pattern.as_ref()).is_none_or(|p| value.is_some_and(|v| p.matches(v)))
        };
        name(&self.node, names.node)
            && name(&self.mesh, names.mesh)
            && (self.material.is_none() || self.materials(names).next().is_some())
            && self.extras.iter().all(|(key, wanted)| {
                let held = names.extras.and_then(|e| e.get(key));
                match (wanted, held) {
                    (Ok(pattern), Some(Value::String(s))) => pattern.matches(s),
                    (Err(value), Some(held)) => held == value,
                    _ => false,
                }
            })
    }

    /// The ranks of the materials a matched object's primitives wear that the match takes: all of
    /// them, or only those its `material` pattern names where it has one.
    pub fn materials<'n>(&'n self, names: &'n NodeNames<'n>) -> impl Iterator<Item = usize> + 'n {
        (names.materials.iter())
            .filter(|(_, name)| {
                (self.material.as_ref()).is_none_or(|p| name.is_some_and(|m| p.matches(m)))
            })
            .map(|&(rank, _)| rank)
    }
}
