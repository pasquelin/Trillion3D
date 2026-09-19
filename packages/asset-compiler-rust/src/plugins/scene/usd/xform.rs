//! Local transform of a prim: `xformOpOrder` names the operations and their order, each is a
//! prim attribute, and their left-to-right product is the glTF node matrix.
//!
//! What is not composable here is counted by name and left at identity — `!resetXformStack!`,
//! which cuts the parent stack and has no equivalent in a glTF graph, and the inverse of an
//! arbitrary matrix, which is not computed so as not to invent a transform.
use super::*;

/// Prefix USD puts in front of an operation to invert.
const INVERT: &str = "!invert!";
/// Entry that asks to ignore the parent's transform.
const RESET: &str = "!resetXformStack!";
/// Prefix of every transform operation.
const PREFIX: &str = "xformOp:";

/// Local matrix of a prim, in glTF order. A prim without `xformOpOrder` is at identity.
pub(super) fn local(world: &mut World<'_>, prim: &usd::Prim) -> [f64; 16] {
    let order = match read::first(&prim.attribute("xformOpOrder")) {
        Some((sdf::Value::TokenVec(order), _)) => order,
        _ => return matrix::IDENTITY,
    };
    let mut out = matrix::IDENTITY;
    for entry in &order {
        let entry = entry.as_str();
        if entry == RESET {
            world.refuse(world::XFORM_UNSUPPORTED);
            continue;
        }
        let (inverted, name) = match entry.strip_prefix(INVERT) {
            Some(name) => (true, name),
            None => (false, entry),
        };
        match operation(world, prim, name, inverted) {
            Some(op) => out = matrix::mul(&out, &op),
            None => world.refuse(world::XFORM_UNSUPPORTED),
        }
    }
    if out.iter().all(|value| value.is_finite()) {
        return out;
    }
    world.refuse(world::XFORM_INVALID);
    matrix::IDENTITY
}

/// Matrix of a named operation, or `None` when this driver does not compose it.
fn operation(
    world: &mut World<'_>,
    prim: &usd::Prim,
    name: &str,
    inverted: bool,
) -> Option<[f64; 16]> {
    let kind = name.strip_prefix(PREFIX)?.split(':').next()?;
    let (value, sampled) = read::first(&prim.attribute(name))?;
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    match kind {
        "translate" => {
            let t = read::triple(&value)?;
            Some(matrix::translation(signed(t, inverted)))
        }
        "scale" => {
            let s = read::triple(&value)?;
            Some(matrix::scaling(if inverted { inverse(s) } else { s }))
        }
        "transform" => (!inverted).then(|| read::matrix(&value)).flatten(),
        "orient" => {
            let [w, x, y, z] = read::quaternion(&value)?;
            let q = if inverted {
                [w, -x, -y, -z]
            } else {
                [w, x, y, z]
            };
            Some(matrix::orientation(q))
        }
        _ => euler(kind, &value, inverted),
    }
}

/// Euler rotations: `rotateX`, `rotateY`, `rotateZ` around a single axis, and the six orders
/// `rotateXYZ` … `rotateZYX`, whose letters name the axes **in the order of application to the
/// point**, the first being the most local. The matrix therefore composes the last letter
/// first; the inverse reverses the order and the signs.
///
/// The three angles themselves stay stored `(x, y, z)` under the six orders: the operation name
/// says in which order the rotations apply, never in which order the angles are written. Each
/// axis therefore reads its own component, and `rotateZYX = (90, 0, 0)` is a quarter turn
/// around X.
fn euler(kind: &str, value: &sdf::Value, inverted: bool) -> Option<[f64; 16]> {
    let axes: Vec<usize> = kind
        .strip_prefix("rotate")?
        .chars()
        .map(|axis| "XYZ".find(axis))
        .collect::<Option<_>>()?;
    let mut steps: Vec<(usize, f64)> = match axes[..] {
        [axis] => vec![(axis, read::number(value)?)],
        [_, _, _] => {
            let angles = read::triple(value)?;
            axes.iter().map(|axis| (*axis, angles[*axis])).collect()
        }
        _ => return None,
    };
    if inverted {
        steps.iter_mut().for_each(|step| step.1 = -step.1);
    } else {
        steps.reverse();
    }
    let mut out = matrix::IDENTITY;
    for (axis, angle) in steps {
        out = matrix::mul(&out, &matrix::rotation(axis, angle));
    }
    Some(out)
}

/// A translation triple, negated when the operation is inverted.
fn signed(t: [f64; 3], inverted: bool) -> [f64; 3] {
    match inverted {
        true => [-t[0], -t[1], -t[2]],
        false => t,
    }
}

/// Inverse scale. A zero factor has no inverse: it stays zero, and the non-invertible matrix
/// that comes out of it is recognised by `local`'s finiteness check.
fn inverse(s: [f64; 3]) -> [f64; 3] {
    s.map(|axis| if axis == 0.0 { 0.0 } else { 1.0 / axis })
}
