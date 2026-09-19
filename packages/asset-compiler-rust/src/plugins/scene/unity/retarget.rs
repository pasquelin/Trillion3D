//! Shifting table references of a glTF document poured into another.
//!
//! A model yields a complete glTF, and its tables name each other by ranks that only make sense
//! in it. Pouring it into the scene is copying those tables after the scene's, so shifting
//! **all** those ranks — not only those we had in view. A forgotten reference does not become
//! empty: it names another model's row, and the scene then reads bytes that are not its own.
//! The shift rule lives here, and nowhere else.
use super::*;

/// Where a table rank is read in a subtree of the document.
pub(super) enum Slot<'a> {
    /// Value of this exact key, at whatever depth it is found: that is what makes both views of
    /// a sparse accessor follow its direct view.
    Key(&'a str),
    /// The `index` field of any key ending with this suffix: that is how a material names its
    /// textures, `baseColorTexture` as `normalTexture`.
    Suffix(&'a str),
    /// Every value of the object this key carries, or of each object of that array: attribute
    /// names — `POSITION`, `TEXCOORD_0` — belong to the document, not to the format.
    Members(&'a str),
}

/// Where to read a rank, and the scene table it must point to.
pub(super) struct Rule<'a> {
    pub(super) slot: Slot<'a>,
    pub(super) map: &'a [usize],
}

impl<'a> Rule<'a> {
    pub(super) fn key(name: &'a str, map: &'a [usize]) -> Rule<'a> {
        Rule {
            slot: Slot::Key(name),
            map,
        }
    }
    pub(super) fn suffix(name: &'a str, map: &'a [usize]) -> Rule<'a> {
        Rule {
            slot: Slot::Suffix(name),
            map,
        }
    }
    pub(super) fn members(name: &'a str, map: &'a [usize]) -> Rule<'a> {
        Rule {
            slot: Slot::Members(name),
            map,
        }
    }
}

/// Shifts, in the whole subtree, every rank these rules name.
pub(super) fn retarget(value: &mut Value, rules: &[Rule<'_>]) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(|item| retarget(item, rules)),
        Value::Object(fields) => {
            let names: Vec<String> = fields.keys().cloned().collect();
            for rule in rules {
                for name in &names {
                    apply(fields, name, rule);
                }
            }
            fields.values_mut().for_each(|item| retarget(item, rules));
        }
        _ => {}
    }
}

/// A rule on a field of this object.
fn apply(fields: &mut serde_json::Map<String, Value>, name: &str, rule: &Rule<'_>) {
    match rule.slot {
        Slot::Key(key) if key == name => shift(fields, name, rule.map),
        Slot::Suffix(suffix) if name.ends_with(suffix) => {
            if let Some(info) = fields.get_mut(name).and_then(Value::as_object_mut) {
                shift(info, "index", rule.map);
            }
        }
        Slot::Members(key) if key == name => {
            if let Some(item) = fields.get_mut(name) {
                members(item, rule.map);
            }
        }
        _ => {}
    }
}

/// Shifts the rank this key carries. A missing key does nothing; a rank the model's table does
/// not carry names nothing in the scene, and its key is removed rather than left pointing at a
/// neighbour's row.
fn shift(fields: &mut serde_json::Map<String, Value>, key: &str, map: &[usize]) {
    let Some(item) = fields.get(key) else {
        return;
    };
    match index(item, map) {
        Some(rank) => {
            fields.insert(key.to_string(), json!(rank));
        }
        None => {
            fields.remove(key);
        }
    }
}

/// Ranks an object whose field names belong to the document carries, or each object of an
/// array — an attribute set, a list of morph targets.
fn members(value: &mut Value, map: &[usize]) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(|item| members(item, map)),
        Value::Object(fields) => {
            for name in fields.keys().cloned().collect::<Vec<String>>() {
                shift(fields, &name, map);
            }
        }
        _ => {}
    }
}
