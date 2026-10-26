//! How a primitive takes part in the levels above an assembly's instances (`climb.rs`): the
//! instances that join the primitive that carries them (`Carrying`) and what its build is told of
//! them. A carrier the load added (a placeholder) that fewer than two instances can join has
//! nothing to climb over and no triangle of its own to keep: it builds no job.
use super::climb::Assembly;
use crate::compiler::source::assembly::plan::{AssemblyPlan, RootParent, Use, NOT_MERGED};
use crate::dag::assembly::{part_space, Instance, Parent, RootCover};
use crate::*;

/// How a primitive takes part in the levels above an assembly's instances: the instances that join
/// it — the roots of their parts' primitives carry the attributes it does —, and what its build is
/// told of them. `left_out` counts the instances that were to join and cannot — a part left no
/// roots, or its roots carry other attributes —; they draw down to their own roots.
pub(super) struct Carrying<'a> {
    /// The instances as the climb takes them, and, in the same order, the use of the plan each is.
    instances: Vec<Instance<'a>>,
    uses: Vec<&'a Use>,
    left_out: usize,
    placeholder: bool,
}

impl<'a> Carrying<'a> {
    /// What the primitive `job`, whose pages carry `layout` — a flag and a width each —, carries of
    /// the instances `plan` plans for it, over the roots `covers` the compiled parts handed on;
    /// `placeholder` when the load added it to carry them, which takes two instances at least: with
    /// fewer, none.
    pub(super) fn of(
        (plan, covers): (&'a AssemblyPlan, &BTreeMap<(usize, usize), &'a RootCover>),
        job: &(usize, usize),
        (placeholder, layout): (bool, &[(u32, usize)]),
    ) -> Self {
        let planned = plan.carriers.get(job).map_or(&[][..], Vec::as_slice);
        // Whether the roots of a part carry the attributes of `layout` is asked once for each
        // distinct part, however many instances draw it.
        let mut verdicts: BTreeMap<(usize, usize), bool> = BTreeMap::new();
        let mut joined: Vec<(&'a Use, &'a RootCover)> = (planned.iter())
            .filter_map(|used| Some((used, *covers.get(&used.part)?)))
            .filter(|&(used, cover)| {
                *(verdicts.entry(used.part)).or_insert_with(|| cover.joins(layout))
            })
            .collect();
        if placeholder && joined.len() < 2 {
            joined.clear();
        }
        let instance = |&(used, cover): &(&'a Use, &'a RootCover)| Instance {
            cover,
            matrix: used.matrix,
        };
        Self {
            instances: joined.iter().map(instance).collect(),
            uses: joined.iter().map(|&(used, _)| used).collect(),
            left_out: planned.len() - joined.len(),
            placeholder,
        }
    }

    /// Whether the primitive is a placeholder no instance joined: it builds no job.
    pub(super) fn vacant(&self) -> bool {
        self.placeholder && self.instances.is_empty()
    }

