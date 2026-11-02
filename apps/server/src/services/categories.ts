/**
 * The playable categories, backed by Deezer editorial playlists.
 *
 * Every entry is a hand-checked playlist id rather than a runtime search: searching Deezer for
 * "Top 2024" returns mostly user-made lists with the wrong year, the wrong region, or ten
 * tracks, so the category list would be different (and often junk) on every deploy.
 *
 * Two editorial accounts supply everything here — "Deezer Best Of" (4036701362) for the year
 * and genre retrospectives, and "Deezer Charts" (637006841) for the live worldwide chart.
 *
 * Region matters: Deezer's `/chart/{genre}` endpoints follow the *server's* IP, which would
 * make every "top now" list German for this deployment. The playlists below are the worldwide
 * editions, verified to return international tracks (Top Hits 2000 is Destiny's Child and
 * Britney; 2024 Pop is Espresso and Texas Hold 'Em).
 */
import { SOUNDTRACK_COLLECTIONS, type SoundtrackTitle, type SoundtrackKind } from './soundtracks';

export type CategoryGroup = 'now' | 'year' | 'genre' | 'bollywood' | 'world' | 'soundtrack';

export interface Category {
  /** Stable slug used in URLs and as the catalog cache key. */
  id: string;
  label: string;
  group: CategoryGroup;
  /** Deezer playlists backing the category. Tracks from all are merged and deduped.
   *  Empty for movie collections, which are built from albums instead. */
  playlistIds: string[];
  /** Shown under the label on the picker. */
  blurb: string;
  /**
   * Set only on Guess the Movie collections. Their pool is built from curated soundtrack albums
   * and the answer is the *film*, not the song — see movieCatalogService for why that changes
   * how options are rendered.
   */
  titles?: SoundtrackTitle[];
  /** Set alongside `movies`: decides how hard the track filter is. See SoundtrackKind. */
  soundtrackKind?: SoundtrackKind;
}

/** Deezer Charts' live worldwide top 100 plus its 2025 retrospective. */
const NOW: Category[] = [
  {
    id: 'now-worldwide',
    label: 'Top Worldwide Now',
    group: 'now',
    // The live worldwide chart is 100 songs by definition; the big markets' own charts take it past
    // the 250 a category needs while still being what people are streaming now.
    playlistIds: [
      '3155776842',
      '1313621735',
      '1111142221',
      '1652248171',
      '1313616925',
      '1111141961',
      '1111142361',
      '1111143121',
      '1109890291',
    ],
    blurb: 'What the whole world is streaming right now',
  },
  {
    id: 'year-2025',
    label: 'Top Worldwide 2025',
    group: 'now',
    playlistIds: [
      '14575176963',
      '14729118301',
      '15262279543',
      '14165758161',
      '14590090081',
      '14591586961',
      '14591664001',
      '14591996881',
      '14596738141',
    ],
    blurb: 'The biggest tracks of 2025',
  },
];

/** Decade-level mega pools (200–700+ tracks each) so replays are always fresh. */
const DECADES: Category[] = [
  {
    id: 'decade-2010s',
    label: '2010s Hits',
    group: 'year',
    playlistIds: ['13382725943', '8033720842'],
    blurb: '200+ songs from the 2010s decade',
  },
  {
    id: 'decade-2000s',
    label: '2000s Hits',
    group: 'year',
    playlistIds: ['15453873941', '10307642122'],
    blurb: '200+ throwback hits from the 2000s',
  },
  {
    id: 'decade-90s',
    label: '90s Hits',
    group: 'year',
    playlistIds: ['2924710862', '5961030064'],
    blurb: '270+ pop hits from the 1990s',
  },
  {
    id: 'decade-80s',
    label: '80s Hits',
    group: 'year',
    playlistIds: ['3403326002', '14732615881'],
    blurb: '200+ classics from the 1980s',
  },
  {
    id: 'greatest-hits',
    label: 'Greatest Hits Radio 500',
    group: 'year',
    playlistIds: ['14500567763'],
    blurb: '500 of the greatest songs ever',
  },
];

/** "Top Hits <year>" retrospectives, newest first, widened with that year's Billboard and UK chart
 *  lists because one retrospective is only 40 to 80 songs. Deezer publishes these back to 1976; the
 *  list starts at 2000 so every category is something most players could plausibly name. Candidates
 *  named one year only, with most of a sample released then or the year before (2010 on: older
 *  Deezer dates are often reissues). Era mode answers from these, so keep that bar. */
