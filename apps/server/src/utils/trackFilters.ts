/** Shared title-quality checks used anywhere a track title from Deezer needs filtering —
 * song-bank curation, re-verification, and Artist Mode's live discography lookups. */

/** Terms that mark an alternate version wherever they appear in a title — nobody names a real
 *  song "Karaoke" or "Radio Edit". */
const UNWANTED_VERSION_TERMS = [
  'karaoke',
  'tribute',
  'made famous by',
  'originally performed by',
  'cover version',
  'in the style of',
  'remix',
  'instrumental',
  'sped up',
  'slowed',
  'extended mix',
  'radio edit',
  /*
   * Compilations of other songs rather than a song.
   *
   * These are unguessable by design — "Emraan Hashmi Mashup (By DJ Angel)" is a DJ set stitched
   * from a dozen tracks, and it turns up in KK's catalogue only because he is a contributor to
   * one of them. Being asked to name it is not a hard round, it is an unanswerable one.
   */
  'mashup',
  'mash up',
  'medley',
  'megamix',
  'mega mix',
  'jukebox',
  'nonstop',
  'non stop',
  'dj mix',
  'continuous mix',
  'full album',
  // Spoken-word album filler — these are *about* a song rather than a recording of one,
  // so they are never guessable ("Wood (Track by Track)" is Taylor Swift talking, not "Wood").
  'track by track',
  'commentary',
  'interview',
  'voice memo',
  'behind the scenes',
  'skit',
];

/**
 * Terms that only mark an alternate version inside a trailing qualifier — "Yellow (Acoustic)"
 * and "Yellow - Live at Wembley" are alternates, but "Live Your Life" (T.I.), "Live Like You
 * Were Dying" (Tim McGraw) and "Live and Let Die" are ordinary songs whose titles happen to
 * contain the word. Matching these anywhere in the title, even on a word boundary, quietly
 * deleted real songs from both the daily bank and Artist Mode.
 */
const QUALIFIER_ONLY_UNWANTED_TERMS = ['live', 'acoustic', 'demo', 'rehearsal', 'unplugged'];

// Word-boundary matched, so the punctuation/trailing-space variants these used to need
// ('feat.', 'feat ', 'ft.', 'ft ') collapse into one entry each.
const FEATURE_TERMS = ['feat', 'ft', 'featuring'];

/** Content that marks a parenthetical/dash suffix as an alternate *version* of a song
 *  (e.g. "(2x Speed)", "(Album Version)", "- Live at Wembley") rather than part of its
 *  real name. Used to collapse versions down to the main recording. */
const VERSION_MARKER_TERMS = [
  'version',
  'remix',
  'remaster',
  'edit',
  'speed',
  'sped',
  'slowed',
  'reverb',
  'nightcore',
  'acoustic',
  'live',
  'demo',
  'rehearsal',
  'instrumental',
  'karaoke',
  'tribute',
  'cover',
  'session',
  'mix',
  'explicit',
  'clean',
  'dirty',
  'bonus',
  'deluxe',
  'video',
  'lyric',
  'vocals',
  'acapella',
  'official',
];

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Matches `term` against already-normalized text on whole-word boundaries only. Plain
 * substring matching silently ate real songs — "live" matched *A*live*, De*live*ry, O*live*
 * and S*live*r; "demo" matched *Demo*ns — so every term check goes through here. Normalized
 * text contains only `[a-z0-9 ]`, which makes `\b` an exact word-edge test, while multi-word
 * terms ("sped up", "made famous by") still match as a phrase.
 */
const wordMatcherCache = new Map<string, RegExp>();

function matchesTerm(normalizedText: string, term: string): boolean {
  let matcher = wordMatcherCache.get(term);
  if (!matcher) {
    matcher = new RegExp(`\\b${normalizeTitle(term)}\\b`);
    wordMatcherCache.set(term, matcher);
  }
  return matcher.test(normalizedText);
}

/** The trailing parenthetical / bracketed / dash-separated chunks of a title — the places a
 *  label puts version information ("(Acoustic)", "[Deluxe]", "- Live at Wembley"). */
function trailingQualifiers(title: string): string[] {
  const qualifiers: string[] = [];
  let result = title.trim();
  let changed = true;

  while (changed) {
    changed = false;
    const paren = result.match(/\s*\(([^)]*)\)\s*$/);
    if (paren && paren.index != null && paren.index > 0) {
      qualifiers.push(paren[1] ?? '');
      result = result.slice(0, paren.index).trimEnd();
      changed = true;
      continue;
    }
    const bracket = result.match(/\s*\[([^\]]*)\]\s*$/);
    if (bracket && bracket.index != null && bracket.index > 0) {
      qualifiers.push(bracket[1] ?? '');
      result = result.slice(0, bracket.index).trimEnd();
      changed = true;
      continue;
    }
    const dash = result.match(/\s[-–—]\s*(.+)$/);
    if (dash && dash.index != null && dash.index > 0) {
      qualifiers.push(dash[1] ?? '');
      result = result.slice(0, dash.index).trimEnd();
      changed = true;
    }
  }

  return qualifiers;
}

