//! A job's object settings as the compiler reads them (`objectOptions.ts` writes them): for each
//! node of the scene, the settings of `OBJECT_SETTINGS` (`ObjectSetting`) — whether it streams on
//! the partition's main grid, whether a skinned one is an instanced skinned object playing a
//! clip baked into the scene's animation banks (`SkinnedInstance`, `../tables/motion/bank.rs`),
//! the distances it is drawn at (`DrawDistance`, `draw_distance.rs`), and the name of the
//! streaming grid it streams on (`RUNTIME_GRID_SETTING`, `PartitionGrid`), whether a view's
//! primed depth draws it (`FAR_FIELD_SETTING`), whether it casts far shadows
//! (`CAST_FAR_SHADOW_SETTING`) and whether a sun's far-shadow test reaches it
//! (`FAR_SHADOW_TEST_SETTING`, none when no source names it: the view's rule decides).
//! For each setting of a node, the first that names it:
//! 1. the first rule of `objectSettings.objects` whose match names the node, as `meshBuild` names
//!    its objects;
//! 2. `objectSettings`' own setting, the scene's;
//! 3. the node's own `extras` under the setting's name;
//! 4. the default, the reference's.
//!
//! `skinnedInstance` is one value, the source naming it gives it whole: `true` every default,
//! `false` no instance, an object its settings (`SKINNED_INSTANCE_SETTINGS`) over the defaults;
//! so is `drawDistance`: `false` none, an object its keys (`DRAW_DISTANCE_SETTINGS`) over the
//! defaults.
//!
//! A job naming no `objectSettings` compiles as before, its cache key unchanged. Read and checked
//! here once; what does not read is the job's refusal (`INVALID_OPTIONS`,
//! `validate_compile_options`), never the batch's — a node's `extras` setting that does not read
//! included, when the node is resolved.
use super::name_match::{present, NodeNames, Rules};
use super::partition::grid_name_of;
use super::reader::Reader;
use super::*;
use crate::compiler::validate::OPTIONS;
pub(crate) use draw_distance::DrawDistance;
pub(crate) use skinned::{ClipChoice, SkinnedInstance};

mod draw_distance;
mod skinned;

/// One node's settings, every one resolved (`ObjectSettings::node`): whether it streams on the
/// partition's main grid (`SPATIALLY_LOADED_SETTING`), the instance it is when a skinned one
/// is instanced (`SKINNED_INSTANCE_SETTING`), none when it is not, and the name of the streaming
/// grid it streams on (`RUNTIME_GRID_SETTING`), none for the first grid, whether a view's
/// primed depth draws it (`FAR_FIELD_SETTING`), whether it casts far shadows
/// (`CAST_FAR_SHADOW_SETTING`) and whether a sun's far-shadow test reaches it
/// (`FAR_SHADOW_TEST_SETTING`), none when no source names it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ObjectSetting {
    pub spatially_loaded: bool,
    pub skinned: Option<SkinnedInstance>,
    pub draw_distance: Option<DrawDistance>,
    pub runtime_grid: Option<String>,
    pub far_field: bool,
    pub cast_far_shadow: bool,
    pub far_shadow_test: Option<bool>,
}

/// The settings one source names, each none where it names none; `skinned` names its instance,
/// or none for `false`.
#[derive(Clone, Debug, Default)]
struct Named {
    spatially_loaded: Option<bool>,
    skinned: Option<Option<SkinnedInstance>>,
    draw_distance: Option<Option<DrawDistance>>,
    runtime_grid: Option<String>,
    far_field: Option<bool>,
    cast_far_shadow: Option<bool>,
    far_shadow_test: Option<bool>,
}

impl Named {
    /// The settings of `OBJECT_SETTINGS` `map` holds, its other keys read by others; `what` names
    /// where they were read, for the refusal of one that does not read.
    fn of(map: &Map<String, Value>, what: &str) -> Result<Self> {
        let read = Reader { map, what };
        let spatially_loaded = read.boolean(SPATIALLY_LOADED_SETTING)?;
        let skinned = present(map.get(SKINNED_INSTANCE_SETTING))
            .map(|v| SkinnedInstance::read(v, &format!("{what}{SKINNED_INSTANCE_SETTING}")))
            .transpose()?;
        let draw_distance = present(map.get(DRAW_DISTANCE_SETTING))
            .map(|v| DrawDistance::read(v, &format!("{what}{DRAW_DISTANCE_SETTING}")))
            .transpose()?;
        let far_field = read.boolean(FAR_FIELD_SETTING)?;
        let cast_far_shadow = read.boolean(CAST_FAR_SHADOW_SETTING)?;
        let far_shadow_test = read.boolean(FAR_SHADOW_TEST_SETTING)?;
        let runtime_grid = present(map.get(RUNTIME_GRID_SETTING))
            .map(|v| match grid_name_of(v) {
                Some(name) => Ok(name.to_string()),
                None => Err(OPTIONS.bad(format!(
                    "{what}{RUNTIME_GRID_SETTING} must be the name of a streaming grid, a text \
                     with none of {PARTITION_GRID_NAME_FORBIDDEN}, got {v}"
                ))),
            })
            .transpose()?;
        Ok(Self {
            spatially_loaded,
            skinned,
            draw_distance,
            runtime_grid,
            far_field,
            cast_far_shadow,
            far_shadow_test,
        })
    }