const YEAR_PLAYLISTS: [year: number, playlistIds: string[]][] = [
  [2024, ['13154877883', '13111294463', '13005278443', '13235297463', '12588393963']],
  [2023, ['12345467671', '11783778121']],
  [
    2022,
    [
      '12345460211',
      '9919255162',
      '10349158282',
      '10446615642',
      '10671518942',
      '10712333862',
      '10503913542',
      '10521632062',
      '10563103062',
      '10877290122',
    ],
  ],
  [2021, ['12345421311', '8980116862', '9725256602']],
  [
    2020,
    [
      '3185085222',
      '7790730602',
      '9405677142',
      '15762280621',
      '7620807442',
      '15784640061',
      '7918915762',
      '7602033602',
      '7663393362',
      '8535026462',
      '7060865524',
    ],
  ],
  [2019, ['1283499335', '6206933484', '920047905', '7138465884']],
  [2018, ['5132762464', '12468732663', '10996128102', '15784648641', '5229773802']],
  [2017, ['3453772742', '2970493286', '1488687901', '9516011422', '3089696646', '15262280123']],
  [
    2016,
    [
      '5310088722',
      '1376135575',
      '14721841401',
      '5674930362',
      '14850795683',
      '9516010642',
      '1645765823',
      '13769629281',
      '1824081862',
      '11435358604',
      '3977967646',
      '1570710303',
      '2447539046',
      '2538016328',
      '15880191141',
      '14848645143',
      '15432479181',
    ],
  ],
  [
    2015,
    [
      '5310238702',
      '1385182427',
      '1115751971',
      '13545177063',
      '15191981883',
      '1103656501',
      '10861846002',
      '2581107764',
      '15664447403',
      '5674978782',
      '1110586277',
      '1205179163',
    ],
  ],
  [
    2014,
    [
      '5310662982',
      '5674910982',
      '10856343302',
      '14157798361',
      '814639331',
      '14843976183',
      '1106252551',
      '3427858902',
      '12910142123',
      '784469051',
      '2425909026',
      '14369428521',
      '5155613404',
      '5155613444',
      '5155613644',
      '9254833082',
    ],
  ],
  [
    2013,
    [
      '5310925582',
      '15822368501',
      '701437535',
      '5674906322',
      '10828487882',
      '6616625184',
      '15804342661',
      '15804343701',
      '15804356701',
      '15779022261',
      '3427859102',
      '11435358744',
      '810819693',
      '14517044303',
      '379106965',
      '5155613544',
      '12351868403',
    ],
  ],
  [
    2012,
    [
      '5311155022',
      '1042442281',
      '5674878062',
      '15633973603',
      '15631661483',
      '1571721231',
      '3498854802',
      '3427858962',
      '3626134446',
      '2802230264',
      '5155612944',
      '5155612984',
      '14691937801',
      '5155613564',
    ],
  ],
  [
    2011,
    [
      '5313710582',
      '4673115408',
      '15712573081',
      '2634544568',
      '3297201942',
      '2347272942',
      '4488718684',
      '5057678128',
      '2505010188',
      '11030051902',
      '5155612864',
      '5155612904',
      '5155613744',
      '1196106242',
    ],
  ],
  [
    2010,
    [
      '5339620562',
      '14696971881',
      '9516006322',
      '4857490728',
      '5057806724',
      '3427859162',
      '5155612824',
      '5155613024',
      '5155612664',
      '10224487882',
    ],
  ],
  [
    2009,
    [
      '5361722742',
      '13724546801',
      '5674821502',
      '1753487122',
      '14811903263',
      '4098349602',
      '5793342302',
      '7609143062',
      '2347290802',
      '2347293502',
      '2802276724',
      '5155612604',
      '5155612744',
      '5155612804',
      '9077245122',
      '9091797582',
      '1377772265',
    ],
  ],
  [
    2008,
    [
      '4091244662',
      '1147470591',
      '5674816102',
      '3043779882',
      '7609154542',
      '10518702342',
      '4332838406',
      '14809392183',
      '2802272124',
      '5155612524',
      '5155612584',
      '9075818082',
    ],
  ],
  [
    2007,
    [
      '11837077721',
      '14575448503',
      '662795615',
      '10048793222',
      '5674802322',
      '11110081924',
      '7609187022',
      '10518672822',
      '4327897086',
      '5057665828',
      '2802212484',
      '13969063041',
      '5155612024',
      '10018145122',
      '5155612084',
    ],
  ],
  [
    2006,
    [
      '11837078821',
      '662795705',
      '5674772902',
      '1416434165',
      '15821769861',
      '5097452984',
      '7609188522',
      '10518645902',
      '15774872281',
      '15821769841',
      '5155612204',
      '5155612164',
    ],
  ],
  [
    2005,
    [
      '11837082861',
      '5674700782',
      '12062677371',
      '662794525',
      '2802238904',
      '11153028284',
      '1013114441',
      '11667706924',
      '13175390883',
      '10518412642',
      '5057589428',
      '11781997841',
      '5155611884',
      '10018145042',
    ],
  ],
  [
    2004,
    [
      '11837085661',
      '13974714001',
      '10365862982',
      '5684860062',
      '1267681711',
      '13175393783',
      '10518367442',
      '5097453964',
      '4702206544',
      '5057824104',
      '5057565708',
      '2802281804',
      '5155611264',
      '5155611364',
      '10224490262',
      '9035226882',
    ],
  ],
  [
    2003,
    [
      '11837087601',
      '15322368263',
      '5684845502',
      '13175394883',
      '4889722684',
      '11222059244',
      '12664495383',
      '10224469242',
    ],
  ],
  [
    2002,
    [
      '11837088801',
      '2347290922',
      '5684784162',
      '10224469962',
      '15258841783',
      '12286055671',
      '10980634502',
      '5097454444',
      '10971463162',
      '2775467468',
      '2802219044',
    ],
  ],
  [
    2001,
    [
      '11837090081',
      '15212086223',
      '5684754442',
      '10898817284',
      '15725498161',
      '15507916541',
      '10224470382',
    ],
  ],
  [2000, ['11837091441', '9758686742', '15615872483', '10908047022', '14277300761', '9954202142']],
];

