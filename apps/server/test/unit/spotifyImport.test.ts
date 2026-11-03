import { describe, expect, it } from 'vitest';
import { parseSpotifyUrl, pickMatch } from '../../src/services/spotifyImport';
import type { SongSearchHit } from '../../src/services/deezerService';

const hit = (id: string, title: string, artist: string, preview = true): SongSearchHit => ({
  deezerTrackId: id,
  title,
  artist,
  album: null,
  albumArtUrl: null,
  durationSeconds: 200,
  previewUrl: preview ? `https://x.dzcdn.net/${id}.mp3` : null,
});

describe('parseSpotifyUrl', () => {
  it.each([
    ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc', 'playlist'],
    ['https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M', 'playlist'],
    ['spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', 'playlist'],
    ['https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj', 'album'],
  ])('reads %s', (url, kind) => {
    expect(parseSpotifyUrl(url)?.kind).toBe(kind);
  });

  it.each([
    'https://evil.com/playlist/37i9dQZF1DXcBWIGoYBM5M/../x',
    'https://open.spotify.com/track/7bxaFZ1O3cHkgLKMsdC3xR',
    'hello',
  ])('refuses %s', (url) => {
    expect(parseSpotifyUrl(url)).toBeNull();
  });
});

describe('pickMatch', () => {
  it('takes the same song by the same artist, ignoring feature and remaster tails', () => {
    const hits = [
      hit('1', 'Blinding Lights (Karaoke)', 'Sing Along'),
      hit('2', 'Blinding Lights', 'Cover Band'),
      hit('3', 'Blinding Lights - Remastered', 'The Weeknd'),
    ];
    expect(pickMatch({ title: 'Blinding Lights', artist: 'The Weeknd' }, hits)?.deezerTrackId).toBe(
      '3',
    );
  });

  it('matches accented and non-Latin titles', () => {
    expect(
      pickMatch({ title: 'Despacito', artist: 'Luis Fonsi, Daddy Yankee' }, [
        hit('9', 'Despacito (feat. Daddy Yankee)', 'Luis Fonsi'),
      ])?.deezerTrackId,
    ).toBe('9');
    expect(
      pickMatch({ title: 'तुम ही हो', artist: 'Arijit Singh' }, [
        hit('5', 'तुम ही हो', 'Arijit Singh'),
      ])?.deezerTrackId,
    ).toBe('5');
  });

  it('skips songs with no audio and reports no match rather than a wrong one', () => {
    expect(
      pickMatch({ title: 'Loser', artist: 'Tame Impala' }, [
        hit('1', 'Loser', 'Tame Impala', false),
      ]),
    ).toBeNull();
    expect(
      pickMatch({ title: 'Loser', artist: 'Tame Impala' }, [hit('2', 'Creep', 'Radiohead')]),
    ).toBeNull();
  });
});
