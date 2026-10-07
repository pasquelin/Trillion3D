//! Rust source read as code: its comments and the inside of its literals blanked.

/// Whether `c` belongs to an identifier.
pub fn word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `text` with its comments, nested ones too, and the inside of its string and character literals
/// blanked, line breaks kept; and the strings, by the position of their opening quote.
pub fn blanked(text: &str) -> (Vec<char>, Vec<(usize, String)>) {
    let mut code: Vec<char> = text.chars().collect();
    let mut strings = Vec::new();
    let blank = |code: &mut Vec<char>, from: usize, to: usize| {
        let to = to.min(code.len());
        code[from..to].iter_mut().for_each(|c| {
            if *c != '\n' {
                *c = ' ';
            }
        });
    };
    let mut at = 0;
    while at < code.len() {
        let next = code.get(at + 1).copied();
        let after_word = at > 0 && word(code[at - 1]);
        match code[at] {
            '/' if next == Some('/') => {
                let end = (at..code.len()).find(|&i| code[i] == '\n');
                let end = end.unwrap_or(code.len());
                blank(&mut code, at, end);
                at = end;
            }
            '/' if next == Some('*') => {
                let (mut depth, mut end) = (0, at);
                while end < code.len() {
                    let pair = (code[end], code.get(end + 1).copied());
                    match pair {
                        ('/', Some('*')) => (depth, end) = (depth + 1, end + 2),
                        ('*', Some('/')) => (depth, end) = (depth - 1, end + 2),
                        _ => end += 1,
                    }
                    if depth == 0 {
                        break;
                    }
                }
                blank(&mut code, at, end);
                at = end;
            }
            'r' if !after_word || (at > 1 && code[at - 1] == 'b' && !word(code[at - 2])) => {
                let hashes = code[at + 1..].iter().take_while(|&&c| c == '#').count();
                if code.get(at + 1 + hashes) != Some(&'"') {
                    at += 1;
                    continue;
                }
                let open = at + 1 + hashes;
                let fence: Vec<char> = std::iter::once('"').chain(vec!['#'; hashes]).collect();
                let close = (open + 1..code.len())
                    .find(|&i| code[i..].starts_with(&fence))
                    .unwrap_or(code.len());
                strings.push((open, code[open + 1..close].iter().collect()));
                blank(&mut code, open + 1, close);
                at = close + fence.len();
            }
            '"' => {
                let mut end = at + 1;
                let mut value = String::new();
                while end < code.len() && code[end] != '"' {
                    if code[end] == '\\' {
                        end += 1;
                    }
                    if let Some(&c) = code.get(end) {
                        value.push(c);
                    }
                    end += 1;
                }
                strings.push((at, value));
                blank(&mut code, at + 1, end);
                at = end + 1;
            }
            '\'' if next == Some('\\') || code.get(at + 2) == Some(&'\'') => {
                // `'\''` and `'\\'` close past their escape: the quote is looked for after it.
                let from = at + if next == Some('\\') { 3 } else { 2 };
                let end = (from..code.len()).find(|&i| code[i] == '\'');
                let end = end.unwrap_or(code.len());
                blank(&mut code, at + 1, end);
                at = end + 1;
            }
            _ => at += 1,
        }
    }
    (code, strings)
}