    /// What its build is asked: the climb over the instances that joined, and whether the roots of
    /// its own DAG are kept (`cover`).
    pub(super) fn assembly(&self, cover: bool) -> Assembly<'_> {
        Assembly {
            instances: &self.instances,
            cover,
        }
    }

    /// What it has to say of the instances left out: `NOT_MERGED` and how many, nothing when every
    /// instance joined.
    pub(super) fn warnings(&self) -> Vec<Value> {
        match self.left_out {
            0 => Vec::new(),
            instances => vec![json!({"code": NOT_MERGED, "instances": instances})],
        }
    }

    /// Tells what it has to say (`warnings`) in the DAG report of the primitive — the
    /// `clusters.json` a warm run replays — and in the `warnings` of its progress event.
    pub(super) fn tell(&self, report: &mut Value, warnings: &mut Vec<Value>) {
        for warning in self.warnings() {
            if let Some(told) = report["warnings"].as_array_mut() {
                told.push(warning.clone());
            }
            warnings.push(warning);
        }
    }

    /// What the levels gave each instance of the assembly mesh `assembly`, in the space of its
    /// part, from the group `climbed` that replaces each root, in the order of the instances.
    pub(super) fn parents(&self, assembly: usize, climbed: Vec<Option<Parent>>) -> Vec<RootParent> {
        (self.uses.iter().zip(&self.instances).zip(climbed))
            .filter_map(|((used, instance), parent)| {
                let parent = parent?;
                let values = part_space(&instance.matrix, parent.error, parent.sphere)?;
                Some(RootParent {
                    assembly,
                    at: used.at,
                    primitive: used.part.1,
                    values,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use trillion3d_math::matrix::IDENTITY;
    use trillion3d_page_codec::FLAG_NORMAL;

    /// The roots of a part's primitive: one triangle, carrying a normal when `normals`.
    fn roots(normals: bool) -> RootCover {
        let carried = |flag, width| encode::Attribute {
            flag,
            width,
            values: vec![0.0; 3 * width],
        };
        RootCover {
            positions: vec![0.0; 9],
            carried: if normals {
                vec![carried(FLAG_NORMAL, 3)]
            } else {
                Vec::new()
            },
            indices: vec![0, 1, 2],
            lod_error: 1.0,
            sphere: [0.0, 0.0, 0.0, 1.0],
        }
    }

    /// A plan where the carrier (1, 0) takes one instance of each of the part primitives `parts`.
    fn plan(parts: &[(usize, usize)]) -> AssemblyPlan {
        let uses = (parts.iter().enumerate()).map(|(at, &part)| Use {
            at,
            part,
            matrix: IDENTITY,
        });
        AssemblyPlan {
            carriers: BTreeMap::from([((1, 0), uses.collect())]),
            parts: parts.iter().copied().collect(),
        }
    }

    /// The carrier (1, 0), a placeholder or not, over the roots `covers` the parts handed on, its
    /// pages carrying no attribute but a position.
    fn carrying<'a>(
        plan: &'a AssemblyPlan,
        covers: &[((usize, usize), &'a RootCover)],
        placeholder: bool,
    ) -> Carrying<'a> {
        let covers: BTreeMap<_, _> = covers.iter().copied().collect();
        Carrying::of((plan, &covers), &(1, 0), (placeholder, &[]))
    }

    // Behaviour: instances whose roots carry the attributes a carrier's pages do join its climb;
    // two of them are what a carrier the load added takes at least.
    #[test]
    fn instances_whose_roots_carry_what_the_carrier_does_join_it() {
        let (plan, joining) = (plan(&[(0, 0), (0, 0)]), roots(false));
        let carrying = carrying(&plan, &[((0, 0), &joining)], true);
        assert!(!carrying.vacant());
        assert_eq!(carrying.assembly(false).instances.len(), 2);
        assert!(carrying.warnings().is_empty());
        let parents = vec![None, None];
        assert!(carrying.parents(1, parents).is_empty(), "none climbed");
    }

    // Behaviour: a carrier the load added that no instance can join — their roots carry other
    // attributes — has nothing to climb over and no triangle of its own: it builds no job, and
    // tells the instances it left out. One that only one instance can join is the same.
    #[test]
    fn a_placeholder_fewer_than_two_instances_join_builds_no_job_and_tells_it() {
        let (plan, joining, normals) = (plan(&[(0, 0), (0, 1)]), roots(false), roots(true));
        let none = carrying(&plan, &[((0, 0), &normals), ((0, 1), &normals)], true);
        assert!(none.vacant());
        assert!(none.assembly(false).instances.is_empty());
        assert_eq!(
            none.warnings(),
            [json!({"code": NOT_MERGED, "instances": 2})]
        );
        let lone = carrying(&plan, &[((0, 0), &joining), ((0, 1), &normals)], true);
        assert!(lone.vacant(), "one instance is nothing to climb over");
        assert!(lone.assembly(false).instances.is_empty());
        assert_eq!(
            lone.warnings(),
            [json!({"code": NOT_MERGED, "instances": 2})]
        );
        // A part that handed on no roots leaves its instance out the same.
        let missing = carrying(&plan, &[((0, 0), &joining)], true);
        assert!(missing.vacant());
        assert_eq!(
            missing.warnings(),
            [json!({"code": NOT_MERGED, "instances": 2})]
        );
    }

    // Behaviour: a carrier that has triangles of its own keeps them whatever joins: it is never
    // vacant, climbs over the instances that joined, and tells those it left out — in the report
    // of its DAG as in its progress event — or nothing when every instance joined.
    #[test]
    fn a_carrier_with_triangles_of_its_own_keeps_them_and_tells_the_instances_left_out() {
        let (plan, joining, normals) = (plan(&[(0, 0), (0, 1)]), roots(false), roots(true));
        let kept = carrying(&plan, &[((0, 0), &normals), ((0, 1), &normals)], false);
        assert!(!kept.vacant() && kept.assembly(false).instances.is_empty());
        let (mut report, mut told) = (json!({"warnings": []}), Vec::new());
        kept.tell(&mut report, &mut told);
        let warning = json!({"code": NOT_MERGED, "instances": 2});
        assert_eq!(told, std::slice::from_ref(&warning), "the progress event");
        assert_eq!(report["warnings"], json!([warning]), "the DAG report");
        let one = carrying(&plan, &[((0, 0), &joining), ((0, 1), &normals)], false);
        assert!(!one.vacant());
        assert_eq!(one.assembly(false).instances.len(), 1);
        assert_eq!(
            one.warnings(),
            [json!({"code": NOT_MERGED, "instances": 1})]
        );
        let all = carrying(&plan, &[((0, 0), &joining), ((0, 1), &joining)], false);
        let (mut report, mut told) = (json!({"warnings": []}), Vec::new());
        all.tell(&mut report, &mut told);
        assert!(told.is_empty() && report["warnings"] == json!([]));
    }

    // Behaviour: whether the roots of a part carry the carrier's attributes is one verdict for the
    // part, whatever the number of instances that draw it: a hundred of one part join as two do.
    #[test]
    fn many_instances_of_one_part_join_as_two_do() {
        let (plan, joining) = (plan(&[(0, 0); 100]), roots(false));
        let carrying = carrying(&plan, &[((0, 0), &joining)], true);
        assert_eq!(carrying.assembly(false).instances.len(), 100);
        assert!(carrying.warnings().is_empty());
    }
}
