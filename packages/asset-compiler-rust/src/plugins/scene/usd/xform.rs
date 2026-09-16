//! La transformation locale d'un prim : `xformOpOrder` nomme les opérations et leur ordre, chacune
//! est un attribut du prim, et leur produit de gauche à droite est la matrice du nœud glTF.
//!
//! Ce qui n'est pas composable ici est compté par son nom et laissé à l'identité — `!resetXformStack!`,
//! qui coupe la pile du parent et n'a pas d'équivalent dans un graphe glTF, et l'inverse d'une
//! matrice quelconque, qu'on ne calcule pas pour ne pas inventer une transformation.
use super::*;

/// Le préfixe que USD met devant une opération à inverser.
const INVERT: &str = "!invert!";
/// L'entrée qui demande d'ignorer la transformation du père.
const RESET: &str = "!resetXformStack!";
/// Le préfixe de toute opération de transformation.
const PREFIX: &str = "xformOp:";

/// La matrice locale d'un prim, dans l'ordre de glTF. Un prim sans `xformOpOrder` est à l'identité.
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

/// La matrice d'une opération nommée, ou `None` quand ce pilote ne la compose pas.
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

/// Les rotations d'Euler : `rotateX`, `rotateY`, `rotateZ` autour d'un seul axe, et les six ordres
/// `rotateXYZ` … `rotateZYX`, dont les lettres nomment les axes **dans l'ordre d'application au
/// point**, la première étant la plus locale. La matrice compose donc la dernière lettre en
/// premier ; l'inverse renverse l'ordre et les signes.
///
/// Les trois angles, eux, restent rangés `(x, y, z)` sous les six ordres : le nom de l'opération
/// dit dans quel ordre les rotations s'appliquent, jamais dans quel ordre les angles sont écrits.
/// Chaque axe lit donc sa propre composante, et `rotateZYX = (90, 0, 0)` est un quart de tour
/// autour de X.
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

/// Un triplet de translation, nié quand l'opération est inversée.
fn signed(t: [f64; 3], inverted: bool) -> [f64; 3] {
    match inverted {
        true => [-t[0], -t[1], -t[2]],
        false => t,
    }
}

/// L'échelle inverse. Un facteur nul n'a pas d'inverse : il reste nul, et la matrice non inversible
/// qui en sort est reconnue par le contrôle de finitude de `local`.
fn inverse(s: [f64; 3]) -> [f64; 3] {
    s.map(|axis| if axis == 0.0 { 0.0 } else { 1.0 / axis })
}