const YEARS: Category[] = YEAR_PLAYLISTS.map(([year, playlistIds]) => ({
  id: `year-${year}`,
  label: `Top Hits ${year}`,
  group: 'year' as const,
  playlistIds,
  blurb: `The songs that defined ${year}`,
}));

/**
 * Genre retrospectives. Deliberately the mainstream genres only — Deezer also publishes
 * Melodic Techno, Tech House, Trance, Calm Piano and Zouk lists, but a category nobody can
 * name ten songs from is a bad round, not a hard one.
 */
const GENRE_DEFS: [label: string, playlistIds: string[]][] = [
  // Shares Deezer's "Top Hits 2024" list with the year-2024 category, which on its own made
  // the two categories the same 40 songs. The extra lists are what make it Pop rather than a
  // duplicate.
  ['Pop 2024', ['13154877883', '7273887124', '2251932286', '8282573142']],
  ['Rock 2024', ['13238299403', '14933629843']],
  ['Rap 2024', ['13241781803', '2103808464', '8511713862']],
  ['R&B 2024', ['13241765403', '15432576981']],
  ['Dance 2024', ['13210162323', '10241818022']],
  ['Metal 2024', ['13238303063', '13854587941', '14116603101']],
  [
    'K-Pop 2024',
    ['13238288623', '11681151004', '8237699362', '10173914222', '14826293843', '12291395211'],
  ],
  ['Alternative 2024', ['13200273483', '8461046582']],
  ['Afro 2024', ['13241778203', '15264620623', '14182955041', '13422270643', '14546513483']],
  ['Soul 2024', ['13239089503', '10229366182']],
  ['Rock 2023', ['11906567121', '14933629843']],
  ['Latin 2023', ['11924528781', '15271310803', '14982249003']],
  ['Reggaeton 2023', ['11924529441', '7242599524', '15257753723']],
  [
    'K-Pop 2023',
    ['11924856141', '11681151004', '8237699362', '10173914222', '14826293843', '15158031723'],
  ],
  ['Electronic 2023', ['11903241081', '15511864001', '9538773802']],
  ['Metal 2023', ['11906567941', '13854587941', '14116603101']],
];

/**
 * All-time genre pools, as opposed to the year-pinned lists above.
 *
 * The existing genre entries are snapshots of one year, which is a different thing to ask of a
 * player: "Top Rock 2024" rewards knowing what came out recently, while "Rock Essentials" is a
 * canon most people can take a swing at. Both are worth having.
 *
 * Every id was checked live for size and, more importantly, preview coverage — a playlist whose
 * tracks have no 30-second previews is unplayable here and looks exactly like a broken game.
 * Several plausible candidates were rejected on that basis alone (one "R&B Classics" list had
 * previews on 3 of its first 14 tracks).
 */