/** True for karaoke/tribute/acoustic/live/remix/etc. versions — never a good pick for a
 * guessing game, which wants the recognizable original recording. */
/** Re-versions that only show in a qualifier or at the end: "Kaanta Laga (Trap Mix)" and "Jab Koi Baat - Recreated", not "Super Bass". */
const REWORK_QUALIFIER =
  /[([-]\s*[^)\]]*\b(lo-?fi|jhankar( beats)?|reverb|8d|reprise|flip( beats)?|cover|trap|synthwave|interlude|hindi|coke studio( season \d+)?|mixed with love|bootleg|remake|recreated|revival|rework|refix|extended|mix|new version|(male|female|happy|sad|duet|arabic|telugu|tamil|kannada|malayalam|marathi)( version)?|2\.0|3\.0)\s*[)\]]?\s*$/i;

export function isUnwantedVersion(title: string): boolean {
  if (REWORK_QUALIFIER.test(title) || /\s\d\.0$/.test(title)) return true;
  const normalized = normalizeTitle(title);
  if (UNWANTED_VERSION_TERMS.some((term) => matchesTerm(normalized, term))) return true;

  return trailingQualifiers(title).some((qualifier) => {
    const normalizedQualifier = normalizeTitle(qualifier);
    return QUALIFIER_ONLY_UNWANTED_TERMS.some((term) => matchesTerm(normalizedQualifier, term));
  });
}

/** True when the title itself credits another artist as a feature/collaboration
 *  (e.g. "Ma Meilleure Ennemie ft. Coldplay") — a signal the searched artist may not be the
 *  track's primary artist. */
export function mentionsFeature(title: string): boolean {
  const normalized = normalizeTitle(title);
  return FEATURE_TERMS.some((term) => matchesTerm(normalized, term));
}

function isVersionMarker(content: string): boolean {
  // Speed variants ("2x", "0.5x") are checked before normalization, which would split "0.5x"
  // into "0 5x" and lose the decimal.
  if (/\d+(?:\.\d+)?x\b/.test(content.toLowerCase())) return true;
  const normalized = normalizeTitle(content);
  return VERSION_MARKER_TERMS.some((term) => matchesTerm(normalized, term));
}

/** Strips alternate-version suffixes from a title, leaving the song's core name —
 *  e.g. "Eyes Closed (2x Speed)" → "Eyes Closed", "Pillowtalk (Living Room Session)" →
 *  "Pillowtalk", "Yellow - Live at Wembley" → "Yellow". Only trailing qualifiers that look
 *  like version markers are removed, so real parenthetical titles ("Single Ladies (Put a
 *  Ring on It)") are left untouched. Used to dedupe a discography down to the main version. */
/**
 * Strips *any* trailing parenthetical or dash qualifier, whether or not it looks like a known
 * version word — "EYES CLOSED (BARE)" → "EYES CLOSED", "Song - Whatever" → "Song".
 *
 * This is deliberately more aggressive than `stripVersionSuffix`, and is only safe because the
 * caller checks the result against titles that actually exist in the same artist's catalog.
 * Labels invent endless variant names (BARE, UNVEILED, 2.0, 0.5, Reimagined…) and no keyword
 * list keeps up; "is there a plain recording of this exact title by this artist?" is a
 * question the data can answer directly.
 */
export function stripAnyTrailingQualifier(title: string): string {
  let result = title.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const paren = result.match(/\s*\(([^)]*)\)\s*$/);
    if (paren && paren.index != null && paren.index > 0) {
      result = result.slice(0, paren.index).trimEnd();
      changed = true;
      continue;
    }
    const bracket = result.match(/\s*\[([^\]]*)\]\s*$/);
    if (bracket && bracket.index != null && bracket.index > 0) {
      result = result.slice(0, bracket.index).trimEnd();
      changed = true;
      continue;
    }
    const dash = result.match(/\s[-–—]\s*(.+)$/);
    if (dash && dash.index != null && dash.index > 0) {
      result = result.slice(0, dash.index).trimEnd();
      changed = true;
    }
  }
  return result.trim();
}

export function stripVersionSuffix(title: string): string {
  let result = title.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const paren = result.match(/\(([^)]*)\)\s*$/);
    if (paren && isVersionMarker(paren[1] ?? '')) {
      result = (result.slice(0, paren.index) ?? result).trimEnd();
      changed = true;
      continue;
    }
    const dash = result.match(/[-–—]\s*(.+)$/);
    if (dash && isVersionMarker(dash[1] ?? '')) {
      result = (result.slice(0, dash.index) ?? result).trimEnd();
      changed = true;
    }
  }
  return result.trim();
}
