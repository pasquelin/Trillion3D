//! A job's object settings as the compiler reads them (`objectOptions.ts` writes them): for each
//! node of the scene, the settings of `OBJECT_SETTINGS` (`ObjectSetting`) — whether it streams on
//! the partition's main grid, whether a skinned one is an instanced skinned object playing a
//! clip baked into the scene's animation banks (`SkinnedInstance`, `../tables/motion/bank.rs`),
//! the distances it is drawn at (`DrawDistance`, `draw_distance.rs`), and the name of the
//! streaming grid it streams on (`RUNTIME_GRID_SETTING`, `PartitionGrid`), and whether a view's
//! primed depth draws it (`FAR_FIELD_SETTING`).
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
use super::name_match::{present, read_rules, NameMatch, NodeNames};
use super::partition::grid_name_of;
use super::*;
use crate::compiler::validate::OPTIONS;
pub(crate) use draw_distance::DrawDistance;

mod draw_distance;

/// The animation an instanced skinned object plays: its rank in the document, or its name. None
/// names the first animation of the document that moves a joint of the object's skin.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ClipChoice {
    Rank(usize),
    Name(String),
}

/// How an instanced skinned object may move, one of `OBJECT_MOBILITIES`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Mobility {
    Static,
    Stationary,
    Movable,
}

/// The mobilities in the order `OBJECT_MOBILITIES` names them.
const MOBILITIES: [Mobility; 3] = [Mobility::Static, Mobility::Stationary, Mobility::Movable];

impl Mobility {
    /// The mobility `OBJECT_MOBILITIES` names `text`, none for another text.
    fn of(text: &str) -> Option<Self> {
        (OBJECT_MOBILITIES.iter())
            .position(|named| *named == text)
            .map(|at| MOBILITIES[at])
    }

    /// Whether an HLOD may stand for the object: a static one, and a stationary one, which is
    /// taken as static; a movable one never.
    pub fn hlod_relevant(self) -> bool {
        matches!(self, Self::Static | Self::Stationary)
    }
}

/// An instanced skinned object's settings, every one resolved: the clip it plays, whether its
/// track wraps or holds its last pose, the seconds of the clip a second plays, the second it
/// starts from, the scale of its sampled bounds about their centre, the screen size under which it
/// is drawn in its rest pose — 0 the run-time setting, a negative one never —, and its mobility.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SkinnedInstance {
    pub clip: Option<ClipChoice>,
    pub looping: bool,
    pub play_rate: f64,
    pub position: f64,
    pub bounds_scale: f64,
    pub min_screen_size: f64,
    pub mobility: Mobility,
}

impl Default for SkinnedInstance {
    /// Every setting at its default, the reference's.
    fn default() -> Self {
        Self {
            clip: None,
            looping: DEFAULT_BANK_LOOPING,
            play_rate: DEFAULT_BANK_PLAY_RATE,
            position: DEFAULT_BANK_POSITION,
            bounds_scale: DEFAULT_BANK_BOUNDS_SCALE,
            min_screen_size: DEFAULT_OBJECT_ANIMATION_MIN_SCREEN_SIZE,
            mobility: Mobility::of(DEFAULT_OBJECT_MOBILITY)
                .expect("the default mobility is one of OBJECT_MOBILITIES"),
        }
    }
}

impl SkinnedInstance {
    /// The instance `value` names, `what` naming where it was read for the refusal of one that
    /// does not read: `true` every default, `false` none, an object its settings over the
    /// defaults — a clip an unsigned integer or a text, a finite play rate, a finite position of at
    /// least 0, a finite bounds scale above 0, a finite screen size and one of the mobilities.
    fn read(value: &Value, what: &str) -> Result<Option<Self>> {
        if let Some(on) = value.as_bool() {
            return Ok(on.then(Self::default));
        }
        if !value.is_object() {
            let settings = SKINNED_INSTANCE_SETTINGS.join(", ");
            return Err(OPTIONS.bad(format!("{what} must be true, false or {{ {settings} }}")));
        }
        let map = OPTIONS.known(value, &SKINNED_INSTANCE_SETTINGS, what)?;
        let [clip, looping, play_rate, position, bounds_scale, min_screen_size, mobility] =
            SKINNED_INSTANCE_SETTINGS;
        let refused = |key: &str, takes: &str, v: &Value| {
            OPTIONS.bad(format!("{what}.{key} must be {takes}, got {v}"))
        };
        // A finite number `admits` takes, `takes` saying which in the refusal.
        let number = |key: &str, admits: fn(f64) -> bool, takes: &str| {
            present(map.get(key))
                .map(|v| {
                    (v.as_f64())
                        .filter(|&n| n.is_finite() && admits(n))
                        .ok_or_else(|| refused(key, takes, v))
                })
                .transpose()
        };
        let chosen = present(map.get(clip))
            .map(|v| match v {
                Value::String(name) => Ok(ClipChoice::Name(name.clone())),
                _ => (v.as_u64())
                    .and_then(|rank| usize::try_from(rank).ok())
                    .map(ClipChoice::Rank)
                    .ok_or_else(|| refused(clip, "an animation's rank or name", v)),
            })
            .transpose()?;
        let moving = present(map.get(mobility))
            .map(|v| {
                (v.as_str())
                    .and_then(Mobility::of)
                    .ok_or_else(|| refused(mobility, &OBJECT_MOBILITIES.join(", "), v))
            })
            .transpose()?;
        let looped = present(map.get(looping))
            .map(|v| OPTIONS.boolean(Some(v), &format!("{what}.{looping}")))
            .transpose()?;
        let any = |_: f64| true;
        let defaults = Self::default();
        Ok(Some(Self {
            clip: chosen,
            looping: looped.unwrap_or(defaults.looping),
            play_rate: number(play_rate, any, "a finite number")?.unwrap_or(defaults.play_rate),
            position: number(position, |n| n >= 0.0, "a number of at least 0")?
                .unwrap_or(defaults.position),
            bounds_scale: number(bounds_scale, |n| n > 0.0, "a number above 0")?
                .unwrap_or(defaults.bounds_scale),
            min_screen_size: number(min_screen_size, any, "a finite number")?
                .unwrap_or(defaults.min_screen_size),
            mobility: moving.unwrap_or(defaults.mobility),
        }))
    }
}

