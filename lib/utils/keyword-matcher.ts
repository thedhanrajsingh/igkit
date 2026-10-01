// Use Unicode escapes (\p{L}, \p{N}), never ASCII \w or \b: those silently
// deleted all non-Latin comment text, so e.g. Russian keywords never matched.

export interface KeywordMatchResult {
  matched: boolean;
  matchedKeyword: string | null;
}

// Arabic-script variants are one letter typed on different keyboards. Read this
// table by codepoint, not by eye: entries render identically or as nothing.
const ARABIC_SCRIPT_FOLDING: Array<[RegExp, string]> = [
  [/[يىے]/gu, "ی"], // Arabic yeh, alef maksura, barree ye
  [/ك/gu, "ک"], // Arabic kaf -> Persian keheh
  [/ة/gu, "ه"], // teh marbuta -> heh
  [/[آأإٱ]/gu, "ا"], // alef w/ madda or hamza -> alef
  // Optional vocalisation and typographic padding: never semantic in Persian.
  [/[ً-ْٰ]/gu, ""], // harakat, sukun, superscript alef
  [/ـ/gu, ""], // tatweel / kashida stretching
  // ZWNJ (half of Instagram types it) and bidi marks: deleted, not spaced,
  // because the no-separator spelling is what people actually type.
  [/[‌‎‏]/gu, ""],
];

// Persian (U+06F0..) and Arabic-Indic (U+0660..) digit blocks, both ordered 0-9.
const EASTERN_DIGITS = /[۰-۹٠-٩]/gu;

export function normalizeArabicScript(text: string): string {
  let out = text;
  for (const [pattern, replacement] of ARABIC_SCRIPT_FOLDING) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(EASTERN_DIGITS, (digit) => {
    const code = digit.codePointAt(0)!;
    const zero = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - zero);
  });
}

export function stripSpecialCharacters(text: string): string {
  return text
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu,
      ""
    )
    // Keep \p{M} so NFD text ("señor", "किताब") is not split into fragments;
    // foldDiacritics later decides per script which marks to drop.
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Latin-only on purpose: the usual NFD + strip-\p{M} one-liner breaks other
// scripts (Devanagari vowel signs, Cyrillic й, Japanese dakuten).
export function foldDiacritics(text: string): string {
  let out = "";
  let baseIsLatin = false;

  for (const char of text.normalize("NFD")) {
    if (/\p{M}/u.test(char)) {
      // A mark inherits the script of the base character before it.
      if (!baseIsLatin) out += char;
      continue;
    }
    baseIsLatin = /\p{Script=Latin}/u.test(char);
    out += char;
  }

  return out.normalize("NFC");
}

export function matchKeywords(
  commentText: string,
  keywords: string[],
  wholeWordMatch: boolean = true
): KeywordMatchResult {
  if (!commentText || keywords.length === 0) {
    return { matched: false, matchedKeyword: null };
  }

  const cleanedText = foldDiacritics(
    stripSpecialCharacters(normalizeArabicScript(commentText))
  ).toLowerCase();

  if (!cleanedText) {
    return { matched: false, matchedKeyword: null };
  }

  for (const keyword of keywords) {
    const cleanedKeyword = foldDiacritics(
      stripSpecialCharacters(normalizeArabicScript(keyword))
    ).toLowerCase();

    if (!cleanedKeyword) continue;

    // Commenters type "O8" for an "08" keyword; fold O to 0 for numeric-like
    // keywords only, so word keywords are never affected.
    const numericLike = /^[0-9oO]+$/.test(cleanedKeyword);
    const compareText = numericLike ? cleanedText.replace(/o/gi, "0") : cleanedText;
    const compareKeyword = numericLike
      ? cleanedKeyword.replace(/o/gi, "0")
      : cleanedKeyword;

    if (wholeWordMatch) {
      const escapedKeyword = compareKeyword.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      // Lookarounds instead of \b, which never fires between non-Latin chars.
      const regex = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapedKeyword}(?![\\p{L}\\p{N}])`,
        "iu"
      );
      if (regex.test(compareText)) {
        return { matched: true, matchedKeyword: keyword };
      }
    } else {
      if (compareText.includes(compareKeyword)) {
        return { matched: true, matchedKeyword: keyword };
      }
    }
  }

  return { matched: false, matchedKeyword: null };
}
