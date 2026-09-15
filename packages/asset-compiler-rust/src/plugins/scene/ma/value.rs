//! La valeur d'un attribut, et la place qu'un intervalle d'indices lui donne.
//!
//! Un attribut Maya s'écrit en plusieurs fois : `setAttr ".vt[0:2]"` puis `setAttr ".vt[3]"`
//! remplissent le même tableau à des rangs différents. Une valeur est donc un tableau que l'on
//! garnit par tranches, jamais un remplacement. Un rang au-delà du plafond d'éléments du pilote ne
//! fait pas allouer : il est refusé, et l'appelant le compte.
use super::*;

/// La valeur d'un attribut, dans la seule forme que la scène intermédiaire ait à en faire.
pub(super) enum Attr {
    /// Des nombres à plat : sommets, arêtes, normales, angles, couleurs, coordonnées de texture.
    Numbers(Vec<f64>),
    /// Des chaînes : un nom de fichier de texture, une liste de composants de face.
    Texts(Vec<String>),
    /// Un booléen : la visibilité d'un nœud, un interrupteur de nuanceur.
    Flag(bool),
    /// Les faces polygonales que `.fc` écrit, déjà séparées en enregistrements.
    Faces(Vec<faces::Face>),
}

impl Attr {
    /// Les nombres de cet attribut, ou rien quand il n'en porte pas.
    pub(super) fn numbers(&self) -> &[f64] {
        match self {
            Self::Numbers(values) => values,
            _ => &[],
        }
    }
    /// Les chaînes de cet attribut.
    pub(super) fn texts(&self) -> &[String] {
        match self {
            Self::Texts(values) => values,
            _ => &[],
        }
    }
    /// Les faces de cet attribut.
    pub(super) fn faces(&self) -> &[faces::Face] {
        match self {
            Self::Faces(values) => values,
            _ => &[],
        }
    }
    /// Le booléen de cet attribut. Un nombre unique en tient lieu : `setAttr ".v" 0` est écrit ainsi.
    pub(super) fn flag(&self) -> Option<bool> {
        match self {
            Self::Flag(value) => Some(*value),
            Self::Numbers(values) => match values.as_slice() {
                [value] => Some(*value != 0.0),
                _ => None,
            },
            _ => None,
        }
    }
    /// Le premier nombre de cet attribut.
    pub(super) fn scalar(&self) -> Option<f64> {
        self.numbers().first().copied()
    }
    /// Les trois nombres de cet attribut — une couleur, une translation, trois angles.
    pub(super) fn triple(&self) -> Option<[f64; 3]> {
        match self.numbers() {
            [x, y, z, ..] => Some([*x, *y, *z]),
            _ => None,
        }
    }

    /// Verse `values` à partir du rang `at`, en comblant par des valeurs neutres ce qu'aucune
    /// commande n'a encore écrit. Rend `false` quand la variante ne correspond pas à ce qui est
    /// déjà là, ou quand le rang visé dépasse le plafond d'éléments.
    pub(super) fn splice(&mut self, at: usize, values: Self) -> bool {
        if let Self::Flag(_) = values {
            *self = values;
            return at == 0;
        }
        match (self, values) {
            (Self::Numbers(into), Self::Numbers(from)) => place(into, at, from),
            (Self::Texts(into), Self::Texts(from)) => place(into, at, from),
            (Self::Faces(into), Self::Faces(from)) => place(into, at, from),
            _ => false,
        }
    }

    /// La variante vide de même forme, pour accueillir une première tranche.
    pub(super) fn empty_like(&self) -> Self {
        match self {
            Self::Numbers(_) => Self::Numbers(Vec::new()),
            Self::Texts(_) => Self::Texts(Vec::new()),
            Self::Faces(_) => Self::Faces(Vec::new()),
            Self::Flag(value) => Self::Flag(*value),
        }
    }
}

/// Verse `from` dans `into` au rang `at`, en comblant le trou par des valeurs neutres.
fn place<T: Clone + Default>(into: &mut Vec<T>, at: usize, from: Vec<T>) -> bool {
    let Some(end) = at
        .checked_add(from.len())
        .filter(|end| *end <= MAX_ELEMENTS)
    else {
        return false;
    };
    if into.len() < end {
        into.resize(end, T::default());
    }
    into[at..end].clone_from_slice(&from);
    true
}

/// Les éléments d'un tableau plat, `N` nombres par élément. Ce qui dépasse le dernier élément
/// complet est laissé : un tableau tronqué ne donne pas un élément à moitié lu.
pub(super) fn elements<const N: usize>(values: &[f64]) -> impl Iterator<Item = [f64; N]> + '_ {
    values.as_chunks::<N>().0.iter().copied()
}
