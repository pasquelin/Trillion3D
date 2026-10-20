//! A job's HLOD as the compiler reads it (`HlodWire`, `compilerAbi.ts`, which `resolveHlod` writes
//! from either form a host names): HLOD layers — each a builder, its settings and the layer its
//! cells' actors are built by — and how each placed
//! object is assigned to one layer at most, once (`Hlod::assigned`): the mark its node's `extras`
//! carries (`HLOD_MARK`, a layer's name or a word `marks` gives one), else the first rule that
//! matches it, else the default layer if one is named. An object none names has no layer: it
//! enters no HLOD actor, streamed in its cell and drawn while loaded, nothing standing for it
//! beyond. A job naming no HLOD builds none.
//!
//! Read and checked here in one pass — names and parents resolved, each builder's settings
//! admitted and defaulted, patterns compiled, the layers formed into chains —; what does not read
//! is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`), never the batch's.
use super::name_match::{name_of, present, NameMatch, NodeNames};
use super::*;
use crate::compiler_validate::{Fields, OPTIONS};

/// How a layer builds its actors, in `HLOD_BUILDERS` order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodBuilder {
    /// The objects themselves, batched: a layer objects are assigned to.
    Instanced,
    /// One closed shell per cell wearing a flattened material.
    Approximate,
    /// The cell's objects merged into one mesh.
    Merge,
    /// The cell's objects remeshed into one closed surface.
    Proxy,
    /// The cell's objects voxelized together: levels of bricks, no shell, no atlas.
    Voxel,
}

impl HlodBuilder {
    const ALL: [Self; 5] = [
        Self::Instanced,
        Self::Approximate,
        Self::Merge,
        Self::Proxy,
        Self::Voxel,
    ];

    /// Its word (`HLOD_BUILDERS`).
    pub fn name(self) -> &'static str {
        HLOD_BUILDERS[self as usize]
    }

    /// The settings a layer of it may name beside its name, builder and parent: an approximated
    /// layer its voxel, deviation and atlas; a proxy layer its voxel and atlas — its deviation is
    /// its own (`proxy_lod`) —; a merged layer its deviation — the LOD it takes of each source, its
    /// merged mesh never simplified —, its LOD of each source, whether it merges its materials
    /// and, merging them, its atlas. A voxel layer names none: its voxels are as fine as the cut's
    /// pixel error asks where each level is drawn.
    fn settings(self) -> &'static [&'static str] {
        match self {
            Self::Instanced | Self::Voxel => &[],
            Self::Approximate => &[
                "accuracy",
                "accuracyPixels",
                "deviation",
                "deviationPixels",
                "textureSize",
            ],
            Self::Proxy => &["accuracy", "accuracyPixels", "textureSize"],
            Self::Merge => &[
                "deviation",
                "deviationPixels",
                "lodSelection",
                "mergeMaterials",
                "textureSize",
            ],
        }
    }
}

/// Which LOD of each source a merged layer takes (`lodSelection`, `HLOD_LOD_SELECTIONS` order).
/// A choice naming one of a mesh's discrete LODs has no meaning here: a DAG has none.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum HlodLodSelection {
    /// The LOD the source shows at the layer's deviation from where the layer is first seen
    /// (`'calculate'`, the default).
    #[default]
    Calculate,
    /// The source's coarsest LOD (`'lowest'`): its DAG's roots.
    Lowest,
}

impl HlodLodSelection {
    const ALL: [Self; 2] = [Self::Calculate, Self::Lowest];

    /// Its word (`HLOD_LOD_SELECTIONS`).
    pub fn name(self) -> &'static str {
        HLOD_LOD_SELECTIONS[self as usize]
    }
}