/// One node's settings, every one resolved (`ObjectSettings::node`): whether it streams on the
/// partition's main grid (`SPATIALLY_LOADED_SETTING`), the instance it is when a skinned one
/// is instanced (`SKINNED_INSTANCE_SETTING`), none when it is not, and the name of the streaming
/// grid it streams on (`RUNTIME_GRID_SETTING`), none for the first grid, and whether a view's
/// primed depth draws it (`FAR_FIELD_SETTING`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ObjectSetting {
    pub spatially_loaded: bool,
    pub skinned: Option<SkinnedInstance>,
    pub draw_distance: Option<DrawDistance>,
    pub runtime_grid: Option<String>,
    pub far_field: bool,
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
}

impl Named {
    /// The settings of `OBJECT_SETTINGS` `map` holds, its other keys read by others; `what` names
    /// where they were read, for the refusal of one that does not read.
    fn of(map: &Map<String, Value>, what: &str) -> Result<Self> {
        let spatially_loaded = present(map.get(SPATIALLY_LOADED_SETTING))
            .map(|v| OPTIONS.boolean(Some(v), &format!("{what}{SPATIALLY_LOADED_SETTING}")))
            .transpose()?;
        let skinned = present(map.get(SKINNED_INSTANCE_SETTING))
            .map(|v| SkinnedInstance::read(v, &format!("{what}{SKINNED_INSTANCE_SETTING}")))
            .transpose()?;
        let draw_distance = present(map.get(DRAW_DISTANCE_SETTING))
            .map(|v| DrawDistance::read(v, &format!("{what}{DRAW_DISTANCE_SETTING}")))
            .transpose()?;
        let far_field = present(map.get(FAR_FIELD_SETTING))
            .map(|v| OPTIONS.boolean(Some(v), &format!("{what}{FAR_FIELD_SETTING}")))
            .transpose()?;
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
        }
    }
}

/// A job's `objectSettings`: the scene's settings, the rules by object, and what named them, its
/// cache identity; none for none.
#[derive(Clone, Debug, Default)]
pub struct ObjectSettings {
    scene: Named,
    objects: Vec<(NameMatch, Named)>,
    identity: Option<Value>,
}

impl ObjectSettings {
    /// The settings the job's `objectSettings` field names, none for none; `Err` with the job's
    /// refusal when they do not read.
    pub fn read(value: Option<&Value>) -> std::result::Result<Self, String> {
        Self::parse(value).map_err(|e| e.message)
    }

    fn parse(value: Option<&Value>) -> Result<Self> {
        let Some(value) = present(value) else {
            return Ok(Self::default());
        };
        let settings: &[&str] = &OBJECT_SETTINGS;
        let names = (OBJECT_SETTINGS_FIELD, settings, OBJECT_SETTINGS_OBJECTS);
        let (scene, objects) = read_rules(value, names, Named::of)?;
        Ok(Self {
            scene,
            objects,
            identity: Some(value.clone()),
        })
    }

    /// What named the settings, for the cache key: `None` when the job names none.
    pub fn identity(&self) -> Option<&Value> {
        self.identity.as_ref()
    }

    /// The settings of published node `node` of `g`, by the precedence the module states; `Err`
    /// when the node's own `extras` setting does not read.
    pub(crate) fn node(&self, g: &Value, node: usize) -> Result<ObjectSetting> {
        let entry = g.get("nodes").and_then(|nodes| nodes.get(node));
        let ruled = if self.objects.is_empty() {
            Named::default()
        } else {
            let names = NodeNames::of(g, node);
            (self.objects.iter())
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
        Ok(ruled.or(&self.scene).or(&own).resolved())
    }
}
