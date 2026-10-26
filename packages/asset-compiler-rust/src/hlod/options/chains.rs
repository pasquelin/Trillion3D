//! The chains of layers, each layer's level, voxelization and what a node is assigned.
use super::parse::{mark_of, node_of};
use super::*;
use super::{Assigned, Hlod, HlodBuilder};
use crate::compiler::args::name_match::{name_of, NodeNames};
use crate::compiler::validate::OPTIONS;

/// Whether `layer`'s actors wear its sources' own materials: an instanced layer's — the objects
/// themselves —, a merged layer's keeping its materials. A parent that does builds nothing above
/// a layer that does not: the actors it would build there would wear the materials that layer's
/// actors made for themselves (`Hlod::chains`).
fn reuses_materials(layer: &HlodLayer) -> bool {
    match layer.builder {
        HlodBuilder::Instanced => true,
        HlodBuilder::Merge => !layer.merge_materials,
        HlodBuilder::Approximate | HlodBuilder::Voxel | HlodBuilder::Simplify => false,
    }
}

impl HlodLayer {
    /// Whether the layer disallows its objects' cluster DAG: an instanced layer, which stands them
    /// on fallback meshes.
    pub fn takes_fallback(&self) -> bool {
        self.builder == HlodBuilder::Instanced && !self.cluster_dag
    }
}

impl Hlod {
    /// Whether the layers form chains (`parse`), as the reference keeps them: a layer whose parent
    /// closes a cycle, or wears its sources' own materials above a layer whose actors wear
    /// materials of their own (`reuses_materials`), loses that parent — its chain ends there — and
    /// the job is told (`dropped`), never refused; a chain longer than `MAX_HLOD_LEVELS` — the world
    /// table writes a level in 8 bits — is refused. Any layer may take objects and stand at HLOD 0,
    /// any may be another's parent; the parent a layer not spatially loaded names is let go: its
    /// actors are always loaded, so nothing is built of them. A layer no object's chain reaches
    /// builds nothing (`levels`).
    pub(super) fn chains(&mut self) -> Result<()> {
        // The parent of a layer not spatially loaded is let go before any check: the edge never
        // carries an actor, so it can neither close a cycle nor wear a material above anything.
        for layer in self.layers.iter_mut().filter(|l| !l.spatially_loaded) {
            layer.parent = None;
        }
        for at in 0..self.layers.len() {
            let Some(parent) = self.layers[at].parent else {
                continue;
            };
            let (name, above) = (&self.layers[at].name, &self.layers[parent].name);
            let why = match (
                self.closes_cycle(at),
                reuses_materials(&self.layers[parent]),
            ) {
                (true, _) => format!("its parent {above} closes a cycle of parents"),
                (false, true) if !reuses_materials(&self.layers[at]) => format!(
                    "its parent {above} wears its sources' own materials, so it builds nothing \
                     above {name}, whose actors wear materials of their own"
                ),
                _ => continue,
            };
            self.dropped.push(format!(
                "{HLOD_FIELD} layer {name}: {why}: its chain ends at it"
            ));
            self.layers[at].parent = None;
        }
        let longest = (0..self.layers.len())
            .map(|at| (at, 1 + self.ancestors(Some(at)).count()))
            .find(|&(_, levels)| levels > MAX_HLOD_LEVELS);
        if let Some((at, levels)) = longest {
            return Err(OPTIONS.bad(format!(
                "{HLOD_FIELD} layer {}'s chain has {levels} levels, at most {MAX_HLOD_LEVELS}",
                self.layers[at].name
            )));
        }
        Ok(())
    }

    /// Whether the chain followed up from `start` comes back to a layer it passed: within as many
    /// steps as there are layers, a chain that ends does.
    fn closes_cycle(&self, start: usize) -> bool {
        let mut at = start;
        for _ in 0..=self.layers.len() {
            match self.layers[at].parent {
                Some(parent) => at = parent,
                None => return false,
            }
        }
        true
    }

    /// Each layer's HLOD level once the scene names the layers its objects take (`used`): its
    /// deepest step up any chain from one of them — a layer two chains reach at two depths takes
    /// the deeper, its actors on the grid of that level —, `None` for a layer no such chain
    /// reaches: it builds nothing, and no grid streams its actors.
    pub fn levels(&self, used: impl IntoIterator<Item = usize>) -> Vec<Option<usize>> {
        let mut levels: Vec<Option<usize>> = vec![None; self.layers.len()];
        let mut walked = vec![false; self.layers.len()];
        for start in used {
            if std::mem::replace(&mut walked[start], true) {
                continue;
            }
            let chain = std::iter::once(start).chain(self.ancestors(Some(start)));
            for (depth, at) in chain.enumerate() {
                levels[at] = Some(levels[at].map_or(depth, |seen| seen.max(depth)));
            }
        }
        levels
    }

    /// Whether the chain from `layer` up holds a `builder` layer, its own or one above.
    fn chain_has(&self, layer: Option<usize>, builder: HlodBuilder) -> bool {
        (layer.into_iter().chain(self.ancestors(layer))).any(|l| self.layers[l].builder == builder)
    }

