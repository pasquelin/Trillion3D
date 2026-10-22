//! An object's draw distance as the compiler reads it (`DRAW_DISTANCE_SETTING`, `objectOptions.ts`
//! writes it): the nearest and the farthest distance from the eye, in the scene's units, the
//! object is drawn at, the cut testing them on the centre of its bounds. `false` names none; an
//! object names `min` and `max` (`DRAW_DISTANCE_SETTINGS`), each a finite number of at least 0,
//! each left out its default (`DEFAULT_DRAW_DISTANCE_MIN`, `DEFAULT_DRAW_DISTANCE_MAX`). A `max`
//! of 0 names no farthest distance: the object is drawn at every distance, whatever its `min`, as
//! `false` says — one form for none, so a `Some` is always a distance the cut tests.
use super::*;

/// An object's draw distance, both keys resolved, its `max` above 0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DrawDistance {
    /// The distance under which the object is not drawn.
    pub min: f64,
    /// The distance past which the object is not drawn.
    pub max: f64,
}

impl DrawDistance {
    /// How the scene's tables write it: `{ "min", "max" }`, in the scene's units.
    pub(crate) fn entry(&self) -> Value {
        json!({"min": self.min, "max": self.max})
    }

    /// The draw distance `value` names, `what` naming where it was read for the refusal of one that
    /// does not read: `false` none, an object its `min` and `max` over the defaults — none too when
    /// its `max` is 0.
    pub(super) fn read(value: &Value, what: &str) -> Result<Option<Self>> {
        if value.as_bool() == Some(false) {
            return Ok(None);
        }
        if !value.is_object() {
            let keys = DRAW_DISTANCE_SETTINGS.join(", ");
            return Err(OPTIONS.bad(format!("{what} must be false or {{ {keys} }}")));
        }
        let map = OPTIONS.known(value, &DRAW_DISTANCE_SETTINGS, what)?;
        let distance = |key: &str, default: f64| {
            present(map.get(key))
                .map(|v| {
                    let takes = "a finite number of at least 0";
                    OPTIONS.bounded(v, &format!("{what}.{key}"), (0.0, f64::MAX), takes)
                })
                .transpose()
                .map(|named| named.unwrap_or(default))
        };
        let [min, max] = DRAW_DISTANCE_SETTINGS;
        let (min, max) = (
            distance(min, DEFAULT_DRAW_DISTANCE_MIN)?,
            distance(max, DEFAULT_DRAW_DISTANCE_MAX)?,
        );
        Ok((max > 0.0).then_some(Self { min, max }))
    }
}
