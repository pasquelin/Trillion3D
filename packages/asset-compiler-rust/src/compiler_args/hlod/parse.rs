//! The layers, marks and the option read.
use super::super::name_match::{present, NameMatch};
use super::*;
use super::{
    Hlod, HlodAssign, HlodBuilder, HlodLayer, HlodLodSelection, ASSIGN_FIELDS, HLOD_FIELDS,
    LAYER_FIELDS,
};
use crate::compiler_validate::{Fields, OPTIONS};

/// A layer setting of `layer` read as a number, `None` when absent; refused unless positive.
fn positive(layer: &Map<String, Value>, key: &str, what: &str) -> Result<Option<f64>> {
    let value = OPTIONS.optional(layer.get(key), &format!("{what}.{key}"), Fields::number)?;
    if value.is_some_and(|v| v <= 0.0) {
        return Err(OPTIONS.bad(format!("{what}.{key} must be positive")));
    }
    Ok(value)
}

/// Layer `entry` (`what` naming it), its parent's name apart: every field its builder admits read
/// and checked, the others refused.
pub(super) fn layer(entry: &Value, what: &str) -> Result<(HlodLayer, Option<String>)> {
    let map = OPTIONS.object(entry, what)?;
    let name = OPTIONS.text(map.get("name"), &format!("{what}.name"))?;
    if name.is_empty() {
        return Err(OPTIONS.bad(format!("{what}.name is empty")));
    }
    let word = OPTIONS.text(map.get("builder"), &format!("{what}.builder"))?;
    let builder = (HlodBuilder::ALL.into_iter())
        .find(|b| b.name() == word)
        .ok_or_else(|| {
            let choices = HLOD_BUILDERS.join(", ");
            OPTIONS.bad(format!(
                "{HLOD_FIELD} layer {name}: builder must be one of {choices}"
            ))
        })?;
    let admitted: Vec<&str> = LAYER_FIELDS
        .iter()
        .chain(builder.settings())
        .copied()
        .collect();
    let what = format!("{HLOD_FIELD} layer {name} ({word})");
    let map = OPTIONS.known(entry, &admitted, &what)?;
    let parent = OPTIONS.optional(map.get("parent"), &format!("{what}.parent"), Fields::text)?;
    let lod_selection = OPTIONS.optional(
        map.get("lodSelection"),
        &format!("{what}.lodSelection"),
        Fields::text,
    )?;
    let lod_selection = match lod_selection {
        None => HlodLodSelection::default(),
        Some(word) => (HlodLodSelection::ALL.into_iter())
            .find(|s| s.name() == word)
            .ok_or_else(|| {
                let choices = HLOD_LOD_SELECTIONS.join(" or ");
                OPTIONS.bad(format!("{what}.lodSelection must be {choices}"))
            })?,
    };
    let merge_materials = OPTIONS.optional(
        map.get("mergeMaterials"),
        &format!("{what}.mergeMaterials"),
        Fields::boolean,
    )?;
    let merge_materials = merge_materials.unwrap_or(false);
    // A merged layer that keeps its sources' materials bakes no atlas.
    let named = |key: &str| map.get(key).is_some_and(|v| !v.is_null());
    if builder == HlodBuilder::Merge && !merge_materials && named("textureSize") {
        return Err(OPTIONS.bad(format!("{what}: textureSize needs mergeMaterials")));
    }
    let texture_size = match OPTIONS.optional(
        map.get("textureSize"),
        &format!("{what}.textureSize"),
        Fields::index,
    )? {
        None => DEFAULT_HLOD_TEXTURE_SIZE,
        Some(size) => {
            let bounded = (MIN_HLOD_TEXTURE_SIZE..=MAX_HLOD_TEXTURE_SIZE).contains(&size);
            if !(bounded && size.is_power_of_two()) {
                return Err(OPTIONS.bad(format!(
                    "{what}.textureSize must be a power of two from {MIN_HLOD_TEXTURE_SIZE} to \
                     {MAX_HLOD_TEXTURE_SIZE}"
                )));
            }
            size
        }
    };
    let read = HlodLayer {
        name: name.to_string(),
        builder,
        parent: None,
        accuracy: positive(map, "accuracy", &what)?,
        accuracy_pixels: positive(map, "accuracyPixels", &what)?,
        deviation: positive(map, "deviation", &what)?,
        deviation_pixels: positive(map, "deviationPixels", &what)?,
        texture_size,
        lod_selection,
        merge_materials,
    };
    for (metres, pixels) in [
        ("accuracy", "accuracyPixels"),
        ("deviation", "deviationPixels"),
    ] {
        if named(metres) && named(pixels) {
            return Err(OPTIONS.bad(format!("{what}: give {metres} or {pixels}, not both")));
        }
    }
    Ok((read, parent.map(str::to_string)))
}

