import { stripVersionSuffix } from './trackFilters';

/** Lowercase, accents gone, punctuation gone: what people actually type. */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hindi and Punjabi have no one Latin spelling: "Dil Se", "Dill Se", "Kabhi" and "Kabhie" are all right. */
const TRANSLITERATIONS: [RegExp, string][] = [
  [/ee/g, 'i'],
  [/oo/g, 'u'],
  [/aa/g, 'a'],
  [/w/g, 'v'],
  [/ph/g, 'f'],
  [/(.)\1/g, '$1'],
  [/ie\b/g, 'i'],
  [/\b(hai|hain)\b/g, 'he'],
  [/\bmein\b/g, 'mai'],
];

const TRANSLITERATED_LANGUAGES = new Set(['hi', 'pa', 'ta']);

/** Alternative spellings a search should also match. Never includes the folded title's duplicates. */
export function buildAliases(title: string, language: string): string[] {
  const base = foldForSearch(title);
  const aliases = new Set<string>([
    foldForSearch(stripVersionSuffix(title)),
    foldForSearch(title.replace(/\s*[([].*?[)\]]\s*/g, ' ')),
    base.replace(/^the /, ''),
  ]);
  if (TRANSLITERATED_LANGUAGES.has(language)) {
    for (const [pattern, replacement] of TRANSLITERATIONS) {
      aliases.add(base.replace(pattern, replacement));
    }
    aliases.add(TRANSLITERATIONS.reduce((s, [p, r]) => s.replace(p, r), base));
  }
  aliases.delete(base);
  aliases.delete('');
  return [base, ...aliases];
}
