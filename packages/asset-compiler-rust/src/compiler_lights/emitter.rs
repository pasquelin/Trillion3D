//! Le rayon de l'enveloppe qui entoure une lampe : d'où il vient, et ce que le contrat en accepte.
//!
//! Une vraie lampe est posée dans quelque chose — un verre, un réflecteur, un abat-jour — et cette
//! enveloppe est de la géométrie comme une autre : elle entre dans la carte d'ombre de sa propre
//! lampe et l'éteint. `SceneLight.emitterRadius` (`docs/SDK.md`) déclare le rayon de la sphère que
//! cette lampe, et elle seule, cesse d'occulter. Deux provenances, dans cet ordre : le rayon que la
//! source déclare sur la lampe, sinon celui que mesure le corps émissif lié à la lampe.
use super::*;
use crate::compiler_world::Mat4;

mod envelope;

/// Le rayon vient du corps émissif lié à la lampe, et non du fichier source : compté sous ce nom
/// pour que le rapport dise d'où sort la valeur écrite.
const DERIVED: &str = "light-emitter-radius-derived";
/// Un rayon qui ne tient pas le contrat — non fini, nul, négatif, ou au-delà de la portée — est
/// compté sous ce nom et le champ reste absent : une enveloppe plus large que la portée n'en est
/// plus une, et exclure au-delà rejetterait des occultants que l'enveloppe ne contient pas.
const INVALID: &str = "light-emitter-radius-invalid";

/// Ce qu'il faut de la scène pour mesurer une enveloppe : le document, ses octets, la pose de
/// chaque nœud et le parent de chacun — c'est par la parenté que l'enveloppe est liée à sa lampe.
pub(super) struct Emitter<'a> {
    g: &'a Value,
    bin: &'a [u8],
    world: &'a [Mat4],
    parents: Vec<Option<usize>>,
}

impl<'a> Emitter<'a> {
    pub(super) fn new(g: &'a Value, bin: &'a [u8], world: &'a [Mat4]) -> Result<Self> {
        let nodes = values(g, "nodes")?;
        let mut parents = vec![None; nodes.len()];
        for id in 0..nodes.len() {
            for child in crate::compiler_nodes::children_of(nodes, id)? {
                parents[child] = Some(id);
            }
        }
        Ok(Self {
            g,
            bin,
            world,
            parents,
        })
    }

    /// Écrit `emitterRadius` sur une lampe déjà convertie, quand la scène en donne un qui tient le
    /// contrat. Une directionnelle n'a ni position ni portée : le champ lui est refusé sans compte,
    /// puisque aucune sphère ne se pose autour d'une source qui n'a pas de centre.
    pub(super) fn attach(
        &self,
        entry: &mut Value,
        light: &Value,
        node: usize,
        counts: &mut BTreeMap<&'static str, usize>,
    ) {
        let (Some(range), Some(centre)) =
            (entry.get("range").and_then(Value::as_f64), centre_of(entry))
        else {
            return;
        };
        let (radius, code) = match declared(light) {
            Some(radius) => (radius, None),
            None => match envelope::radius(self, node, centre) {
                Some(radius) => (radius, Some(DERIVED)),
                None => return,
            },
        };
        if !(radius.is_finite() && radius > 0.0 && radius < range) {
            *counts.entry(INVALID).or_insert(0) += 1;
            return;
        }
        entry["emitterRadius"] = json!(radius);
        if let Some(code) = code {
            *counts.entry(code).or_insert(0) += 1;
        }
    }
}

/// Le rayon que la source déclare sur la lampe elle-même. Il voyage dans les `extras` de la lampe,
/// le canal que `castsShadow` emprunte déjà : un format dont la lampe porte un rayon le pose là, et
/// aucun second canal n'est ouvert pour lui. Sa valeur est en mètres, comme le reste de la scène.
fn declared(light: &Value) -> Option<f64> {
    light
        .pointer("/extras/emitterRadius")
        .and_then(Value::as_f64)
}

/// Le centre de la lampe, tel que la conversion vient de l'écrire en espace monde.
fn centre_of(entry: &Value) -> Option<[f64; 3]> {
    let items = entry.get("position")?.as_array()?;
    let axis = |i: usize| items.get(i)?.as_f64();
    Some([axis(0)?, axis(1)?, axis(2)?])
}