    /// These settings, each that names none taken from `lower`.
    fn or(self, lower: &Self) -> Self {
        Self {
            spatially_loaded: self.spatially_loaded.or(lower.spatially_loaded),
            skinned: self.skinned.or_else(|| lower.skinned.clone()),
            draw_distance: self.draw_distance.or(lower.draw_distance),
            runtime_grid: self.runtime_grid.or_else(|| lower.runtime_grid.clone()),
            far_field: self.far_field.or(lower.far_field),
            cast_far_shadow: self.cast_far_shadow.or(lower.cast_far_shadow),
            far_shadow_test: self.far_shadow_test.or(lower.far_shadow_test),
        }
    }

    /// Every setting, the default where none was named: a node no source instances is not.
    fn resolved(self) -> ObjectSetting {
        ObjectSetting {
            spatially_loaded: self.spatially_loaded.unwrap_or(DEFAULT_SPATIALLY_LOADED),
            skinned: self.skinned.flatten(),
            draw_distance: self.draw_distance.flatten(),
            runtime_grid: self.runtime_grid,
            far_field: self.far_field.unwrap_or(DEFAULT_FAR_FIELD),
            cast_far_shadow: self.cast_far_shadow.unwrap_or(DEFAULT_CAST_FAR_SHADOW),
            far_shadow_test: self.far_shadow_test,
        }
    }
}

/// A job's `objectSettings`: the scene's settings, the rules by object, and what named them, its
/// cache identity; none for none.
#[derive(Clone, Debug, Default)]
pub struct ObjectSettings {
    rules: Rules<Named>,
}

impl ObjectSettings {
    /// The settings the job's `objectSettings` field names, none for none; `Err` with the job's
    /// refusal when they do not read.
    pub fn read(value: Option<&Value>) -> std::result::Result<Self, String> {
        let settings: &[&str] = &OBJECT_SETTINGS;
        let names = (OBJECT_SETTINGS_FIELD, settings, OBJECT_SETTINGS_OBJECTS);
        Rules::read(value, names, Named::of)
            .map(|rules| Self { rules })
            .map_err(|e| e.message)
    }

    /// What named the settings, for the cache key: `None` when the job names none.
    pub fn identity(&self) -> Option<&Value> {
        self.rules.identity()
    }

    /// The settings of published node `node` of `g`, by the precedence the module states; `Err`
    /// when the node's own `extras` setting does not read.
    pub(crate) fn node(&self, g: &Value, node: usize) -> Result<ObjectSetting> {
        let entry = g.get("nodes").and_then(|nodes| nodes.get(node));
        let ruled = if self.rules.objects.is_empty() {
            Named::default()
        } else {
            let names = NodeNames::of(g, node);
            (self.rules.objects.iter())
                .filter(|(matcher, _)| matcher.matches(&names))
                .fold(Named::default(), |named, (_, rule)| named.or(rule))
        };
        // A node that names no extras names no setting there: nothing to read, nothing to name.
        let own = match entry
            .and_then(|n| n.get("extras"))
            .and_then(Value::as_object)
        {
            Some(extras) if !extras.is_empty() => {
                Named::of(extras, &format!("nodes[{node}].extras."))?
            }
            _ => Named::default(),
        };
        Ok(ruled.or(&self.rules.scene).or(&own).resolved())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Behaviour: every switch of an object reads by the one reader of the job's maps: one that is
    // no boolean is refused by name, saying what it takes and what it got.
    #[test]
    fn a_switch_that_is_no_boolean_is_refused_by_name_with_what_it_takes() {
        for key in [
            SPATIALLY_LOADED_SETTING,
            FAR_FIELD_SETTING,
            CAST_FAR_SHADOW_SETTING,
            FAR_SHADOW_TEST_SETTING,
        ] {
            let refusal = ObjectSettings::read(Some(&json!({ key: "yes" }))).expect_err(key);
            assert_eq!(
                refusal,
                format!("objectSettings.{key} must be true or false, got \"yes\""),
            );
        }
        let looping = json!({ SKINNED_INSTANCE_SETTING: {"looping": 3} });
        let refusal = ObjectSettings::read(Some(&looping)).expect_err("looping");
        assert!(
            refusal.ends_with("skinnedInstance.looping must be true or false, got 3"),
            "{refusal}"
        );
    }
}
