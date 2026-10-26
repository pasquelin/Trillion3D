//! The marks and the option read, its layers read by `layer`.
use super::layer::layer;
use super::*;
use super::{Hlod, HlodAssign, HlodLayer, ASSIGN_FIELDS, HLOD_FIELDS};
use crate::compiler::args::name_match::{present, NameMatch};
use crate::compiler::validate::{Fields, OPTIONS};

/// Node `node` of `g`, if it has one.
pub(super) fn node_of(g: &Value, node: usize) -> Option<&Value> {
    g.get("nodes").and_then(|nodes| nodes.get(node))
}

/// The value `key` of node `node`'s `extras`, if it carries one.
fn extra_of<'a>(g: &'a Value, node: usize, key: &str) -> Option<&'a Value> {
    (node_of(g, node).and_then(|n| n.get("extras"))).and_then(|e| e.get(key))
}

/// The switch node `node`'s `extras` holds under `key`, none when it is absent or `null`; `Err`
/// when it is not a switch.
fn switch_of(g: &Value, node: usize, key: &str) -> Result<Option<bool>> {
    let Some(mark) = extra_of(g, node, key).filter(|mark| !mark.is_null()) else {
        return Ok(None);
    };
    OPTIONS
        .boolean(Some(mark), &format!("node {node}: extras.{key}"))
        .map(Some)
}

/// The mark node `entry`'s `extras` carries (`HLOD_MARK`), if any.
pub(super) fn mark_of(entry: Option<&Value>) -> Option<&Value> {
    (entry.and_then(|n| n.get("extras")))
        .and_then(|e| e.get(HLOD_MARK))
        .filter(|mark| !mark.is_null())
}

/// Whether published node `node` of `g` carries a mark (`HLOD_MARK`).
pub fn marked(g: &Value, node: usize) -> bool {
    mark_of(node_of(g, node)).is_some()
}

/// Whether node `node` of `g`'s object stands as itself in every HLOD actor its chain builds — its
/// meshes instanced beside what the actor's builder makes of the others, never built into it —:
/// the switch its `extras` carries (`HLOD_INSTANCE_MARK`), off when absent; `Err` when it is not
/// a switch.
pub fn instanced(g: &Value, node: usize) -> Result<bool> {
    switch_of(g, node, HLOD_INSTANCE_MARK).map(|set| set.unwrap_or(false))
}

/// Whether node `node` of `g`'s object may enter an HLOD layer at all: the switch its `extras`
/// carries (`HLOD_INCLUDE_MARK`), on when absent; `Err` when it is not a switch. Off, it enters
/// none, whatever a mark, a rule or the default would give it (`Hlod::assigned`).
pub fn included(g: &Value, node: usize) -> Result<bool> {
    switch_of(g, node, HLOD_INCLUDE_MARK).map(|set| set.unwrap_or(true))
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
    /// builder and defaulted, patterns compiled, then the chains checked (`chains`) — no cycle, no
    /// parent wearing its sources' own materials above a layer that wears its own, no chain past
    /// `MAX_HLOD_LEVELS` —, a layer not spatially loaded letting its parent go. Each layer's level
    /// is the scene's (`levels`).
    fn parse(named: &Value) -> Result<Self> {
        let map = OPTIONS.known(named, &HLOD_FIELDS, HLOD_FIELD)?;
        let listed = OPTIONS.array(
            map.get("layers").unwrap_or(&Value::Null),
            &format!("{HLOD_FIELD}.layers"),
        )?;
        if listed.is_empty() {
            return Err(OPTIONS.bad(format!("{HLOD_FIELD}.layers must list the layers")));
        }
        let layers = layers_of(listed)?;
        let rank = |name: &str, what: &str| rank_of(&layers, name, what);
        let assign = assign_of(map, &rank)?;
        let default = OPTIONS.optional(
            map.get("default"),
            &format!("{HLOD_FIELD}.default"),
            Fields::text,
        )?;
        let default = default
            .map(|name| rank(name, &format!("{HLOD_FIELD}.default")))
            .transpose()?;
        let mut hlod = Self {
            layers,
            assign,
            default,
            named: named.clone(),
            dropped: Vec::new(),
        };
        hlod.chains()?;
        Ok(hlod)
    }
}

/// The rank of the layer called `name` among `layers`; `what` names the reference in the refusal of
/// one that names no layer.
fn rank_of(layers: &[HlodLayer], name: &str, what: &str) -> Result<usize> {
    (layers.iter().position(|l| l.name == name))
        .ok_or_else(|| OPTIONS.bad(format!("{what} names no layer {name}")))
}

/// The layers `listed` holds, each read (`layer`), named once, its parent resolved.
fn layers_of(listed: &[Value]) -> Result<Vec<HlodLayer>> {
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
    let ranks: Vec<Option<usize>> = (parents.iter().enumerate())
        .map(|(at, parent)| {
            let what = format!("{HLOD_FIELD} layer {}: parent", layers[at].name);
            parent
                .as_deref()
                .map(|p| rank_of(&layers, p, &what))
                .transpose()
        })
        .collect::<Result<_>>()?;
    for (layer, parent) in layers.iter_mut().zip(ranks) {
        layer.parent = parent;
    }
    Ok(layers)
}

/// The rules of `map`'s `assign`, each a match and the layer it assigns, `rank` resolving a layer.
fn assign_of(
    map: &Map<String, Value>,
    rank: &impl Fn(&str, &str) -> Result<usize>,
) -> Result<Vec<HlodAssign>> {
    let Some(rules) = present(map.get("assign")) else {
        return Ok(Vec::new());
    };
    let rules = OPTIONS.array(rules, &format!("{HLOD_FIELD}.assign"))?;
    (rules.iter().enumerate())
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
        .collect()
}
