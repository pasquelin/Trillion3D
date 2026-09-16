//! Le découpage d'un fichier Maya ASCII en commandes, sans en exécuter aucune.
//!
//! Un `.ma` est un texte de commandes séparées par `;`. Ce module n'en connaît que la forme —
//! commentaires `//` et `/* */`, chaînes entre guillemets avec échappements, mots nus — et rend une
//! suite de jetons par commande. Il ne sait pas ce qu'une commande veut dire et n'évalue rien : ni
//! substitution par accents graves, ni expression, ni script. Une chaîne jamais refermée est un
//! refus nommé, et non une lecture qui avale le reste du fichier comme s'il en faisait partie.
use super::*;

/// Un jeton d'une commande : un mot nu, ou une chaîne littérale déjà déséchappée. La distinction
/// compte : `-n` nu est un drapeau, `"-n"` entre guillemets est une valeur.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Token {
    Word(String),
    Text(String),
}

impl Token {
    /// Le texte du jeton, quelle que soit son écriture.
    pub(super) fn text(&self) -> &str {
        match self {
            Self::Word(word) | Self::Text(word) => word,
        }
    }
    /// Le nom du drapeau que ce jeton porte : un tiret nu suivi d'une lettre. Un nombre négatif
    /// n'en est pas un, et une chaîne littérale non plus.
    pub(super) fn flag(&self) -> Option<&str> {
        let Self::Word(word) = self else {
            return None;
        };
        let name = word.strip_prefix('-')?;
        name.starts_with(|first: char| first.is_ascii_alphabetic())
            .then_some(name)
    }
}

/// Une commande lue : son nom et ses jetons, tels qu'ils sont écrits.
pub(super) struct Statement {
    pub(super) name: String,
    pub(super) tokens: Vec<Token>,
}

/// Les commandes d'un texte, lues à la demande : le document se remplit au fil de la lecture, et
/// rien ne garde en mémoire la totalité des jetons d'un fichier.
pub(super) struct Reader<'a> {
    rest: &'a str,
}

/// Le lecteur de commandes d'un texte Maya ASCII.
pub(super) fn read(text: &str) -> Reader<'_> {
    Reader { rest: text }
}

impl Iterator for Reader<'_> {
    type Item = Result<Statement>;
    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let tokens = match self.tokens() {
                Ok(tokens) if tokens.is_empty() && self.rest.is_empty() => return None,
                Ok(tokens) => tokens,
                Err(error) => {
                    self.rest = "";
                    return Some(Err(error));
                }
            };
            let Some((head, rest)) = tokens.split_first() else {
                continue;
            };
            return Some(Ok(Statement {
                name: head.text().to_string(),
                tokens: rest.to_vec(),
            }));
        }
    }
}

impl Reader<'_> {
    /// Les jetons de la commande suivante, jusqu'au `;` qui la termine ou jusqu'à la fin du texte.
    /// Un fichier dont la dernière commande n'est pas terminée rend quand même ses jetons : c'est
    /// une écriture incomplète, pas une raison d'oublier ce qui précède.
    fn tokens(&mut self) -> Result<Vec<Token>> {
        let mut out = Vec::new();
        loop {
            self.skip();
            let Some(head) = self.rest.chars().next() else {
                return Ok(out);
            };
            if head == ';' {
                self.rest = &self.rest[1..];
                return Ok(out);
            }
            out.push(match head {
                '"' => Token::Text(self.string()?),
                _ => Token::Word(self.word()),
            });
        }
    }

    /// Les blancs et les commentaires : `//` jusqu'à la fin de la ligne, `/* */` jusqu'à sa clôture.
    fn skip(&mut self) {
        loop {
            self.rest = self.rest.trim_start();
            if let Some(rest) = self.rest.strip_prefix("//") {
                self.rest = rest.split_once('\n').map_or("", |(_, after)| after);
                continue;
            }
            if let Some(rest) = self.rest.strip_prefix("/*") {
                self.rest = rest.split_once("*/").map_or("", |(_, after)| after);
                continue;
            }
            return;
        }
    }

    /// Une chaîne littérale, déséchappée.
    fn string(&mut self) -> Result<String> {
        let mut out = String::new();
        let mut escaped = false;
        for (at, letter) in self.rest.char_indices().skip(1) {
            if escaped {
                out.push(match letter {
                    'n' => '\n',
                    't' => '\t',
                    other => other,
                });
                escaped = false;
                continue;
            }
            match letter {
                '\\' => escaped = true,
                '"' => {
                    self.rest = &self.rest[at + 1..];
                    return Ok(out);
                }
                other => out.push(other),
            }
        }
        self.rest = "";
        Err(CompilerError::new(
            FILE_INVALID,
            "ma: a quoted string is never closed; the file stops inside a name",
        ))
    }

    /// Un mot nu : tout ce qui n'est ni blanc, ni `;`, ni guillemet.
    fn word(&mut self) -> String {
        let end = self
            .rest
            .find(|letter: char| letter.is_whitespace() || letter == ';' || letter == '"')
            .unwrap_or(self.rest.len());
        let (word, rest) = self.rest.split_at(end);
        self.rest = rest;
        word.to_string()
    }
}
