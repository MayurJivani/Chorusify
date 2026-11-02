import { describe, it, expect } from 'vitest';
import {
  isUnwantedVersion,
  mentionsFeature,
  normalizeTitle,
  stripAnyTrailingQualifier,
  stripVersionSuffix,
} from '../../src/utils/trackFilters';

describe('isUnwantedVersion', () => {
  /*
   * A mashup is a DJ set stitched from other songs, not a song — unanswerable rather than hard.
   * These show up in an artist's catalogue when they are merely a contributor to one of the
   * tracks inside, which is how "Emraan Hashmi Mashup" ended up in KK's rounds.
   */
  it('drops mashups, medleys and other compilations', () => {
    for (const title of [
      'Emraan Hashmi Mashup (By DJ Angel)',
      'Bollywood Mash Up',
      'Christmas Medley',
      '90s Megamix',
      'Party Jukebox',
      'Nonstop Bhangra',
      'Summer DJ Mix',
    ]) {
      expect(isUnwantedVersion(title)).toBe(true);
    }
  });

  it('leaves ordinary titles that merely look similar alone', () => {
    /*
     * Word-boundary matching, so a substring is not enough — "Mixed" is not "mix", "Nonsense"
     * is not "nonstop". A title containing the standalone word "medley" *is* filtered, which is
     * the intended trade: no real song is called that, and a compilation slipping through is
     * an unanswerable round.
     */
    for (const title of ['Mixed Emotions', 'Nonsense', 'Mixtape Dreams', 'Stop']) {
      expect(isUnwantedVersion(title)).toBe(false);
    }
  });

  it.each([
    'Yellow (Acoustic)',
    'Yellow - Live at Wembley',
    'Yellow (Remix)',
    'Yellow (Instrumental)',
    'Yellow - Karaoke Version',
    'Tribute to Coldplay',
    'Made Famous By Coldplay',
    'Yellow (Sped Up)',
    'Yellow (Slowed + Reverb)',
    'Yellow - Radio Edit',
  ])('flags %s as an unwanted version', (title) => {
    expect(isUnwantedVersion(title)).toBe(true);
  });

  it.each(['Yellow', 'Bohemian Rhapsody', 'Livin’ on a Prayer', "Don't Stop Me Now"])(
    'does not flag a normal title like %s',
    (title) => {
      expect(isUnwantedVersion(title)).toBe(false);
    },
  );

  // Regression: these were all excluded by substring matching — "live" inside Alive/Delivery/
  // Olive/Sliver, "demo" inside Demons, "mix" inside Mixtape — silently shrinking the pool.
  it.each([
    'Alive',
    'Delivery',
    'Demons',
    'Olive',
    'Sliver',
    'Mixtape',
    'Believer',
    'Cover Girl',
    'Forever Young',
  ])('keeps %s, which only contains a filter term as a substring', (title) => {
    expect(isUnwantedVersion(title)).toBe(false);
  });

  it.each([
    'Wood (Track by Track)',
    'The Life of a Showgirl (Commentary)',
    'Album Interview',
    'Voice Memo',
  ])('flags spoken-word filler like %s', (title) => {
    expect(isUnwantedVersion(title)).toBe(true);
  });
});

describe('mentionsFeature', () => {
  it.each([
    'Ma Meilleure Ennemie ft. Coldplay',
    'Some Song feat. Someone',
    'Track (Featuring Artist)',
  ])('flags %s as mentioning a feature', (title) => {
    expect(mentionsFeature(title)).toBe(true);
  });

  it.each(['The Scientist', 'Feather', 'Often', 'Gift', 'Soft'])(
    'does not flag %s, which has no feature credit',
    (title) => {
      expect(mentionsFeature(title)).toBe(false);
    },
  );
});

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation so near-duplicate titles compare equal', () => {
    expect(normalizeTitle('Bohemian Rhapsody!')).toBe(normalizeTitle('bohemian rhapsody'));
  });
});

