# Hosted events: audit and design

## What was there

| Finding                                                                        | Why it mattered                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Rooms capped at 100 by a setting, host always a seated player                  | No way to run an audience, and the host had to be in the game            |
| `room_state` carried every player and went out per join, serialised per socket | 1,000 joins meant about 50 GB of frames                                  |
| `scores` went out per guess, and each guess re-sorted the room for your rank   | A burst of answers was quadratic                                         |
| Dropped socket mid-game meant out for good                                     | Unworkable on phones in a hall                                           |
| `previewUrl` sent to every player in host-only rooms                           | The client hid it; the server did not                                    |
| All previews resolved at game start                                            | Deezer signs them for about 15 minutes, so long events would die partway |
| Caches were unbounded Maps; some Deezer calls bypassed the budget              | Memory growth, and quota could be spent unseen                           |
| `is_admin` could be granted by any admin                                       | No single owner                                                          |
| Every route in one bundle                                                      | Someone scanning a QR downloaded the admin console                       |

## Decisions

**One Node process, no Redis.** 1,000 players in one room measured well under one core (see LOAD-TEST.md), and rooms already live in memory. Redis would add coordination nobody needs yet. Revisit when one server must hold several events of this size at once, or restarts mid-event become unacceptable: live scores are lost on restart, and an event then reopens at its lobby.

**A room with an `event` attached, not a second game engine.** Rounds, scoring and sockets are shared with friends' rooms. Ordinary rooms keep their rules: instant updates, and a drop means out.

**Separate capabilities.** The owner is on the stored event. The controller is one socket (`room.hostId`) that holds no seat. A player is an entry in `room.players`. An owner can be all three, only if the event says the host plays.

**Seats keyed by identity.** The account or guest id holds the seat, so a reconnect restores score, round and the same answer order. A second tab replaces the first.

**Above 32 players, updates are batched.** At most one scoreboard and one room frame per 250 ms, each serialised once. Snapshots carry the newest 24 names plus an exact count. Ranks are frozen per round.

**Server-scheduled audio.** `round_start` carries the instant the music starts, 2.5 s ahead. Clients estimate their clock offset from pings, using the lowest round trip, and always play at `now - startedAt`. Late joiners and reconnects need no special case. Accuracy depends on real networks and has not been measured on a room of phones.

**Writes only at the edges.** An event's row changes when it starts and ends. Scores stay in memory, so an answer never touches the database.

**Playlists as jsonb, copied into the event.** The only operation is saving the whole list, and the copy keeps a live event stable. Category membership stays in `artist_track_pools`, one row per category, which already gives a song membership in many categories without a join table.

**HMAC for event passwords, not argon2.** A thousand people join in a minute. It is a door code, capped at five tries per socket, and never in the QR or link.

## Deezer

Every server call goes through `deezerFetchJson`: 45 calls per 5 s with lower budgets for search and bulk work, 12 concurrent, 8 s timeout, jittered retries, a circuit breaker (5 failures, 30 s), and joining of identical requests in flight. Caches are bounded LRU. Search answers last 30 minutes, empty ones 60 s. Previews last 10 minutes and are reused only during an outage, for at most 14, because signed URLs expire. The exception is the startup seed in `db/seed.ts`, which only runs on an empty song table.

## Display names

Everyone must have a name. `utils/nameFilter.ts` checks them on the server at join, registration and profile update, using a list covering about 27 languages plus our own additions, with spacing and look-alike characters undone. No list covers every language or tomorrow's slur, so the host can still remove anyone from the console.

## Operating an event

- Set `ADMIN_EMAIL`. Without it nobody is admin, and existing `is_admin` flags no longer count. The account must already exist, or set `ADMIN_REGISTRATION_OPEN=true` once to create it.
- Promote hosts under Admin, Users. Health numbers are under Admin, Event hosts (`GET /api/admin/metrics`).
- Do not deploy during an event: a restart drops live scores.
- Ask players to turn sound up in `everyone_plays`, and to tap if the phone asks. Browsers may block audio until a tap.
