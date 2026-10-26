//! An instanced skinned object's settings as the compiler reads them (`SKINNED_INSTANCE_SETTING`,
//! `SKINNED_INSTANCE_SETTINGS`): the clip it plays, how its track plays, its sampled bounds, the
//! screen size under which it rests, and how it may move (`Mobility`). `true` is every default,
//! `false` no instance, an object its settings over the defaults.
use super::*;

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
    pub(super) fn read(value: &Value, what: &str) -> Result<Option<Self>> {
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
        let looped = Reader {
            map,
            what: &format!("{what}."),
        }
        .boolean(looping)?;
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
