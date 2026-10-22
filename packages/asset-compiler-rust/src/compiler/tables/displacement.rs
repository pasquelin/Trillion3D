//! The displacement a glTF material names in its `extras` (`DISPLACEMENT_EXTRA`), written in the
//! engine's own words into its entry of the material table: the slot of its height map, its
//! magnitude, its centre and its fade range. glTF has no displacement map of its own, so this is
//! the one source of it. Every default is the reference's: a magnitude of 4, a centre of one half,
//! a fade starting at 4 pixels and gone at 1 — and a material is displaced only when it names the
//! map AND switches its tessellation on, which it does not by default.
//!
//! A material that names none, or leaves its tessellation off, gets no `displacement` field at all:
//! its entry, and so the product, is the one it was before the option existed. A value that does
//! not read is the job's refusal (`INVALID_OPTIONS`), naming the material and the field.
use super::materials::slot;
use super::*;
use crate::compiler::validate::{Fields, OPTIONS};

/// One bound of a fade range, `what` naming it: a finite number above 0, `default` when left out.
fn fade_bound(value: Option<&Value>, default: f64, what: &str) -> Result<f64> {
    match value {
        None | Some(Value::Null) => Ok(default),
        Some(bound) => OPTIONS.bounded(
            bound,
            what,
            (f64::MIN_POSITIVE, f64::MAX),
            "a finite number above 0",
        ),
    }
}

/// The fade range `value` names, `what` naming it: none for `false` or nothing, the default range
/// for `true`, else an object holding only `DISPLACEMENT_FADE_KEYS`, each bound above 0.
fn fade_range(value: Option<&Value>, what: &str) -> Result<Option<[f64; 2]>> {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => Ok(None),
        Some(Value::Bool(true)) => Ok(Some([
            DEFAULT_DISPLACEMENT_FADE_START,
            DEFAULT_DISPLACEMENT_FADE_END,
        ])),
        Some(range) => {
            let map = OPTIONS.known(range, &DISPLACEMENT_FADE_KEYS, what)?;
            let [start_key, end_key] = DISPLACEMENT_FADE_KEYS;
            Ok(Some([
                fade_bound(
                    map.get(start_key),
                    DEFAULT_DISPLACEMENT_FADE_START,
                    &format!("{what}.{start_key}"),
                )?,
                fade_bound(
                    map.get(end_key),
                    DEFAULT_DISPLACEMENT_FADE_END,
                    &format!("{what}.{end_key}"),
                )?,
            ]))
        }
    }
}

/// The `displacement` object of material `m`, none for a material that is not displaced.
fn named(m: &Value) -> Option<&Value> {
    m.get("extras")?
        .get(DISPLACEMENT_EXTRA)
        .filter(|value| !value.is_null())
}

/// The height map a displaced material reads: its `textureInfo`, `None` for a material whose
/// `displacement` does not switch its tessellation on or names no map. The texture stage bakes
/// that image as a data texture beside the metallic-roughness and normal maps
/// (`texture/collect.rs`).
pub(crate) fn height_map(m: &Value) -> Option<&Value> {
    let displacement = named(m)?;
    let on = displacement
        .get(DISPLACEMENT_KEYS[1])
        .and_then(Value::as_bool)?;
    on.then(|| displacement.get(DISPLACEMENT_KEYS[0]))?
}

/// The displacement of glTF material `m` as its table entry carries it —
/// `{ "map": slot, "magnitude", "center", "fade": { "start", "end" } | null }` —, `None` for a
/// material that names none or leaves its tessellation off; `Err` with the job's refusal when
/// `displacement` does not read, or switches the tessellation on without naming a map.
pub(super) fn displacement(m: &Value) -> Result<Option<Value>> {
    let Some(value) = named(m) else {
        return Ok(None);
    };
    let what = format!("the {DISPLACEMENT_EXTRA} of material \"{}\"", name_of(m));
    let map = OPTIONS.known(value, &DISPLACEMENT_KEYS, &what)?;
    let [texture_key, tessellation_key, magnitude_key, center_key, fade_key] = DISPLACEMENT_KEYS;
    let on = OPTIONS
        .optional(
            map.get(tessellation_key),
            &format!("{what}.{tessellation_key}"),
            Fields::boolean,
        )?
        .unwrap_or(false);
    // The reference's material has no displacement until its tessellation is on.
    if !on {
        return Ok(None);
    }
    let map_slot = slot(map.get(texture_key).filter(|texture| !texture.is_null()));
    if map_slot.is_null() {
        return Err(OPTIONS.bad(format!(
            "{what} switches {tessellation_key} on and names no {texture_key} with an index"
        )));
    }
    let number = |key: &str, default: f64, range: (f64, f64), takes: &str| match map.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(field) => OPTIONS.bounded(field, &format!("{what}.{key}"), range, takes),
    };
    let magnitude = number(
        magnitude_key,
        DEFAULT_DISPLACEMENT_MAGNITUDE,
        (0.0, f64::MAX),
        "a finite number of at least 0",
    )?;
    let center = number(
        center_key,
        DEFAULT_DISPLACEMENT_CENTER,
        (0.0, 1.0),
        "a number from 0 to 1",
    )?;
    let fade = fade_range(map.get(fade_key), &format!("{what}.{fade_key}"))?
        .map(|[start, end]| json!({"start": start, "end": end}));
    Ok(Some(json!({
        "map": map_slot,
        "magnitude": magnitude,
        "center": center,
        "fade": fade,
    })))
}