    /// Whether the chain from `layer` up voxelizes its cells — a `voxel` layer in it, its own or
    /// one above —: its objects' meshes are then candidates for voxels far away too
    /// (`VoxelizeOptions::meshes`), each group voxels only where they beat its triangles — a small
    /// mesh stays triangles —; the `voxel` layer still voxelizes each cell's objects together.
    pub fn voxelizes(&self, layer: Option<usize>) -> bool {
        self.chain_has(layer, HlodBuilder::Voxel)
    }

    /// Whether the chain from `layer` up merges — a `merge` layer in it, its own or one above —:
    /// the objects of the layer are built into that layer's actors from their sources' LODs.
    pub fn merges(&self, layer: Option<usize>) -> bool {
        self.chain_has(layer, HlodBuilder::Merge)
    }

    /// The source meshes of `g` a merged layer may take (`merges`): those of the `chosen` objects
    /// whose layer's chain merges and that do not stand as themselves (`instanced`), the layers
    /// read as every stage reads them (`assignments`, one per node of `g`). A mesh of none is no
    /// merged layer's source: its LODs are never cut for one (`flatten::merge::Lods`).
    pub fn merged_meshes(
        &self,
        g: &Value,
        chosen: &BTreeSet<usize>,
        assignments: &[Assigned],
    ) -> Result<BTreeSet<usize>> {
        let mut meshes = BTreeSet::new();
        if !self.layers.iter().any(|l| l.builder == HlodBuilder::Merge) {
            return Ok(meshes);
        }
        for &node in chosen {
            let Some(mesh) = node_of(g, node).and_then(|n| n.get("mesh")?.as_u64()) else {
                continue;
            };
            if meshes.contains(&(mesh as usize)) {
                continue;
            }
            if self.merges(assignments[node].layer) && !instanced(g, node)? {
                meshes.insert(mesh as usize);
            }
        }
        Ok(meshes)
    }

    /// Whether any layer stands its objects on fallback meshes (`compiler/source/fallback.rs`),
    /// that is, takes them (`HlodLayer::takes_fallback`).
    pub fn has_fallback_layer(&self) -> bool {
        self.layers.iter().any(HlodLayer::takes_fallback)
    }

    /// Whether the actors of the chain from `layer` up draw their objects on fallback meshes: an
    /// instanced layer without a cluster DAG, its own or one above.
    pub fn takes_fallback(&self, layer: Option<usize>) -> bool {
        (layer.into_iter().chain(self.ancestors(layer))).any(|l| self.layers[l].takes_fallback())
    }

    /// The layers above `layer`, its parent first, up its chain: one per step, never more than
    /// there are layers — the chains were checked free of cycles (`chains`), and the bound keeps
    /// the walk finite even past that check.
    pub fn ancestors(&self, layer: Option<usize>) -> impl Iterator<Item = usize> + '_ {
        let first = layer.and_then(|l| self.layers[l].parent);
        std::iter::successors(first, |&l| self.layers[l].parent).take(self.layers.len())
    }

    /// The assignment (`assigned`) of every node of `g`, by rank, read once for the job: what
    /// every stage reads. A node that draws no mesh and carries no mark, which no stage reads,
    /// holds the default. `Err` as `assigned` is, for the first node that refuses.
    pub fn assignments(&self, g: &Value) -> Result<Vec<Assigned>> {
        let nodes = g.get("nodes").and_then(Value::as_array).map_or(0, Vec::len);
        (0..nodes)
            .map(|node| {
                let entry = node_of(g, node);
                let drawn = entry.is_some_and(|n| n.get("mesh").is_some_and(Value::is_u64));
                match drawn || mark_of(entry).is_some() {
                    true => self.assigned(g, node),
                    false => Ok(Assigned::default()),
                }
            })
            .collect()
    }

    /// Published node `node` of `g`'s assignment, the one every stage reads (`Assigned`): the
    /// layer its mark names, a layer's name, else that of the first rule its name, its mesh's, its
    /// primitives' materials' or its `extras` match, else the default;
    /// none for no layer — its object enters no HLOD actor —, which a node whose `extras` say
    /// `hlodInclude: false` has whatever the rest gives it. `Err` when the mark is not a text,
    /// names no layer, or marks an object of a job naming no HLOD, or when `hlodInclude` is not a
    /// switch.
    pub fn assigned(&self, g: &Value, node: usize) -> Result<Assigned> {
        let included = included(g, node)?;
        let entry = node_of(g, node);
        let mark = mark_of(entry);
        let marked = mark
            .map(|mark| {
                let label = name_of(entry).map_or(format!("node {node}"), |n| format!("node {n}"));
                let what = format!("{label}: extras.{HLOD_MARK}");
                let word = OPTIONS.text(Some(mark), &what)?;
                if self.layers.is_empty() {
                    return Err(OPTIONS.bad(format!(
                        "{what} marks {word}, but the job names no {HLOD_FIELD}: name one, its \
                         levels at least"
                    )));
                }
                (self.layers.iter().position(|l| l.name == word)).ok_or_else(|| {
                    let names: Vec<&str> = self.layers.iter().map(|l| l.name.as_str()).collect();
                    OPTIONS.bad(format!(
                        "{what} marks {word}, which is none of {}",
                        names.join(", ")
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
        // An object out of the HLOD has no layer, a mark that names one and a rule that names
        // another alike.
        if !included {
            return Ok(Assigned::default());
        }
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
