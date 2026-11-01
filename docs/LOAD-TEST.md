# Event load test

Run with `apps/server/src/scripts/loadtest-event.ts`. One server process and the clients on one machine, Deezer stubbed, local Postgres. These are capacity numbers for one process, not a claim about a real venue's network.

| Scenario | Result at 1,000 simulated players |
| --- | --- |
| A lobby | 1000/1000 connected in 1.8s, join p95 187ms, RSS 199 MB |
| B game | 4000 answers, 0 errors; answer handling p95 0.11ms; client round trip p95 8.9ms; round start fan-out p95 45ms |
| C host only | 0 audio urls and 0 host frames reached players; host not seated |
| D everyone plays | One start instant per round; 88 reconnects restored; 100 late joiners got the current round; dead song skipped |
| E Deezer | 1000 identical searches cost 1 call; breaker opened in an outage, 0 calls while open; game finished; server healthy |
| F sustained | Not yet recorded here: no memory-leak verdict |
