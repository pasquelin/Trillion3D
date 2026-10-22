//! What the compile reads of the assemblies the load laid out (`expand.rs`, `carriers.rs`): which
//! primitive carries the levels above each assembly's instances, which instances join it, and which
//! primitives of the parts those instances draw — the ones whose roots the assembly climbs over
//! (`dag::assembly`). Read once the compiled primitives are planned (`AssemblyPlan::of`), from the
//! marks the load left in the document: `BUILT_EXTRA` on the assembly's mesh, `INSTANCE_EXTRA` on
//! each node that is an instance of it.
use crate::compiler::source::node_transform::{local_matrix, Mat4};
use crate::*;
use std::collections::{BTreeMap, BTreeSet};

/// The key of a mesh's `extras` that tells where the instances of the assembly it was stand: `first`,
/// the first of `count` nodes under the first node that places it, and its `carriers`.
pub(crate) const BUILT_EXTRA: &str = "assemblyBuilt";
/// The key of a node's `extras` that marks it an instance of an assembly: `of`, the mesh of the
/// assembly, and `at`, its rank among the assembly's nodes.
pub(crate) const INSTANCE_EXTRA: &str = "assemblyInstance";
/// The key of a primitive's `extras` that marks one the load made only to carry an assembly's
/// levels: its own triangle is a placeholder, never read.
pub(crate) const TOP_EXTRA: &str = "assemblyTop";

/// One instance that joins a carrier: its rank among the assembly's nodes, the primitive of its
/// part it draws — mesh, primitive — and the transform it stands at, in the assembly's space.
#[derive(Clone, Debug)]
pub(crate) struct Use {
    pub at: usize,
    pub part: (usize, usize),
    pub matrix: Mat4,
}

/// What the levels above an assembly's instances give one of them: the error and the LOD ball of
/// the group that replaces its root — `[error, x, y, z, radius]`, in the space of its part — for
/// the primitive of its part it draws. `assembly` is the assembly's mesh, `at` the instance's rank
/// among its nodes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RootParent {
    pub assembly: usize,
    pub at: usize,
    pub primitive: usize,
    pub values: [f64; 5],
}

/// What every carrier of a job gave its instances (`RootParent`), by assembly mesh and instance:
/// per primitive of the part, the parent its root has. The scene's tables carry it on the node of
/// each instance (`tables/graph.rs`).
#[derive(Default)]
pub(crate) struct AssemblyParents(BTreeMap<(usize, usize), BTreeMap<usize, [f64; 5]>>);

impl AssemblyParents {
    /// The parents `given` by the compiled carriers, gathered.
    pub(crate) fn of(given: impl IntoIterator<Item = RootParent>) -> Self {
        let mut all = Self::default();
        for parent in given {
            let entry = all.0.entry((parent.assembly, parent.at)).or_default();
            entry.insert(parent.primitive, parent.values);
        }
        all
    }

    /// The parents of node `node` as the scene's tables write them, one entry per primitive
    /// of its part up to the last that has one — `null` for a primitive none replaces —, or `None`
    /// for a node that is no instance of an assembly or whose roots have no parent.
    pub(crate) fn of_node(&self, node: &Value) -> Option<Value> {
        let instance = node.pointer(&format!("/extras/{INSTANCE_EXTRA}"))?;
        let key = (
            instance.get("of")?.as_u64()? as usize,
            instance.get("at")?.as_u64()? as usize,
        );
        let parents = self.0.get(&key)?;
        let last = *parents.keys().next_back()?;
        let list: Vec<Value> = (0..=last)
            .map(|primitive| {
                parents
                    .get(&primitive)
                    .map_or(Value::Null, |values| json!(values))
            })
            .collect();
        Some(Value::Array(list))
    }
}

/// The carriers of a job — the primitives (mesh, primitive) that hold the levels above their
/// instances, each with the instances that join it — and the primitives of the parts those
/// instances draw.
#[derive(Default)]
pub(crate) struct AssemblyPlan {
    pub carriers: BTreeMap<(usize, usize), Vec<Use>>,
    pub parts: BTreeSet<(usize, usize)>,
}

/// The whole number `value` holds, `what` naming it in the refusal.
fn whole(value: Option<&Value>, what: &str) -> Result<usize> {
    required_index(value, what)
}

impl AssemblyPlan {
    /// The plan of the document `g` for the primitives `jobs` compile: a carrier is planned when
    /// its own primitive is compiled, an instance when the primitive of its part is.
    pub(crate) fn of(g: &Value, jobs: &[(usize, usize)]) -> Result<Self> {
        let compiled: BTreeSet<(usize, usize)> = jobs.iter().copied().collect();
        let nodes = values(g, "nodes")?;
        let mut plan = Self::default();
        for (mesh, source) in values(g, "meshes")?.iter().enumerate() {
            let Some(built) = source.pointer(&format!("/extras/{BUILT_EXTRA}")) else {
                continue;
            };
            let first = whole(built.get("first"), "assemblyBuilt.first")?;
            let carriers = built.get("carriers").and_then(Value::as_array);
            for carrier in carriers.into_iter().flatten() {
                let primitive = whole(carrier.get("primitive"), "assemblyBuilt.primitive")?;
                if !compiled.contains(&(mesh, primitive)) {
                    continue;
                }
                let mut joined = Vec::new();
                for pair in carrier["uses"].as_array().into_iter().flatten() {
                    let at = whole(pair.get(0), "assemblyBuilt.uses")?;
                    let drawn = whole(pair.get(1), "assemblyBuilt.uses")?;
                    let node = item(nodes, first + at, "node")?;
                    let part = (whole(node.get("mesh"), "node.mesh")?, drawn);
                    if compiled.contains(&part) {
                        let matrix = local_matrix(node)?;
                        joined.push(Use { at, part, matrix });
                        plan.parts.insert(part);
                    }
                }
                if !joined.is_empty() {
                    plan.carriers.insert((mesh, primitive), joined);
                }
            }
        }
        Ok(plan)
    }

    /// Whether the roots of the primitive `job` are what an assembly's levels climb over.
    pub(crate) fn takes_roots_of(&self, job: &(usize, usize)) -> bool {
        self.parts.contains(job)
    }
}
