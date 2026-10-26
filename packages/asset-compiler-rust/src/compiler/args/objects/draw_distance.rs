//! An object's draw distance as the compiler reads it (`DRAW_DISTANCE_SETTING`, `objectOptions.ts`
//! writes it): the nearest and the farthest distance from the eye, in the scene's units, the
//! object is drawn at, the cut testing them on the sphere of its bounds — or, for an object that
//! says it is one instance of an instanced mesh (`perInstance`), on the centre of its bounds.
//! `false` names none; an object names `min`, `max` and `perInstance` (`DRAW_DISTANCE_SETTINGS`),
//! the distances each a finite number of at least 0, each left out its default
//! (`DEFAULT_DRAW_DISTANCE_MIN`, `DEFAULT_DRAW_DISTANCE_MAX`, `DEFAULT_DRAW_DISTANCE_PER_INSTANCE`).
//! An object that names no distance is `false` too — one form for none, so a `Some` is always a
//! distance the cut tests: a `max` of 0 and a `min` of 0, or, for an instance, a `max` of 0 (its
//! `min` alone is none).
use super::*;
use crate::compiler::args::reader::Reader;

/// An object's draw distance, its keys resolved, a distance the cut tests.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DrawDistance {
    /// The distance under which the object is not drawn.
    pub min: f64,
    /// The distance past which the object is not drawn, 0 none.
    pub max: f64,
    /// Whether the object is one instance of an instanced mesh: tested at its bounds' centre.
    pub per_instance: bool,
}

impl DrawDistance {
    /// How the scene's tables write it: `{ "min", "max", "perInstance" }`, in the scene's units.
    pub(crate) fn entry(&self) -> Value {
        json!({"min": self.min, "max": self.max, "perInstance": self.per_instance})
    }

    /// The draw distance `value` names, `what` naming where it was read for the refusal of one that
    /// does not read: `false` none, an object its keys over the defaults — none too when it names
    /// no distance.
    pub(super) fn read(value: &Value, what: &str) -> Result<Option<Self>> {
        if value.as_bool() == Some(false) {
            return Ok(None);
        }
        if !value.is_object() {
            let keys = DRAW_DISTANCE_SETTINGS.join(", ");
            return Err(OPTIONS.bad(format!("{what} must be false or {{ {keys} }}")));
        }
        let map = OPTIONS.known(value, &DRAW_DISTANCE_SETTINGS, what)?;
        let prefix = format!("{what}.");
        let read = Reader { map, what: &prefix };
        let distance = |key: &str, default: f64| {
            let takes = "a finite number of at least 0";
            let named = read.number(key, (0.0, f64::MAX), takes)?;
            Ok::<f64, CompilerError>(named.unwrap_or(default))
        };
        let [min, max, per_instance] = DRAW_DISTANCE_SETTINGS;
        let (min, max) = (
            distance(min, DEFAULT_DRAW_DISTANCE_MIN)?,
            distance(max, DEFAULT_DRAW_DISTANCE_MAX)?,
        );
        let per_instance = read
            .boolean(per_instance)?
            .unwrap_or(DEFAULT_DRAW_DISTANCE_PER_INSTANCE);
        let named = max > 0.0 || (!per_instance && min > 0.0);
        Ok(named.then_some(Self {
            min,
            max,
            per_instance,
        }))
    }
}