const TIMELESS_GENRE_DEFS: [label: string, playlistIds: string[], blurb: string][] = [
  [
    'Rock Essentials',
    ['1306931615', '15212937403', '15320348603', '8346956262'],
    'AC/DC, Bowie, Pink Floyd and the rest of the canon',
  ],
  ['New Rock', ['1306978785', '9803599062'], 'What rock sounds like now'],
  ['Metal Essentials', ['2655390504', '15590986363'], 'Pantera, Megadeth and the heavy end'],
  ['Electronic Hits', ['1902101402', '11559738304'], 'Dance floor staples old and new'],
  [
    'Country Essentials',
    ['1294431447', '10069289022', '13026281763', '12985657383', '13563910661'],
    'Johnny Cash, Patsy Cline and the classics',
  ],
  [
    'Reggae Essentials',
    ['2448918882', '8312385342', '8274765682'],
    'Bob Marley and the roots of the sound',
  ],
  ['Jazz Essentials', ['1615514485', '1489852091'], 'Armstrong, Brubeck, Nina Simone'],
  [
    '2000s Hip-Hop & R&B',
    ['5243303306', '10425788722'],
    'Kanye, Nelly, Amerie - the 00s radio years',
  ],
];

const TIMELESS_GENRES: Category[] = TIMELESS_GENRE_DEFS.map(([label, playlistIds, blurb]) => ({
  id: `genre-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  label,
  group: 'genre' as const,
  playlistIds,
  blurb,
}));

/**
 * Music from outside the anglophone charts, which the rest of the catalog is heavily weighted
 * towards. Bollywood already has its own group; this is everywhere else.
 */
const WORLD_DEFS: [label: string, playlistIds: string[], blurb: string][] = [
  ['K-Pop', ['4096400722', '13575508741'], 'BTS, JENNIE and the current top of K-pop'],
  ['Latin Fuego', ['178699142', '6708087824'], 'Shakira, Quevedo and Latin pop heat'],
  ['Reggaeton', ['1273315391', '1449951107'], 'Bad Bunny, KAROL G, J Balvin'],
  ['Afrobeats', ['12325616651', '3536404662'], 'Tyla, Ayra Starr and the Afrobeats wave'],
  ['Tamil Hits', ['13523718423', '6920369284'], 'Anirudh and the newest Tamil chart'],
  ['Punjabi', ['4815158244'], '900+ Punjabi tracks, old school to now'],
  /*
   * Indian independent music — deliberately *not* filed under Bollywood, which is the point of
   * the scene. Every other Indian category here is film music or film-adjacent.
   *
   * Preview coverage decided this list more than taste did. The obvious searches return the
   * wrong thing entirely (Deezer's "Indian indie" results are mostly yoga and mantra records,
   * and "Indien" is French for Indian, so half the hits are British indie rock), and the
   * playlists that *are* right are often unplayable: a well-known Local Train list had previews
   * on 8 of 40 tracks, and "Indian rock bands" yielded only 21 playable tracks — above the
   * minimum, but thin enough that a ten-round game would repeat itself.
   *
   * Counted in absolute playable tracks rather than percentage, since previewless tracks are
   * dropped at fetch time: a big playlist with mediocre coverage beats a small clean one.
   */
  /*
   * One merged pool rather than several small ones, to clear the 200-track floor a category
   * needs before it stops repeating itself over a ten-round game. Individually these are 234,
   * 124, 52, 49 and 34 playable tracks; together they dedupe to a single catalogue several
   * times the size of any of them, and the overlap is the point — an artist on three of the
   * five lists is a load-bearing part of the scene, not a duplicate to be worried about.
   *
   * The last two are what put Lifafa, Parekh & Singh, The F16s and Tajdar Junaid in. Neither
   * would survive as its own category — "new shit" is 52 tracks across four artists — but
   * folded into a pool this size they add exactly the names the bigger lists miss.
   */
  [
    'Indian Indie',
    ['15368219983', '14238068701', '15445577861', '14468097423', '15343188863'],
    'Prateek Kuhad, The Local Train, Lifafa, Parekh & Singh',
  ],
];

const WORLD: Category[] = WORLD_DEFS.map(([label, playlistIds, blurb]) => ({
  id: `world-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  label,
  group: 'world' as const,
  playlistIds,
  blurb,
}));