/// One layer: its name, builder, parent's rank, and its builder's settings, the voxel and the
/// deviation the automatic rule when `None` (`compiler_world_roots::flatten::layer_settings`), the
/// others their defaults resolved.
#[derive(Clone, Debug)]
pub struct HlodLayer {
    pub name: String,
    pub builder: HlodBuilder,
    pub parent: Option<usize>,
    pub accuracy: Option<f64>,
    pub accuracy_pixels: Option<f64>,
    pub deviation: Option<f64>,
    pub deviation_pixels: Option<f64>,
    /// Its atlas side, `DEFAULT_HLOD_TEXTURE_SIZE` when it names none.
    pub texture_size: usize,
    /// A merged layer's LOD of each source (`lodSelection`).
    pub lod_selection: HlodLodSelection,
    /// Whether a merged layer merges its materials into one atlas (`mergeMaterials`, false by
    /// default).
    pub merge_materials: bool,
}

/// A rule: what it matches and the rank of the layer it assigns.
#[derive(Clone, Debug)]
pub struct HlodAssign {
    pub matcher: NameMatch,
    pub layer: usize,
}

/// A job's HLOD: its layers — none for a job naming no HLOD —, its rules, the rank of the layer of
/// an object no rule matches, if any, the layer each mark word names beside the layers' own names,
/// and what named it, its cache identity. The default is a job naming no HLOD.
#[derive(Clone, Debug, Default)]
pub struct Hlod {
    pub layers: Vec<HlodLayer>,
    pub assign: Vec<HlodAssign>,
    pub default: Option<usize>,
    marks: Vec<(String, usize)>,
    pub named: Value,
}

/// One object's assignment (`Hlod::assigned`): its layer, if any, and, where its mark won over a
/// rule naming another layer, that rule's layer — the compile's warning.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Assigned {
    pub layer: Option<usize>,
    pub overruled: Option<usize>,
}

