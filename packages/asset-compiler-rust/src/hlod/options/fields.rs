//! The readers every builder's settings are read with: a number within its range, a whole number
//! within its range, a switch, a word among its values, a level — a word, `true` the default one,
//! `false` the first — and the maps an atlas bakes beside its base colour. Each refuses what does
//! not read with the job's refusal (`INVALID_OPTIONS`), naming the setting and what it admits.
use super::*;
use crate::compiler::args::name_match::present;
use crate::compiler::args::reader::Reader;
use crate::compiler::validate::{Fields, OPTIONS};
use crate::hlod::flatten::bake::Maps;

/// The fields a simplified layer's `maps` admits: the images baked beside the base colour, those
/// a proxy's transfer writes (no occlusion, no anisotropy: it has no step for them).
pub(super) const MAP_FIELDS: [&str; 7] = [
    "normal",
    "roughness",
    "metallic",
    "specular",
    "emissive",
    "opacity",
    "opacityMask",
];

/// The reader of `map` that names a setting `what.key` (`compiler::args::reader::Reader`: the one
/// reader of a number, a whole number and a switch the job's maps are read with).
fn reader<'a>(map: &'a Map<String, Value>, prefix: &'a str) -> Reader<'a> {
    Reader { map, what: prefix }
}

/// A number of `map` at `key`, its default when absent, refused outside `[low, high]`.
pub(super) fn ranged(
    map: &Map<String, Value>,
    key: &str,
    what: &str,
    (low, high): (f64, f64),
) -> Result<Option<f64>> {
    let takes = format!("a number from {low} to {high}");
    reader(map, &format!("{what}.")).number(key, (low, high), &takes)
}

/// A whole number of `map` at `key`, refused outside `[low, high]`.
pub(super) fn counted(
    map: &Map<String, Value>,
    key: &str,
    what: &str,
    (low, high): (usize, usize),
) -> Result<Option<usize>> {
    let takes = format!("a whole number from {low} to {high}");
    let bounds = (
        i64::try_from(low).unwrap_or(i64::MAX),
        i64::try_from(high).unwrap_or(i64::MAX),
    );
    let named = reader(map, &format!("{what}.")).whole(key, bounds, &takes)?;
    Ok(named.map(|n| n as usize))
}

/// A switch of `map` at `key`.
pub(super) fn switch(map: &Map<String, Value>, key: &str, what: &str) -> Result<Option<bool>> {
    reader(map, &format!("{what}.")).boolean(key)
}

/// Whether `map` names `key`: it holds it, and not as `null`.
pub(super) fn named(map: &Map<String, Value>, key: &str) -> bool {
    present(map.get(key)).is_some()
}

/// `value` stored in `into` when the job named one, `into` kept otherwise.
pub(super) fn set<T>(into: &mut T, value: Option<T>) {
    if let Some(value) = value {
        *into = value;
    }
}

/// The maps `entry` names baked beside the base colour (`what` naming it, its fields `fields`, a
/// subset of normal, roughness, metallic, specular, emissive, opacity, opacityMask,
/// ambientOcclusion, anisotropy and tangent), each switch it leaves out as `maps` holds it;
/// `maps` itself when it is absent or null. The opacity and the mask both write the base image's
/// alpha, which a material reads as one or the other: both named is refused.
pub(super) fn maps_with(
    entry: Option<&Value>,
    what: &str,
    mut maps: Maps,
    fields: &[&str],
) -> Result<Maps> {
    let Some(entry) = entry.filter(|v| !v.is_null()) else {
        return Ok(maps);
    };
    let what = format!("{what}.maps");
    let named = OPTIONS.known(entry, fields, &what)?;
    let switches: [(&str, &mut bool); 10] = [
        ("normal", &mut maps.normal),
        ("roughness", &mut maps.roughness),
        ("metallic", &mut maps.metallic),
        ("specular", &mut maps.specular),
        ("emissive", &mut maps.emissive),
        ("opacity", &mut maps.opacity),
        ("opacityMask", &mut maps.opacity_mask),
        ("ambientOcclusion", &mut maps.occlusion),
        ("anisotropy", &mut maps.anisotropy),
        ("tangent", &mut maps.tangent),
    ];
    for (key, held) in switches {
        if let Some(v) = switch(named, key, &what)? {
            *held = v;
        }
    }
    if maps.opacity && maps.opacity_mask {
        return Err(OPTIONS.bad(format!(
            "{what}: opacity and opacityMask both write the base image's alpha, which a \
             material reads as one or the other: name one"
        )));
    }
    Ok(maps)
}

/// The maps `entry` names baked beside a simplified layer's base colour (`MAP_FIELDS`,
/// `maps_with`).
pub(super) fn maps_of(entry: Option<&Value>, what: &str, maps: Maps) -> Result<Maps> {
    maps_with(entry, what, maps, &MAP_FIELDS)
}

/// The word of `map` at `key` among `words`, its rank.
pub(super) fn chosen(
    map: &Map<String, Value>,
    key: &str,
    what: &str,
    words: &[&str],
) -> Result<Option<usize>> {
    let Some(word) = OPTIONS.optional(map.get(key), &format!("{what}.{key}"), Fields::text)? else {
        return Ok(None);
    };
    (words.iter().position(|w| *w == word))
        .map(Some)
        .ok_or_else(|| OPTIONS.bad(format!("{what}.{key} must be one of {}", words.join(", "))))
}

/// The value of `map` at `key` among `kinds`, the one the word of the same rank in `words` names.
pub(super) fn chosen_of<T: Copy>(
    map: &Map<String, Value>,
    key: &str,
    what: &str,
    (words, kinds): (&[&str], &[T]),
) -> Result<Option<T>> {
    Ok(chosen(map, key, what, words)?.map(|rank| kinds[rank]))
}

/// The rank of `word` among `words`, if it is one.
fn rank(words: &[&str], word: &str) -> Option<usize> {
    words.iter().position(|&w| w == word)
}

/// The rank among its values `words` of `default`, an option's default (`level`).
pub(super) fn default_rank(words: &[&str], default: &str) -> usize {
    rank(words, default).expect("an option's default is one of its values")
}

/// The value of `all` at the rank `level` gives for `map` at `key`.
pub(super) fn levelled<T: Copy>(
    map: &Map<String, Value>,
    key: &str,
    what: &str,
    levels: (&[&str], &str),
    all: &[T],
) -> Result<T> {
    Ok(all[level(map, key, what, levels)?])
}

/// The rank among `words` of the value of `map` at `key`, an option of named values whose first
/// is the one `false` names and `default` the one `true` names (`compilerAbi.ts`): a word of
/// `words`, `true` or `false`; `default`'s when absent or null; refused otherwise, naming the
/// values.
fn level(
    map: &Map<String, Value>,
    key: &str,
    what: &str,
    (words, default): (&[&str], &str),
) -> Result<usize> {
    let named = match present(map.get(key)) {
        None | Some(Value::Bool(true)) => Some(default_rank(words, default)),
        Some(Value::Bool(false)) => Some(0),
        Some(Value::String(word)) => rank(words, word),
        Some(_) => None,
    };
    named.ok_or_else(|| {
        let value = map.get(key).unwrap_or(&Value::Null);
        OPTIONS.bad(format!(
            "{what}.{key} must be one of {}, true or false, got {value}",
            words.join(", ")
        ))
    })
}