describe('stripVersionSuffix', () => {
  it.each([
    ['Eyes Closed (2x Speed)', 'Eyes Closed'],
    ['Eyes Closed (0.5x)', 'Eyes Closed'],
    ['Eyes Closed (Slowed + Reverb)', 'Eyes Closed'],
    ['Eyes Closed (Sped Up)', 'Eyes Closed'],
    ['Pillowtalk (Living Room Session)', 'Pillowtalk'],
    ['Yellow - Live at Wembley', 'Yellow'],
    ['Yellow (Acoustic)', 'Yellow'],
    ['Hotel California - 2013 Remaster', 'Hotel California'],
    ['Song (Album Version)', 'Song'],
    ['Song (Official Music Video)', 'Song'],
    ['Song (Acoustic) (Live)', 'Song'],
  ])('strips version suffix from %s → %s', (title, expected) => {
    expect(stripVersionSuffix(title)).toBe(expected);
  });

  it('keeps real parenthetical titles untouched', () => {
    expect(stripVersionSuffix('Single Ladies (Put a Ring on It)')).toBe(
      'Single Ladies (Put a Ring on It)',
    );
    expect(stripVersionSuffix('Waka Waka (This Time for Africa)')).toBe(
      'Waka Waka (This Time for Africa)',
    );
    expect(stripVersionSuffix('Stay (2001)')).toBe('Stay (2001)');
  });

  it('leaves plain titles unchanged', () => {
    expect(stripVersionSuffix('Eyes Closed')).toBe('Eyes Closed');
  });
});

describe('stripAnyTrailingQualifier', () => {
  it.each([
    ['EYES CLOSED (BARE)', 'EYES CLOSED'],
    ['EYES CLOSED (UNVEILED)', 'EYES CLOSED'],
    ['Eyes Closed (2.0)', 'Eyes Closed'],
    ['Eyes Closed (0.5)', 'Eyes Closed'],
    ['Song [Deluxe]', 'Song'],
    ['Song - Whatever They Called It', 'Song'],
    ['Single Ladies (Put a Ring on It)', 'Single Ladies'],
  ])('strips any trailing qualifier: %s → %s', (title, expected) => {
    expect(stripAnyTrailingQualifier(title)).toBe(expected);
  });

  it('leaves a plain title untouched, so it can be recognised as the plain form', () => {
    expect(stripAnyTrailingQualifier('Eyes Closed')).toBe('Eyes Closed');
  });

  it('never strips a title down to nothing', () => {
    expect(stripAnyTrailingQualifier('(Untitled)')).toBe('(Untitled)');
  });
});

describe('isUnwantedVersion — "live" and friends only count as qualifiers', () => {
  it.each([
    'Live Your Life',
    'Live Like You Were Dying',
    'Live and Let Die',
    'Acoustic Guitar Blues',
    'Demo Days',
  ])('keeps %s, where the word is part of the actual title', (title) => {
    expect(isUnwantedVersion(title)).toBe(false);
  });

  it.each([
    'Yellow (Acoustic)',
    'Yellow - Live at Wembley',
    'Yellow [Live]',
    'Yellow (Demo)',
    'Yellow (Unplugged)',
  ])('still flags %s, where it sits in a trailing qualifier', (title) => {
    expect(isUnwantedVersion(title)).toBe(true);
  });
});

describe('reworks of a song', () => {
  it.each([
    'Chori Chori Chupke Chupke (Trap Mix)',
    'Tune O Rangeele (Brazilian Funk Mix)',
    'Agar Tum Na Hote (Female Version)',
    'Jab Koi Baat - Recreated',
    'Kal Ho Naa Ho (Reprise)',
    'Aankhon Se Tune 2.0',
    'Pushpa Pushpa (Telugu)',
  ])('rejects %s', (title) => expect(isUnwantedVersion(title)).toBe(true));
  it.each(['Super Bass', 'Happiness Is So Sad', 'TRAP AIBA', 'In Da Club', 'Ek Pal Ka Jeena'])(
    'keeps %s',
    (title) => expect(isUnwantedVersion(title)).toBe(false),
  );
});