/// The fields a layer names whatever its builder, a rule and the HLOD.
const LAYER_FIELDS: [&str; 3] = ["name", "builder", "parent"];
const ASSIGN_FIELDS: [&str; 2] = ["match", "layer"];
const HLOD_FIELDS: [&str; 4] = ["layers", "assign", "default", "marks"];

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
fn layer(entry: &Value, what: &str) -> Result<(HlodLayer, Option<String>)> {
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
fn mark_of(entry: Option<&Value>) -> Option<&Value> {
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

    /// Whether the layers form chains and every rule, mark and the default name an instanced
    /// layer (`parse`).
    fn chains(&self) -> Result<()> {
        let layers = &self.layers;
        let refuse = |message: String| Err(OPTIONS.bad(message));
        let instanced = |at: usize| layers[at].builder == HlodBuilder::Instanced;
        // A cycle first: a chain followed up from any layer that does not end within as many
        // steps as there are layers.
        for (start, layer) in layers.iter().enumerate() {
            let mut at = start;
            for _ in 0..=layers.len() {
                match layers[at].parent {
                    Some(parent) => at = parent,
                    None => break,
                }
            }
            if layers[at].parent.is_some() {
                return refuse(format!(
                    "{HLOD_FIELD} layers form a cycle through {}",
                    layer.name
                ));
            }
        }
        if (0..layers.len()).all(instanced) {
            return refuse(format!("{HLOD_FIELD} must name a layer that builds actors"));
        }
        let mut level: Vec<Option<usize>> = vec![None; layers.len()];
        for start in (0..layers.len()).filter(|&at| instanced(at)) {
            let name = &layers[start].name;
            if layers[start].parent.is_none() {
                return refuse(format!(
                    "{HLOD_FIELD} layer {name} is instanced with no parent: its objects would \
                     stay loaded everywhere"
                ));
            }
            let (mut at, mut depth) = (start, 0usize);
            loop {
                match level[at] {
                    Some(seen) if seen != depth => {
                        let name = &layers[at].name;
                        return refuse(format!(
                            "{HLOD_FIELD} layer {name} is reached at levels {seen} and {depth}"
                        ));
                    }
                    _ => level[at] = Some(depth),
                }
                let Some(parent) = layers[at].parent else {
                    break;
                };
                if instanced(parent) {
                    let name = &layers[parent].name;
                    return refuse(format!(
                        "{HLOD_FIELD} layer {name} is instanced and cannot build actors"
                    ));
                }
                (at, depth) = (parent, depth + 1);
            }
            if depth + 1 > MAX_HLOD_LEVELS {
                return refuse(format!(
                    "{HLOD_FIELD} layer {name}'s chain has {} levels, at most {MAX_HLOD_LEVELS}",
                    depth + 1
                ));
            }
        }
        if let Some(at) = level.iter().position(Option::is_none) {
            let name = &layers[at].name;
            return refuse(format!(
                "{HLOD_FIELD} layer {name} is in no instanced layer's chain"
            ));
        }
        // Which objects a layer gets is known once the scene is read: marks name layers too.
        let named = (self.assign.iter().map(|rule| rule.layer))
            .chain(self.default)
            .chain(self.marks.iter().map(|&(_, layer)| layer));
        for at in named {
            if !instanced(at) {
                let name = &layers[at].name;
                return refuse(format!(
                    "{HLOD_FIELD} assigns objects to {name}, which is not instanced"
                ));
            }
        }
        Ok(())
    }

    /// Whether the chain above `layer` voxelizes its cells — a `voxel` layer in it —: its objects'
    /// meshes are then voxelized far away too, so each object's own levels end in the bricks its
    /// cell's continue (`VoxelizeOptions::meshes`).
    pub fn voxelizes(&self, layer: Option<usize>) -> bool {
        (self.ancestors(layer)).any(|l| self.layers[l].builder == HlodBuilder::Voxel)
    }

    /// The layers above `layer`, its parent first, up its chain: one per step, never more than
    /// there are layers — the chains were checked free of cycles (`chains`), and the bound keeps
    /// the walk finite even past that check.
    pub fn ancestors(&self, layer: Option<usize>) -> impl Iterator<Item = usize> + '_ {
        let first = layer.and_then(|l| self.layers[l].parent);
        std::iter::successors(first, |&l| self.layers[l].parent).take(self.layers.len())
    }

    /// Published node `node` of `g`'s assignment, the one every stage reads (`Assigned`): the
    /// layer its mark names — a word of `marks`, else an instanced layer's name —, else that of
    /// the first rule its name, its mesh's, its primitives' materials' or its `extras` match, else
    /// the default; none for no layer — its object enters no HLOD actor. `Err` when the mark is not
    /// a text, names neither, or marks an object of a job naming no HLOD.
    pub fn assigned(&self, g: &Value, node: usize) -> Result<Assigned> {
        let entry = g.pointer(&format!("/nodes/{node}"));
        let mark = mark_of(entry);
        let marked = mark
            .map(|mark| {
                let label = name_of(entry).map_or(format!("node {node}"), |n| format!("node {n}"));
                let what = format!("{label}: extras.{HLOD_MARK}");
                let word = OPTIONS.text(Some(mark), &what)?;
                if self.layers.is_empty() {
                    return Err(OPTIONS.bad(format!(
                        "{what} marks {word}, but the job names no {HLOD_FIELD}: name one, its \
                         levels and quality at least"
                    )));
                }
                let by_word = self.marks.iter().find(|(w, _)| w == word).map(|&(_, l)| l);
                let by_name = (self.layers.iter())
                    .position(|l| l.name == word && l.builder == HlodBuilder::Instanced);
                by_word.or(by_name).ok_or_else(|| {
                    let words: Vec<&str> = (self.marks.iter().map(|(w, _)| w.as_str()))
                        .chain(
                            (self.layers.iter())
                                .filter(|l| l.builder == HlodBuilder::Instanced)
                                .map(|l| l.name.as_str()),
                        )
                        .collect();
                    OPTIONS.bad(format!(
                        "{what} marks {word}, which is none of {}",
                        words.join(", ")
                    ))
                })
            })
            .transpose()?;
        let ruled = (!self.assign.is_empty())
            .then(|| {
                let names = NodeNames::of(g, node);
                (self.assign.iter())
                    .find(|rule| rule.matcher.matches(&names))
                    .map(|rule| rule.layer)
            })
            .flatten();
        Ok(match marked {
            Some(layer) => Assigned {
                layer: Some(layer),
                overruled: ruled.filter(|&ruled| ruled != layer),
            },
            None => Assigned {
                layer: ruled.or(self.default),
                overruled: None,
            },
        })
    }
}
