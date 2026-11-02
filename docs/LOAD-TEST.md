# Event load test

Run with `apps/server/src/scripts/loadtest-event.ts`. One server process and the clients in four worker processes on the same 24-thread machine, Deezer stubbed, local Postgres. These are capacity numbers for one process. They do not measure venue wifi or real phones.

| Scenario         | Result at 1,000 simulated players                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A lobby          | 1000/1000 connected in 4.1s, join p95 394 ms, 8 frames per client, RSS 204 MB                                                                                                                                    |
| B game           | 4000 answers, no errors; handling p95 0.21 ms; client round trip p95 38 ms; round start reaching everyone p95 80 ms, max 93 ms; 7% of one core                                                                   |
| C host only      | 0 audio urls and 0 host frames reached players; host seated as player: false                                                                                                                                     |
| D everyone plays | One start instant per round; 88 reconnects restored their round in 218 ms; 100 late joiners got the current round; dead song skipped and host told                                                               |
| E Deezer         | 1,000 identical searches cost 1 call; 60 distinct searches stayed at 21 calls per 5 s; breaker opened in an outage with 0 calls while open; a game finished during the outage                                    |
| F sustained      | 186 rounds over 15 minutes: 1000 connections held, no unexpected closes, average heap 33 MB then 30 MB. Repeated on the final build: 112 rounds over 9 minutes, heap 36 then 31 MB, event loop p99 at most 91 ms |

Both sustained runs stopped when the playlist ran out, so no leak shows over these 9 to 15 minutes. A multi-hour run has not been done.

The harness fails on binary frames, because Node clients can read them and browsers cannot. A real browser test found that bug, not the load test, so test the screens as well after changing the socket layer.

# Category audit

From `apps/server/src/scripts/verify-category-size.ts` against live Deezer. Playable means a preview url exists; a sample of 8 per category was fetched to confirm audio. Song placement in a year is checked by sampling each playlist, not song by song.

69 of 78 categories reach 250. Short, with no acceptable source found:

| Category  | Unique | Playable |
| --------- | -----: | -------: |
| year-2014 |    342 |      231 |
| year-2012 |    387 |      226 |
| year-2010 |    260 |      202 |
| year-2009 |    328 |      237 |
| year-2008 |    223 |      170 |
| year-2007 |    273 |      212 |
| year-2006 |    240 |      201 |
| year-2005 |    372 |      235 |
| year-2004 |    254 |      190 |

These were not padded with songs from other years, because Era mode uses the year as its answer.
