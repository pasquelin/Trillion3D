//! What a file says its values are given for, and the arrays a groom keeps of them.
//!
//! A file gives the values of an attribute for the whole object, for each strand or for each point,
//! and names which by a scope (Alembic) or an interpolation (USD). The drivers only map the name
//! they read to a `Scope`; the rest — which values are a strand's and which a point's, how many of
//! them a groom needs, and the table of the distinct group names — is read here, once, for every
//! attribute and every driver (`Description::set_*`).

/// What the values of an attribute are given for, by the scope a file names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Scope {
    /// One value for the whole object.
    Constant,
    /// One for each strand.
    Uniform,
    /// One for each point.
    Vertex,
    /// Any other scope, or none: the count of the values tells what they are given for.
    Other,
}

/// The values of an attribute, given for each strand or for each point.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Given<T> {
    Strands(Vec<T>),
    Points(Vec<T>),
}

impl<T> Given<T> {
    /// The values given for each strand; none if they are given for the points.
    pub(crate) fn strands(self) -> Vec<T> {
        match self {
            Self::Strands(values) => values,
            Self::Points(_) => Vec::new(),
        }
    }

    /// The values given for each point; none if they are given for the strands.
    pub(crate) fn points(self) -> Vec<T> {
        match self {
            Self::Points(values) => values,
            Self::Strands(_) => Vec::new(),
        }
    }
}

/// The first `count` numbers of `values`, the vector itself cut; none when it holds fewer.
fn first<T>(mut values: Vec<T>, count: usize) -> Option<Vec<T>> {
    (values.len() >= count).then(|| {
        values.truncate(count);
        values
    })
}

/// `values`, `width` numbers each, as the `strands` strands take them: the first value for all of
/// them when the scope is constant, else the first value of each; none when `values` holds too few.
fn per_strand<T: Clone>(
    scope: Scope,
    values: Vec<T>,
    width: usize,
    strands: usize,
) -> Option<Vec<T>> {
    if scope == Scope::Constant {
        let each = values.get(..width)?;
        return Some(each.iter().cloned().cycle().take(strands * width).collect());
    }
    first(values, strands * width)
}

/// What `values`, `width` numbers each, are given for, as the groom's `(strands, points)` count them:
/// for each strand where the scope says the object's or each strand's, or where there are as many
/// values as strands; else for each point where the scope says so, or where there are as many values
/// as points. The values are cut to the strands or points they cover; none when they are neither or
/// hold too few.
pub(crate) fn given<T: Clone>(
    scope: Scope,
    values: Vec<T>,
    width: usize,
    (strands, points): (usize, usize),
) -> Option<Given<T>> {
    let held = values.len();
    if matches!(scope, Scope::Constant | Scope::Uniform) || held == strands * width {
        return per_strand(scope, values, width, strands).map(Given::Strands);
    }
    if scope == Scope::Vertex || held == points * width {
        return first(values, points * width).map(Given::Points);
    }
    None
}

/// The distinct names of `each`, in the order they are met, and the rank of every one in them.
pub(super) fn ranked<'a>(each: impl Iterator<Item = &'a str>) -> (Vec<String>, Vec<u32>) {
    let mut names = Vec::new();
    let mut known = std::collections::HashMap::new();
    let ranks = each
        .map(|name| {
            *known.entry(name).or_insert_with(|| {
                names.push(name.to_string());
                (names.len() - 1) as u32
            })
        })
        .collect();
    (names, ranks)
}
