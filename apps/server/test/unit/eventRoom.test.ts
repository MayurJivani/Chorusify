import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EVENT_MAX_PLAYERS,
  handleClientMessage,
  registerConnection,
  setEventHooks,
  unregisterConnection,
  __getCurrentTrack,
  __resetForTests,
  eventOptions,
  maxEventRounds,
  type MpEvent,
  type MpSocket,
} from '../../src/services/multiplayerService';

const getFreshPreviewUrl = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/deezerService', () => ({ getFreshPreviewUrl }));
vi.mock('../../src/services/artistCatalogService', () => ({ getArtistCatalog: vi.fn() }));
vi.mock('../../src/services/settingsService', () => ({
  getSettings: async () => ({ multiplayerRevealSeconds: 5, snippetScheduleSeconds: [1, 2] }),
}));

// A real round trip cannot resolve while these tests hold fake timers.
vi.mock('../../src/db/client', () => {
  const rows = async () => [{ displayName: 'Named' }];
  return {
    db: { select: () => ({ from: () => ({ where: () => ({ limit: rows }) }) }) },
  };
});

const LEAD = 2500;

class Sock implements MpSocket {
  sent: Record<string, unknown>[] = [];
  closed: number | undefined;
  send(data: string | Buffer) {
    this.sent.push(JSON.parse(data.toString()) as Record<string, unknown>);
  }
  close(code?: number) {
    this.closed = code;
  }
  of(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
  last(type: string) {
    return this.of(type).at(-1) as Record<string, any>;
  }
}

const tracks = Array.from({ length: 6 }, (_, i) => ({
  deezerTrackId: String(100 + i),
  title: `Song ${i}`,
  artist: `Artist ${i}`,
  albumArtUrl: null,
  durationSeconds: 30,
}));

const secondTracks = tracks.map((t, i) => ({
  ...t,
  deezerTrackId: String(200 + i),
  title: `Second ${i}`,
}));

let event: MpEvent;
const finished = vi.fn();
const conn = (id: string, userId: string | null, guestId: string | null = null) => {
  const socket = new Sock();
  registerConnection({ playerId: id, socket, identity: { userId, guestId } });
  return socket;
};
const msg = (id: string, m: Record<string, unknown>) => handleClientMessage(id, m);
const join = (id: string, extra = {}) =>
  msg(id, { type: 'join_room', code: 'EVENT1', nickname: `Player ${id}`, ...extra });
const hostUp = async () => {
  const host = conn('host', 'owner');
  await msg('host', { type: 'host_event', eventId: 'e1', code: 'EVENT1' });
  return host;
};

beforeEach(() => {
  vi.useFakeTimers();
  __resetForTests();
  finished.mockClear();
  getFreshPreviewUrl.mockImplementation(async (id: string) => ({
    previewUrl: `https://cdnt-preview.dzcdn.net/${id}.mp3`,
    durationSeconds: 30,
  }));
  event = {
    id: 'e1',
    ownerUserId: 'owner',
    name: 'Freshers',
    description: '',
    passwordHash: null,
    audioMode: 'everyone_plays',
    hostPlays: false,
    playbackSeconds: 10,
    rounds: 3,
    trialTrack: null,
    showCovers: false,
  };
  setEventHooks({
    load: async () => ({
      event,
      tracks,
      config: { rounds: 3, guessSeconds: 20, maxPoints: 100, minPoints: 10, firstBonus: 5 },
    }),
    canHost: async (userId) => userId === 'owner',
    checkPassword: (_e, password) => password === 'open sesame',
    checkScreenKey: (_e, key) => key === 'screen-key',
    usePlaylist: async (_e, id) =>
      id === 'second'
        ? { tracks: secondTracks, trialTrack: null }
        : id === 'with-trial'
          ? { tracks: secondTracks, trialTrack: { ...tracks[5]!, title: 'Warmup', album: null } }
          : null,
    onStarted: vi.fn(),
    onFinished: finished,
  });
});
afterEach(() => vi.useRealTimers());

const start = async () => {
  await msg('host', { type: 'start_game' });
  await vi.advanceTimersByTimeAsync(0);
};

describe('event rooms', () => {
  it('lets the host run everything without taking a seat', async () => {
    const host = await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();

    expect(host.last('room_state').room.players.map((p: any) => p.playerId)).toEqual(['a']);
    expect(host.last('room_state').room.playerCount).toBe(1);
    expect(host.of('round_start')).toHaveLength(0);
    expect(host.last('host_round').title).toBe('Song 0');
    expect(host.last('room_state').room.phase).toBe('playing');
    expect(a.of('round_start')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(LEAD);
    await msg('a', { type: 'guess', trackId: '100' });
    await vi.advanceTimersByTimeAsync(0);
    const scores = a.last('round_end').scores;
    expect(scores.map((s: any) => s.playerId)).toEqual(['a']);
  });

  it('makes a guest give a name, and refuses an offensive one', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    await msg('a', { type: 'join_room', code: 'EVENT1' });
    expect(a.last('error').code).toBe('name_required');
    await msg('a', { type: 'join_room', code: 'EVENT1', nickname: 'f u c k' });
    expect(a.last('error').code).toBe('name_rejected');
    expect(a.of('room_state')).toHaveLength(0);
    await msg('a', { type: 'join_room', code: 'EVENT1', nickname: 'Ishita' });
    expect(a.last('room_state').room.playerCount).toBe(1);
  });

  it('will not start an event nobody has joined', async () => {
    const host = await hostUp();
    await start();
    expect(host.last('error').message).toMatch(/Nobody has joined/);
    expect(host.of('host_round')).toHaveLength(0);
  });

  it('seats the host when the event says the host plays', async () => {
    event.hostPlays = true;
    const host = await hostUp();
    expect(host.last('room_state').room.playerCount).toBe(1);
  });

  it('refuses control to anyone but the owner, including a seated player', async () => {
    await hostUp();
    const a = conn('a', 'someone');
    await join('a');
    await msg('a', { type: 'host_event', eventId: 'e1', code: 'EVENT1' });
    expect(a.last('error').code).toBe('not_host');
    for (const type of ['host_pause', 'host_skip', 'host_end', 'host_stop_audio']) {
      a.sent.length = 0;
      await msg('a', { type });
      expect(a.last('error').code).toBe('not_host');
    }
    await msg('a', { type: 'start_game' });
    expect(a.last('error').message).toMatch(/Only the host/);
  });

  it('host_only sends audio to the host device and to no player', async () => {
    event.audioMode = 'host_only';
    const host = await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();
    expect(a.last('round_start').previewUrl).toBeNull();
    expect(host.last('host_round').previewUrl).toContain('100.mp3');

    await vi.advanceTimersByTimeAsync(LEAD);
    await msg('a', { type: 'guess', trackId: '100' });
    expect(a.last('round_end').correct.previewUrl).toBeNull();
    expect(host.last('reveal_audio').previewUrl).toContain('100.mp3');
    expect(JSON.stringify(a.sent)).not.toContain('.mp3');
  });

  it('everyone_plays gives every player the same audio and start instant', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    const b = conn('b', null, 'gb');
    await join('a');
    await join('b');
    const before = Date.now();
    await start();
    const [ra, rb] = [a.last('round_start'), b.last('round_start')];
    expect(ra.previewUrl).toContain('100.mp3');
    expect(rb.previewUrl).toBe(ra.previewUrl);
    expect(rb.startedAt).toBe(ra.startedAt);
    expect(ra.startedAt).toBeGreaterThanOrEqual(before + LEAD);
  });

  it('counts one answer per seat, and none before the music starts', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    conn('b', null, 'gb');
    await join('a');
    await join('b');
    await start();

    await msg('a', { type: 'guess', trackId: '100' });
    expect(a.last('error').message).toMatch(/not started/);
    await vi.advanceTimersByTimeAsync(LEAD);

    await Promise.all([1, 2, 3].map(() => msg('a', { type: 'guess', trackId: '100' })));
    expect(a.of('guess_result')).toHaveLength(1);
    expect(a.last('error').message).toMatch(/Already answered/);
  });