const GENRES: Category[] = GENRE_DEFS.map(([label, playlistIds]) => ({
  id: `genre-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  label: `Top ${label}`,
  group: 'genre' as const,
  playlistIds,
  blurb: `The best of ${label}`,
}));

/**
 * Bollywood / Indian music. Deezer's editorial playlists cover this well — "Best Of Bollywood"
 * and year-specific compilations exist and are maintained. Playlist ids verified to contain
 * Hindi-language tracks with working previews.
 */
const BOLLYWOOD_DEFS: [label: string, playlistIds: string[], blurb: string][] = [
  ['Bollywood All Time', ['15397365263'], '300+ of the best Bollywood songs ever'],
  ['Bollywood 2010–2024', ['15608630823'], '700+ hits from the last fifteen years'],
  ['Bollywood 2020s', ['15558969283'], '350+ songs from this decade'],
  ['Bollywood Top 500', ['5510742242', '7531449362', '14253993041'], 'Hindi all-time top 500'],
  [
    'Bollywood Romance',
    ['10421653842', '15363083683', '15634914863', '15671516683', '15725383081', '7037328364'],
    'Love songs from the silver screen',
  ],
  [
    'Bollywood Party',
    ['9660774522', '15571622683', '15307343363'],
    'Dance floor anthems from Hindi films',
  ],
  ['Bollywood 2026', ['14922241343', '14844309343'], 'The latest Bollywood hits'],
  // Repointed after the originals stopped resolving on Deezer: 5855498562 had shrunk to two
  // tracks (under MIN_CATEGORY_TRACKS) and 4803995402 / 3060498806 both answer with
  // {"error":"no data"}. Worth knowing the failure mode — a dead playlist id surfaces only when
  // someone tries to start a game, as "not enough playable tracks", which reads like a bug in
  // the game rather than a playlist that no longer exists. If a category refuses to start, check
  // its id against https://api.deezer.com/playlist/<id> before looking anywhere else.
  [
    'Bollywood Sad Songs',
    [
      '11485931584',
      '11730866924',
      '10941813662',
      '6388026924',
      '6388020104',
      '15739463301',
      '8322693942',
      '11815583581',
      '11730865864',
      '12368415883',
    ],
    'Heartbreak anthems from Hindi cinema',
  ],
  [
    'Bollywood Retro',
    ['11193162724', '14334082281', '15472133841', '14950137583'],
    'Timeless old-school Bollywood',
  ],
  [
    'Arijit Singh Hits',
    ['14001087101', '14857581243', '12086665171'],
    'Best of the modern Bollywood voice',
  ],
];

const BOLLYWOOD: Category[] = BOLLYWOOD_DEFS.map(([label, playlistIds, blurb]) => ({
  id: `bollywood-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  label,
  group: 'bollywood' as CategoryGroup,
  playlistIds,
  blurb,
}));

/**
 * Guess the Movie collections. They ride the category system rather than being a mode of their
 * own: a category is already "an id, a label, and a way to load a track pool", which is exactly
 * what these are, so the picker, multiplayer rooms, duel matchmaking, live player counts and
 * leaderboards all work with no changes. Only the pool builder and the option rendering differ.
 */
const MOVIES: Category[] = SOUNDTRACK_COLLECTIONS.map((collection) => ({
  id: collection.id,
  label: collection.label,
  group: 'soundtrack' as const,
  playlistIds: [],
  blurb: collection.blurb,
  titles: collection.titles,
  soundtrackKind: collection.kind,
}));

export const CATEGORIES: Category[] = [
  ...NOW,
  ...DECADES,
  ...YEARS,
  ...GENRES,
  ...TIMELESS_GENRES,
  ...WORLD,
  ...BOLLYWOOD,
  ...MOVIES,
];

/** True when the category's rounds ask for a film rather than a song. */
export function isSoundtrackCategory(category: Category): boolean {
  return !!category.titles && category.titles.length > 0;
}

/*
 * Slugs are derived from labels, so a new entry can silently collide with an existing one and
 * shadow it in the id map. Cheap to check at import, and the alternative is a category that
 * quietly plays the wrong songs.
 */
const duplicateIds = CATEGORIES.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i);
if (duplicateIds.length > 0) {
  throw new Error(`Duplicate category ids: ${[...new Set(duplicateIds)].join(', ')}`);
}

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function findCategory(id: string): Category | null {
  return BY_ID.get(id) ?? null;
}
