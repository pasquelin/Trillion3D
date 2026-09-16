//! Une instance de prefab dont la source est un asset modèle.
//!
//! Le pilote du format a rendu le modèle ; l'instance ne fait que le poser, avec son nom, sa
//! transformation et, s'ils sont déclarés, ses matériaux. Chaque retouche nomme l'objet qu'elle vise
//! par son `fileID` dans le fichier importé, et le `.meta` du modèle dit quel objet porte ce
//! `fileID` : c'est ce nom, jamais l'ordre d'une table, qui décide où la retouche se pose. Une
//! retouche qui vise un objet que ce pilote ne rend pas à part est comptée, jamais versée dans la
//! transformation ou les matériaux d'un autre objet.
use super::*;

impl Builder<'_, '_> {
    pub(super) fn model_instance(&mut self, asset: &Path, changes: &Changes) -> Option<usize> {
        let parts = self.models.parts(asset, self.world)?;
        let aim = Aim::read(&self.models.meta(asset), &parts, changes);
        self.world
            .scene
            .report
            .add_count("unity-prefab-override-unplaced", aim.unplaced);
        let materials: Vec<Vec<Option<usize>>> = aim
            .slots
            .iter()
            .map(|slots| {
                slots
                    .iter()
                    .map(|slot| slot.as_ref().and_then(|named| self.material(named)))
                    .collect()
            })
            .collect();
        let children = self.attach_each(&parts, &materials);
        let name = changes.name.clone().or_else(|| {
            asset
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
        })?;
        let mut node = json!({"name":name,"children":children});
        // Une instance de modèle n'a pas de transformation propre dans le fichier : tout vient de la
        // retouche qui vise sa racine, et l'identité quand il n'y en a pas.
        let trs = local_trs(&Yaml::BadValue, &aim.root);
        if trs.is_finite() {
            trs.write(&mut node);
        } else {
            self.world.scene.report.add("unity-invalid-transform");
        }
        Some(self.world.scene.node(node))
    }
}

/// Où les retouches d'une instance de modèle se posent : la transformation de sa racine, les
/// emplacements de matériau de chaque morceau, et le nombre de retouches qu'aucun objet rendu ne
/// porte — celles qui visent un objet du modèle que le pilote n'instancie pas à part, et celles
/// d'une seconde racine, que rien ne départage.
struct Aim {
    root: Overrides,
    slots: Vec<Vec<Option<Ref>>>,
    unplaced: usize,
}

impl Aim {
    fn read(meta: &ModelImport, parts: &Parts, changes: &Changes) -> Aim {
        // Le morceau que ce `fileID` nomme, quand le `.meta` le nomme et que le modèle le porte.
        let part = |target: i64| {
            let name = meta.name(target)?;
            parts.nodes.iter().position(|(node, _, _)| node == name)
        };
        // Un modèle d'un seul morceau ne laisse aucun doute : ses matériaux sont les siens.
        let sole = || (parts.nodes.len() == 1).then_some(0);
        let mut aim = Aim {
            root: Overrides::new(),
            slots: vec![Vec::new(); parts.nodes.len()],
            unplaced: 0,
        };
        let mut root_seen = false;
        for (target, values) in changes.transform_targets() {
            if part(target).is_none() && !root_seen {
                root_seen = true;
                aim.root
                    .extend(values.iter().map(|(path, value)| (path.clone(), *value)));
            } else {
                aim.unplaced += values.len();
            }
        }
        for (target, replaced) in changes.material_targets() {
            match part(target).or_else(sole) {
                Some(rank) if aim.slots[rank].is_empty() => aim.slots[rank] = replaced.to_vec(),
                _ => aim.unplaced += replaced.iter().filter(|slot| slot.is_some()).count(),
            }
        }
        aim
    }
}
