import { describe, expect, it } from 'vitest';
import { buildAliases, foldForSearch } from '../../src/utils/songAliases';

describe('song aliases', () => {
  it('folds accents and punctuation', () => {
    expect(foldForSearch("Beyoncé & Don't")).toBe('beyonce and don t');
  });
  it('offers transliterations for Hindi titles only', () => {
    expect(buildAliases('Pehla Nasha Woh Pal', 'hi')).toContain('pehla nasha voh pal');
    expect(buildAliases('Kabhie Kabhie', 'hi')).toContain('kabhi kabhi');
    expect(buildAliases('Woman', 'en')).not.toContain('voman');
  });
  it('drops qualifiers and never repeats the title', () => {
    const aliases = buildAliases('Tum Hi Ho (From "Aashiqui 2")', 'hi');
    expect(aliases).toContain('tum hi ho');
    expect(new Set(aliases).size).toBe(aliases.length);
  });
});
