//! The chains of layers, voxelization and what a node is assigned.
use super::super::name_match::{name_of, NodeNames};
use super::parse::mark_of;
use super::*;
use super::{Assigned, Hlod, HlodBuilder};
use crate::compiler_validate::OPTIONS;

impl Hlod {
    /// Whether the layers form chains and every rule, mark and the default name an instanced
    /// layer (`parse`).
    pub(super) fn chains(&self) -> Result<()> {
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
