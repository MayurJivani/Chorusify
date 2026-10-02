import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { __resetForTests } from '../../src/services/multiplayerService';
import * as deezerService from '../../src/services/deezerService';

vi.mock('../../src/services/deezerService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/deezerService')>();
  return {
    ...actual,
    getArtistById: vi.fn(),
  };
});

const app = createApp();

async function getCsrfToken(agent: ReturnType<typeof request.agent>): Promise<string> {
  const res = await agent.get('/api/csrf-token');
  return res.body.csrfToken as string;
}

beforeEach(() => {
  __resetForTests();
  vi.clearAllMocks();
  vi.mocked(deezerService.getArtistById).mockResolvedValue({
    id: 412,
    name: 'Queen',
    pictureUrl: null,
  });
});

describe('POST /api/multiplayer/rooms', () => {
  it('creates a room for a known artist', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent
      .post('/api/multiplayer/rooms')
      .set('X-CSRF-Token', csrfToken)
      .send({ artistId: 412 });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(res.body).toMatchObject({
      sourceType: 'artist',
      sourceId: '412',
      label: 'Queen',
    });
  });

  it('creates a room for a category', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent
      .post('/api/multiplayer/rooms')
      .set('X-CSRF-Token', csrfToken)
      .send({ categoryId: 'year-2020' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sourceType: 'category',
      sourceId: 'year-2020',
      label: 'Top Hits 2020',
    });
  });

  it('creates a room over several merged categories', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent
      .post('/api/multiplayer/rooms')
      .set('X-CSRF-Token', csrfToken)
      .send({ categoryId: 'year-2020+year-2021' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sourceType: 'category',
      sourceId: 'year-2020+year-2021',
      label: 'Top Hits 2020 + Top Hits 2021',
    });
  });

  it('rejects a request naming both an artist and a category', async () => {
    // Ambiguous rather than harmless: the room would race over whichever the code checked
    // first, which need not be the one the player meant.
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent
      .post('/api/multiplayer/rooms')
      .set('X-CSRF-Token', csrfToken)
      .send({ artistId: 412, categoryId: 'year-2020' });

    expect(res.status).toBe(400);
  });

  it('rejects a request naming neither', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent.post('/api/multiplayer/rooms').set('X-CSRF-Token', csrfToken).send({});

    expect(res.status).toBe(400);
  });

  it('rejects an unknown category', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent
      .post('/api/multiplayer/rooms')
      .set('X-CSRF-Token', csrfToken)
      .send({ categoryId: 'year-1066' });

    expect(res.status).toBe(404);
  });

  it('rejects an unknown artist', async () => {
    vi.mocked(deezerService.getArtistById).mockResolvedValue(null);
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent
      .post('/api/multiplayer/rooms')
      .set('X-CSRF-Token', csrfToken)
      .send({ artistId: 999999 });
    expect(res.status).toBe(404);
  });

  it('validates the artistId payload', async () => {
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const res = await agent
      .post('/api/multiplayer/rooms')
      .set('X-CSRF-Token', csrfToken)
      .send({ artistId: 'nope' });
    expect(res.status).toBe(400);
  });
});
