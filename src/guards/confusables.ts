// Cyrillic and Greek letters that look like Latin ones. NFKC does not fold these, so an attacker can
// write "Ignоre" (Cyrillic о) and a plain text match would not see "Ignore".
//
// A word is only folded when it MIXES Latin letters with Cyrillic/Greek letters. A genuine Russian or
// Greek word contains no Latin letters, so it is left alone. A word made only of look-alikes is not
// touched either (we cannot tell it from real Russian); the LLM classifier is the layer for that case.

const TABLE: Record<string, string> = {
  // Cyrillic, lower case
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", к: "k", м: "m", т: "t", н: "h", в: "b",
  і: "i", ј: "j", ѕ: "s", ԁ: "d", ӏ: "l", ԛ: "q", ԝ: "w",
  // Cyrillic, upper case
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", І: "I", Ј: "J", Ѕ: "S", У: "Y",
  // Greek, upper case
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  // Greek, lower case
  ο: "o", ν: "v", α: "a", ι: "i", κ: "k", ρ: "p", τ: "t", υ: "u", χ: "x",
};

const LATIN = /[\p{Script=Latin}]/u;
const OTHER = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

export function foldMixedScript(text: string): string {
  return text
    .split(/(\s+)/u)
    .map((token) => {
      if (!LATIN.test(token) || !OTHER.test(token)) return token;
      return [...token].map((ch) => TABLE[ch] ?? ch).join("");
    })
    .join("");
}