  it('gives a reconnecting player their seat, score and round back', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    conn('b', null, 'gb');
    await join('a');
    await join('b');
    await start();
    await vi.advanceTimersByTimeAsync(LEAD);
    await msg('a', { type: 'guess', trackId: '100' });
    const options = a.last('round_start').options;

    unregisterConnection('a');
    const again = conn('a2', null, 'ga');
    await join('a2');

    expect(again.last('room_state').room.playerCount).toBe(2);
    expect(again.last('round_start').options).toEqual(options);
    expect(again.last('guess_result')).toBeTruthy();
    await msg('a2', { type: 'guess', trackId: '100' });
    expect(again.last('error').message).toMatch(/Already answered/);

    await msg('b', { type: 'guess', trackId: 'wrong' });
    const end = again.last('round_end').scores;
    expect(end[0].playerId).toBe('a2');
    expect(end[0].score).toBeGreaterThan(0);
  });

  it('replaces a second tab rather than seating the same person twice', async () => {
    await hostUp();
    const first = conn('a', null, 'ga');
    await join('a');
    const second = conn('a2', null, 'ga');
    await join('a2');
    expect(first.closed).toBe(4001);
    expect(second.last('room_state').room.playerCount).toBe(1);
  });

  it('does not wait for a disconnected player, and lets a late joiner in mid-round', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    conn('b', null, 'gb');
    await join('a');
    await join('b');
    await start();
    await vi.advanceTimersByTimeAsync(LEAD);

    const late = conn('c', null, 'gc');
    await join('c');
    expect(late.last('round_start').roundIndex).toBe(0);
    await msg('c', { type: 'guess', trackId: 'wrong' });

    unregisterConnection('b');
    await msg('a', { type: 'guess', trackId: '100' });
    expect(a.of('round_end')).toHaveLength(1);
  });

  it('pauses the clock and rejects answers until resumed', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();
    await vi.advanceTimersByTimeAsync(LEAD + 1000);
    const startedAt = a.last('round_start').startedAt;

    await msg('host', { type: 'host_pause' });
    expect(a.last('paused').remainingMs).toBe(19000);
    await msg('a', { type: 'guess', trackId: '100' });
    expect(a.last('error').message).toMatch(/No round/);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.of('round_end')).toHaveLength(0);
    await msg('host', { type: 'host_resume' });
    expect(a.last('resumed').startedAt).toBe(startedAt + 60_000);

    await vi.advanceTimersByTimeAsync(19_000);
    expect(a.of('round_end')).toHaveLength(1);
  });

  it('takes back points from a skipped round and moves on', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    conn('b', null, 'gb');
    await join('a');
    await join('b');
    await start();
    await vi.advanceTimersByTimeAsync(LEAD);
    await msg('a', { type: 'guess', trackId: '100' });
    await msg('host', { type: 'host_skip' });
    await vi.advanceTimersByTimeAsync(0);

    expect(a.last('round_start').roundIndex).toBe(1);
    expect(a.last('scores').scores[0].score).toBe(0);
    expect(__getCurrentTrack('EVENT1')?.title).toBe('Song 1');
  });

  it('never offers an earlier answer as an option', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();
    await msg('host', { type: 'host_skip' });
    await vi.advanceTimersByTimeAsync(0);
    await msg('host', { type: 'host_skip' });
    await vi.advanceTimersByTimeAsync(0);

    const ids = a.last('round_start').options.map((o: any) => o.deezerTrackId);
    expect(a.last('round_start').roundIndex).toBe(2);
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain('100');
    expect(ids).not.toContain('101');
  });

  it('plays the trial song first, wipes its points, then waits for the real start', async () => {
    event.trialTrack = { ...tracks[0]!, deezerTrackId: '900', title: 'Trial', album: null };
    const host = await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    expect(host.last('room_state').room.trialPending).toBe(true);
    await start();
    expect(host.last('host_round').title).toBe('Trial');
    expect(a.last('room_state').room.isTrial).toBe(true);

    await vi.advanceTimersByTimeAsync(LEAD);
    await msg('a', { type: 'guess', trackId: '900' });
    await vi.advanceTimersByTimeAsync(0);
    expect(a.last('round_end').scores[0].score).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(6_000);

    const room = a.last('room_state').room;
    expect(room.phase).toBe('lobby');
    expect(room.isTrial).toBe(false);
    expect(room.trialPending).toBe(false);
    expect(room.trialDone).toBe(true);
    expect(a.last('scores').scores[0].score).toBe(0);
    expect(a.of('game_over')).toHaveLength(0);
    expect(finished).not.toHaveBeenCalled();

    await start();
    expect(host.last('host_round').title).toBe('Song 0');
    expect(a.last('round_start').totalRounds).toBe(3);
  });

  it('starts the real game straight from the trial when the host asks', async () => {
    event.trialTrack = { ...tracks[0]!, deezerTrackId: '900', title: 'Trial', album: null };
    const host = await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();
    expect(host.last('host_round').title).toBe('Trial');
    await vi.advanceTimersByTimeAsync(LEAD);
    await msg('a', { type: 'guess', trackId: '900' });
    await start();
    expect(host.last('host_round').title).toBe('Song 0');
    expect(a.last('room_state').room.isTrial).toBe(false);
    expect(a.last('scores').scores[0].score).toBe(0);
  });

  it('puts album covers on the options only when the event asks for them', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();
    expect(a.last('round_start').options[0]).not.toHaveProperty('albumArtUrl');

    __resetForTests();
    event.showCovers = true;
    await hostUp();
    const b = conn('b', null, 'gb');
    await join('b');
    await start();
    expect(b.last('round_start').options[0]).toHaveProperty('albumArtUrl');
  });

  it('lets every song be a round once its wrong answers are picked', () => {
    const pool = tracks.map((t) => ({ ...t, album: null }));
    const three = secondTracks.slice(0, 3).map((t) => ({ ...t }));
    expect(maxEventRounds(pool)).toBe(3);
    expect(maxEventRounds(pool.map((t) => ({ ...t, decoys: three })))).toBe(6);
    // Only the last three need picks: earlier songs have three or more songs after them.
    const lastOnly = pool.map((t, i) => (i >= 3 ? { ...t, decoys: three } : t));
    expect(maxEventRounds(lastOnly)).toBe(6);
  });

  it('uses the host-picked wrong answers and fills the rest from the playlist', () => {
    const pick = (i: number) => ({ ...secondTracks[i]!, album: null });
    const pool = tracks.map((t) => ({ ...t, album: null }));
    const decoys = [pick(0), pick(1), pick(2)];
    const all = eventOptions({ ...pool[0]!, decoys }, pool, false).map((o) => o.deezerTrackId);
    expect(all.sort()).toEqual(['100', '200', '201', '202']);

    const some = eventOptions({ ...pool[0]!, decoys: [pick(0)] }, pool, false);
    const ids = some.map((o) => o.deezerTrackId);
    expect(ids).toHaveLength(4);
    expect(ids).toContain('100');
    expect(ids).toContain('200');
    expect(new Set(ids).size).toBe(4);
  });

  it('drops an unplayable song instead of stopping, and tells the host', async () => {
    getFreshPreviewUrl.mockImplementation(async (id: string) =>
      id === '100' ? null : { previewUrl: `https://x.dzcdn.net/${id}.mp3`, durationSeconds: 30 },
    );
    const host = await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();
    expect(host.last('song_skipped').title).toBe('Song 0');
    expect(a.last('round_start').roundIndex).toBe(1);
  });

  it('survives Deezer failing outright', async () => {
    getFreshPreviewUrl.mockRejectedValue(new Error('down'));
    await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();
    expect(a.of('game_over')).toHaveLength(1);
  });

  it('ends on command, without crediting the unfinished round, and stores the result', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    conn('b', null, 'gb');
    await join('b');
    await start();
    await vi.advanceTimersByTimeAsync(LEAD);
    await msg('a', { type: 'guess', trackId: '100' });
    await msg('host', { type: 'host_end' });
    expect(a.last('game_over').scores[0].score).toBe(0);
    expect(finished).toHaveBeenCalledWith('e1', 2, expect.any(Array));
  });

  it('removes a kicked player for good', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await msg('host', { type: 'host_kick', playerId: 'a' });
    expect(a.closed).toBe(4002);
    const back = conn('a2', null, 'ga');
    await join('a2');
    expect(back.last('error').message).toMatch(/removed/);
  });

  it('checks the password for new seats, closes after repeated guessing, skips it on return', async () => {
    event.passwordHash = 'x';
    await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    expect(a.last('error').code).toBe('password_required');
    for (let i = 0; i < 4; i += 1) await join('a', { password: 'nope' });
    expect(a.last('error').code).toBe('wrong_password');
    expect(a.closed).toBe(1008);

    const ok = conn('b', null, 'gb');
    await join('b', { password: 'open sesame' });
    expect(ok.last('room_state').room.playerCount).toBe(1);
    unregisterConnection('b');
    const back = conn('b2', null, 'gb');
    await join('b2');
    expect(back.last('room_state').room.playerCount).toBe(1);
  });

  it('shares a rank between players level on points and time', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    conn('b', null, 'gb');
    await join('a');
    await join('b');
    await start();
    await vi.advanceTimersByTimeAsync(LEAD + 1000);
    await msg('a', { type: 'guess', trackId: 'wrong' });
    await msg('b', { type: 'guess', trackId: 'wrong' });
    const ranks = a.last('round_end').scores.map((s: any) => s.rank);
    expect(ranks).toEqual([1, 1]);
  });

  it('coalesces a large room: names capped, frames bounded, count exact', async () => {
    const host = await hostUp();
    expect(EVENT_MAX_PLAYERS).toBe(1000);
    const socks = Array.from({ length: 60 }, (_, i) => conn(`p${i}`, null, `g${i}`));
    for (let i = 0; i < 60; i += 1) await join(`p${i}`);
    host.sent.length = 0;
    await vi.advanceTimersByTimeAsync(300);
    const state = host.last('room_state').room;
    expect(state.playerCount).toBe(60);
    expect(state.players.length).toBeLessThanOrEqual(24);

    await start();
    await vi.advanceTimersByTimeAsync(LEAD);
    const before = socks[0]!.of('scores').length;
    for (let i = 0; i < 30; i += 1) await msg(`p${i}`, { type: 'guess', trackId: '100' });
    await vi.advanceTimersByTimeAsync(300);
    expect(socks[0]!.of('scores').length - before).toBe(1);
    expect(socks[0]!.last('scores').answeredCount).toBe(30);
    expect(socks[0]!.last('scores').scores.length).toBe(10);
  });

  it('gives a screen with the right key the game and the music, even in host-only mode', async () => {
    event.audioMode = 'host_only';
    await hostUp();
    const tv = conn('tv', null, 'gtv');
    await msg('tv', { type: 'watch_room', code: 'EVENT1', key: 'wrong' });
    expect(tv.last('error').code).toBe('screen_refused');
    await msg('tv', { type: 'watch_room', code: 'EVENT1', key: 'screen-key' });
    const a = conn('a', null, 'ga');
    await join('a');
    expect(tv.last('room_state').room.playerCount).toBe(1);

    await start();
    expect(tv.last('round_start').previewUrl).toContain('100.mp3');
    expect(tv.last('round_start').options).toHaveLength(4);
    expect(a.last('round_start').previewUrl).toBeNull();

    // A screen never answers or holds a seat.
    await vi.advanceTimersByTimeAsync(LEAD);
    await msg('tv', { type: 'guess', trackId: '100' });
    expect(tv.of('guess_result')).toHaveLength(0);
    await msg('a', { type: 'guess', trackId: '100' });
    expect(tv.last('round_end').scores.map((r: any) => r.playerId)).toEqual(['a']);
    expect(tv.last('reveal_audio').previewUrl).toContain('100.mp3');
  });

  it('plays another playlist in the same room, keeping players and both results', async () => {
    const host = await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();
    await msg('host', { type: 'host_end' });
    expect(a.of('game_over')).toHaveLength(1);

    await msg('host', { type: 'host_next_playlist', playlistId: 'nope' });
    expect(host.last('error').message).toMatch(/at least/);
    await msg('host', { type: 'host_next_playlist', playlistId: 'second' });
    expect(a.last('room_state').room.phase).toBe('lobby');
    expect(a.last('room_state').room.playerCount).toBe(1);

    await start();
    expect(host.last('host_round').title).toBe('Second 0');
    await msg('host', { type: 'host_end' });
    const games = finished.mock.calls.map((call) => call[2][0]?.game);
    expect(games).toEqual([1, 2]);
  });

  it('plays the trial song of a playlist loaded for the next game', async () => {
    const host = await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await start();
    await msg('host', { type: 'host_end' });
    await msg('host', { type: 'host_next_playlist', playlistId: 'with-trial' });
    expect(a.last('room_state').room.trialPending).toBe(true);
    await start();
    expect(host.last('host_round').title).toBe('Warmup');
    expect(a.last('room_state').room.isTrial).toBe(true);
  });

  it('refuses the next-playlist command from anyone but the host', async () => {
    await hostUp();
    const a = conn('a', null, 'ga');
    await join('a');
    await msg('a', { type: 'host_next_playlist', playlistId: 'second' });
    expect(a.last('error').code).toBe('not_host');
  });

  it('keeps a chosen avatar, and drops one that is not on the list', async () => {
    const host = await hostUp();
    conn('a', null, 'ga');
    conn('b', null, 'gb');
    await join('a', { avatar: 'guitar' });
    await join('b', { avatar: '<script>' });
    const players = host.last('room_state').room.players;
    expect(players.find((p: any) => p.playerId === 'a').avatar).toBe('guitar');
    expect(players.find((p: any) => p.playerId === 'b').avatar).toBeNull();
  });

  it('lets the host add time, reveal early, lock entry and see the answer split', async () => {
    const host = await hostUp();
    const a = conn('a', null, 'ga');
    conn('b', null, 'gb');
    await join('a');
    await join('b');
    await start();
    await vi.advanceTimersByTimeAsync(LEAD);
    await msg('host', { type: 'host_extend', seconds: 10 });
    expect(a.last('round_extended')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(a.of('round_end')).toHaveLength(0);

    await msg('a', { type: 'guess', trackId: '100' });
    await msg('host', { type: 'host_reveal' });
    const end = a.last('round_end');
    expect(end.answers).toEqual({ '100': 1 });

    await msg('host', { type: 'host_lock', locked: true });
    const late = conn('c', null, 'gc');
    await join('c');
    expect(late.last('error').message).toMatch(/closed entry/);
    // Someone who already had a seat still gets back in.
    unregisterConnection('b');
    const back = conn('b2', null, 'gb');
    await join('b2');
    expect(back.last('room_state')).toBeTruthy();

    await msg('host', { type: 'host_players', q: 'player a' });
    expect(host.last('host_players').players.map((p: any) => p.playerId)).toEqual(['a']);
  });
});
