//! A prefab instance whose source is a model asset.
//!
//! The format driver has yielded the model; the instance only places it, with its name, its
//! transform and, if they are declared, its materials. Each override names the object it
//! targets by its `fileID` in the imported file, and the model's `.meta` says which object
//! carries that `fileID`: it is that name, never the order of a table, that decides where the
//! override sits. An override that targets an object this driver does not yield separately is
//! counted, never poured into another object's transform or materials.
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
        // A model instance has no transform of its own in the file: everything comes from the
        // override that targets its root, and identity when there is none.
        let trs = local_trs(&Yaml::BadValue, &aim.root);
        if trs.is_finite() {
            trs.write(&mut node);
        } else {
            self.world.scene.report.add("unity-invalid-transform");
        }
        Some(self.world.scene.node(node))
    }
}

/// Where a model instance's overrides sit: its root transform, each piece's material slots, and
/// the number of overrides no rendered object carries — those that target an object of the
/// model the driver does not instantiate separately, and those of a second root, which nothing
/// distinguishes.
struct Aim {
    root: Overrides,
    slots: Vec<Vec<Option<Ref>>>,
    unplaced: usize,
}

impl Aim {
    fn read(meta: &ModelImport, parts: &Parts, changes: &Changes) -> Aim {
        // The piece this `fileID` names, when the `.meta` names it and the model carries it.
        let part = |target: i64| {
            let name = meta.name(target)?;
            parts.nodes.iter().position(|(node, _, _)| node == name)
        };
        // A single-piece model leaves no doubt: its materials are its own.
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
