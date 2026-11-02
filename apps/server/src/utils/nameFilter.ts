/**
 * Decides whether a display name is acceptable.
 *
 * shortcut: a word list, not moderation. naughty-words covers about 27 languages, and EXTRA adds
 * romanised South Asian terms it lacks. No list covers every language or spots a slur coined
 * tomorrow, which is why an event host can still remove a player. Add to EXTRA as cases appear.
 */
import naughtyWords from 'naughty-words';

/** Romanised Hindi, Urdu, Punjabi and Gujarati abuse, plus slur spellings the list misses. */
const EXTRA = [
  'bhenchod',
  'behenchod',
  'benchod',
  'bhenchodd',
  'bhosdike',
  'bhosadike',
  'bhosda',
  'bhosdi',
  'madarchod',
  'maderchod',
  'madarjaat',
  'chutiya',
  'chutia',
  'chootiya',
  'choot',
  'gaandu',
  'gandu',
  'randi',
  'harami',
  'haramkhor',
  'haramzada',
  'haramzadi',
  'kutta',
  'kutti',
  'kamina',
  'lavda',
  'lauda',
  'loda',
  'lodu',
  'lawda',
  'tatti',
  'chakka',
  'hijra',
  'bhangi',
  'chamar',
  'katua',
  'mulla',
  'nigga',
  'niggah',
  'negro',
  'coon',
  'paki',
  'chink',
  'gook',
  'spic',
  'wetback',
  'пидор',
  'пидар',
  'хуй',
  'сука',
  'блядь',
  'kike',
  'raghead',
  'towelhead',
  'tranny',
  'dyke',
  'retard',
  'hitler',
  'nazi',
  'isis',
  'kkk',
];

/**
 * Names that are fine word by word and offensive together, matched with spaces and punctuation gone.
 * Each is a person or phrase, so the parts stay usable: Mia and Johnny are ordinary names.
 */
const PHRASES = [
  // Adult performers and sites. People pick these to get a laugh out of a projected leaderboard.
  'johnny sins',
  'johny sins',
  'mia khalifa',
  'mia kalifa',
  'sunny leone',
  'sunny leon',
  'dani daniels',
  'lana rhoades',
  'riley reid',
  'abella danger',
  'angela white',
  'brandi love',
  'lisa ann',
  'asa akira',
  'eva elfie',
  'nicole aniston',
  'alexis texas',
  'jordi el nino',
  'keanu sins',
  'tori black',
  'pornhub',
  'xvideos',
  'xhamster',
  'xnxx',
  'onlyfans',
  'brazzers',
  'youporn',
  'redtube',
  // Terror and hate, whatever name is put in front of them.
  'bin laden',
  'osama bin',
  'al qaeda',
  'alqaida',
  'ajmal kasab',
  'dawood ibrahim',
  'white power',
  'heil hitler',
  'gas the',
  'kill all',
];
/** Short enough to be inside ordinary names, so these only match as a whole word... */
const NOT_INSIDE_WORDS_BELOW = 5;
/** ...except these, which nothing innocent contains and which people run into other words. */
const ALWAYS_INSIDE = [
  'fuck',
  'bhench',
  'madarch',
  'chutiy',
  'bhosd',
  'bomb',
  'terrorist',
  'jihad',
  'taliban',
  'lashkar',
  'suicide',
];
/** Innocent text a long blocked word sits inside ("the-rapist"). Cut out before matching. */
const SAFE_PARTS = /therapist|nigeri|nigel|nigam|bombay|bombshel/g;

const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  // Cyrillic and Greek letters that pass for Latin ones.
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  х: 'x',
  у: 'y',
  і: 'i',
  ο: 'o',
  α: 'a',
};

function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      // A number after a word is a number (Player15, Ben10), not a letter in disguise.
      .replace(/(?<=\p{L})\d+(?!\p{L})/gu, '')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[0134578@$!аеорсхуіοα]/g, (c) => LOOKALIKES[c] ?? c)
      .replace(/(\p{L})\1+/gu, '$1')
  );
}

const isLatin = (word: string) => /^[a-z ]+$/.test(word);

const wholeWords = new Set<string>();
const insideWords: string[] = [];
for (const list of [...Object.values(naughtyWords as unknown as Record<string, string[]>), EXTRA]) {
  for (const raw of list) {
    const word = normalize(raw).trim();
    if (!word) continue;
    // Scripts written without spaces (Chinese, Japanese, Thai) have no word edge to look for, but
    // a single character there is often part of an ordinary name, so that must stand alone.
    if (isLatin(word) ? word.length >= NOT_INSIDE_WORDS_BELOW : [...word].length > 1)
      insideWords.push(word.replace(/ /g, ''));
    else wholeWords.add(word);
  }
}
insideWords.push(...ALWAYS_INSIDE.map(normalize));
const phrases = PHRASES.map((p) => normalize(p).replace(/ /g, ''));

/** True when the name contains a blocked word, including spaced ("f u c k") or disguised forms. */
export function isOffensiveName(name: string): boolean {
  const text = normalize(name);
  const tokens = text.split(/[^\p{L}]+/u).filter(Boolean);
  // Runs of single letters are one word somebody spaced out.
  const joined = text.replace(/(?<![\p{L}])(\p{L})[^\p{L}]+(?=\p{L}(?:[^\p{L}]|$))/gu, '$1');
  const candidates = [...tokens, ...joined.split(/[^\p{L}]+/u).filter(Boolean)];
  const compact = text.replace(/[^\p{L}]+/gu, '');
  if (phrases.some((phrase) => compact.includes(phrase))) return true;
  for (const candidate of candidates) {
    const token = candidate.replace(SAFE_PARTS, ' ');
    if (wholeWords.has(token)) return true;
    if (insideWords.some((word) => token.includes(word))) return true;
  }
  return false;
}
