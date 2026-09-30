<div align="center">

<h1 align="center">
  <img src="apps/web/public/logo.svg" width="38" height="38" alt="Chorusify Logo" style="transform: translateY(4px); margin-right: 6px; display: inline-block;" />
  Chorusify
</h1>

### _Guess your favorite music._

**[chorusify.com](https://chorusify.com)**

[![Live](https://img.shields.io/website?url=https%3A%2F%2Fchorusify.com&label=chorusify.com&style=flat-square)](https://chorusify.com)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
[![Last commit](https://img.shields.io/github/last-commit/MayurJivani/Chorus?style=flat-square)](https://github.com/MayurJivani/Chorus/commits/main)

</div>

<br>

> _For everyone who's ever finished a lyric before the singer did. For the ones who know a song from its first half-second. For the stans, the superfans, the ones who know the deep cuts too. This one's for you._

---

## Modes

**Daily.** One song. Dropped at midnight UTC. The whole world guesses the same track, at the same time. Did you nail it before your friends woke up?

**Artist.** Pick a discography, any discography, and go 10 rounds deep. Type it out from memory or pick from the lineup. Real leaderboards, per artist, for the true completionists.

**Categories.** Top hits by year (2000-2025), genre (Pop, Rock, Rap, K-Pop, Bollywood...), or the worldwide chart. Hundreds of playlists.

**Multiplayer.** Up to 8 in a room, real-time, no sign-up. Songs unfold second by second (`1s → 2s → 4s → 7s → 11s → 16s`), and _you_ decide how much you need to hear before you buzz in.

**Survival.** One song after another, no end in sight, until the one that finally gets you. How deep does your crate go?

**Guess the Year.** Hear a song and place it in time. How well do you know your decades?

**Duels.** Rated 1v1. Both players get the same ten songs. Elo ratings, global leaderboard.

_Karaoke covers, live cuts, and remixes don't make the bank. Originals only!!_

---

## Fandoms

Join your favorite artist's fandom and earn your place on the leaderboard. Every challenge you complete earns fan score, which determines your tier, from Newcomer all the way up to Diamond.

Collect interactive cards with holographic effects, media decorations, and download them as PNGs. Eight tiers: **Diamond** · **Platinum** · **Gold** · **Silver** · **Bronze** · **Fan** · **Listener** · **Newcomer**

---

## Built with

```
apps/web     React 18 · Vite · TypeScript · Tailwind CSS · Framer Motion
apps/server  Express 5 · TypeScript · PostgreSQL · Drizzle ORM · postgres.js
realtime     WebSockets (ws), same-origin, session-authenticated
music data   Deezer API, 30s previews, thousands of tracks deep
infra        Docker Compose · Caddy reverse proxy
```

---

## Sound check

Get it spinning locally before you drop the needle for real.

```bash
npm install
cp apps/server/.env.example apps/server/.env
openssl rand -hex 32          # session secret

npm run -w apps/server db:migrate
npm run curate:songs
npm run dev                    # api :8888, web :5174
```

| Script               | What it does                          |
| -------------------- | ------------------------------------- |
| `dev`                | frontend + backend, watch mode        |
| `build`              | production build                      |
| `lint` / `typecheck` | keep the code in tune                 |
| `test`               | full suite, isolated `_test` database |
| `curate:songs`       | stock the crate from Deezer           |
| `reverify:songs`     | make sure every track still plays     |

---

## Deploy

Set `DATABASE_URL`, ship it. Migrations run automatically on boot.

```bash
npm run build:full && npm start
```

The frontend also ships standalone to Vercel, Netlify, or Cloudflare Pages, if you'd rather split the set.

---

## Security

Argon2id · opaque server-side sessions · double-submit CSRF · rate limiting · Zod validation · Helmet + CSP

---

<div align="center">

**Built with ❤️ and 🎵**

</div>