/// The mark node `entry`'s `extras` carries (`HLOD_MARK`), if any.
pub(super) fn mark_of(entry: Option<&Value>) -> Option<&Value> {
    (entry.and_then(|n| n.get("extras")))
        .and_then(|e| e.get(HLOD_MARK))
        .filter(|mark| !mark.is_null())
}

/// Whether published node `node` of `g` carries a mark (`HLOD_MARK`).
pub fn marked(g: &Value, node: usize) -> bool {
    mark_of(g.pointer(&format!("/nodes/{node}"))).is_some()
}

impl Hlod {
    /// The HLOD `value` names, none when absent; `Err` with the job's refusal when it does not
    /// read or does not form chains (`parse`).
    pub fn read(value: Option<&Value>) -> std::result::Result<Self, String> {
        match present(value) {
            None => Ok(Self::default()),
            Some(Value::Bool(_)) => Err(format!(
                "{HLOD_FIELD} must be an object: leave it out for no HLOD"
            )),
            Some(value) => Self::parse(value).map_err(|e| e.message),
        }
    }

    /// The HLOD `named` names, in one pass: names and parents resolved, settings admitted by
    /// builder and defaulted, patterns compiled, then the chains checked — no cycle; a layer that
    /// builds actors; each instanced layer with a parent that is not instanced, assigned objects
    /// by a rule or the default, its chain at most `MAX_HLOD_LEVELS`; each layer reached at one
    /// level from an instanced layer; every rule and the default naming an instanced layer.
    fn parse(named: &Value) -> Result<Self> {
        let map = OPTIONS.known(named, &HLOD_FIELDS, HLOD_FIELD)?;
        let listed = OPTIONS.array(
            map.get("layers").unwrap_or(&Value::Null),
            &format!("{HLOD_FIELD}.layers"),
        )?;
        if listed.is_empty() {
            return Err(OPTIONS.bad(format!("{HLOD_FIELD}.layers must list the layers")));
        }
        let mut layers: Vec<HlodLayer> = Vec::with_capacity(listed.len());
        let mut parents: Vec<Option<String>> = Vec::with_capacity(listed.len());
        for (at, entry) in listed.iter().enumerate() {
            let (read, parent) = layer(entry, &format!("{HLOD_FIELD}.layers[{at}]"))?;
            if layers.iter().any(|l| l.name == read.name) {
                return Err(OPTIONS.bad(format!("{HLOD_FIELD} layer {} is named twice", read.name)));
            }
            layers.push(read);
            parents.push(parent);
        }
        let names: Vec<String> = layers.iter().map(|l| l.name.clone()).collect();
        let rank = |name: &str, what: &str| {
            (names.iter().position(|n| n == name))
                .ok_or_else(|| OPTIONS.bad(format!("{what} names no layer {name}")))
        };
        let parents: Vec<Option<usize>> = (parents.iter().enumerate())
            .map(|(at, parent)| {
                let what = format!("{HLOD_FIELD} layer {}: parent", names[at]);
                parent.as_deref().map(|p| rank(p, &what)).transpose()
            })
            .collect::<Result<_>>()?;
        for (layer, parent) in layers.iter_mut().zip(parents) {
            layer.parent = parent;
        }
        let assign: Vec<HlodAssign> = present(map.get("assign"))
            .map(|rules| {
                (OPTIONS
                    .array(rules, &format!("{HLOD_FIELD}.assign"))?
                    .iter()
                    .enumerate())
                .map(|(at, rule)| {
                    let what = format!("{HLOD_FIELD}.assign[{at}]");
                    let entry = OPTIONS.known(rule, &ASSIGN_FIELDS, &what)?;
                    let layer = OPTIONS.text(entry.get("layer"), &format!("{what}.layer"))?;
                    let matched = entry.get("match").unwrap_or(&Value::Null);
                    Ok(HlodAssign {
                        matcher: NameMatch::read(matched, &format!("{what}.match"))?,
                        layer: rank(layer, &what)?,
                    })
                })
                .collect::<Result<_>>()
            })
            .transpose()?
            .unwrap_or_default();
        let default = OPTIONS.optional(
            map.get("default"),
            &format!("{HLOD_FIELD}.default"),
            Fields::text,
        )?;
        let default = default
            .map(|name| rank(name, &format!("{HLOD_FIELD}.default")))
            .transpose()?;
        let marks: Vec<(String, usize)> = present(map.get("marks"))
            .map(|marks| {
                (OPTIONS
                    .object(marks, &format!("{HLOD_FIELD}.marks"))?
                    .iter())
                .map(|(word, layer)| {
                    let what = format!("{HLOD_FIELD}.marks.{word}");
                    Ok((
                        word.clone(),
                        rank(OPTIONS.text(Some(layer), &what)?, &what)?,
                    ))
                })
                .collect::<Result<_>>()
            })
            .transpose()?
            .unwrap_or_default();
        let hlod = Self {
            layers,
            assign,
            default,
            marks,
            named: named.clone(),
        };
        hlod.chains()?;
        Ok(hlod)
    }
}
