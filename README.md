# Vibe Racing — chase-cam 3D karts

Multiplayer browser racing with the camera behind your car. Up to **14 players**
join a lobby, a **30-second countdown** starts when the first racer clicks
**JOIN RACE**, the lights go out and everyone races **two laps** around a hilly
3D circuit with trees, ponds, rocks, grandstands, barriers and a finish gantry.

Rendering is three.js (PBR materials, soft shadows, physically based sky with
an environment map, ambient occlusion and bloom on the Ultra preset). No image
assets are needed: every texture is generated procedurally at load time.

## Run

```sh
npm install
npm start          # http://localhost:8765
```

Open the URL in one or more browser windows; each tab is a racer. Set `PORT` to
run on another port. Chrome, Edge, Safari 17+ and Firefox with WebGL2 work.

## Deploy to Vercel (Docker)

`Dockerfile.vercel` runs the whole game (static files + WebSocket server) as
one container function listening on `$PORT`. `vercel.json` declares the whole
repo as a single container service built from `Dockerfile.vercel` and routes
every path to it, so Vercel does not fall back to serving `public/` as a static
site. Connect the repo in Vercel and deploy. With Docker installed, `vercel dev`
runs the same container locally, or build and run it by hand:

```sh
docker build -f Dockerfile.vercel -t vibe-racing . && docker run --rm -p 8765:80 vibe-racing
```

### One race for everyone: add Redis

Vercel scales container functions to several instances and offers no way to
pin it to one. Without shared state each instance would run its own lobby and
players would land in different races. The rule of the game is that there is
exactly one race in the world: whoever arrives while it runs spectates and
joins the next lobby. To get that across instances, give the deployment a
Redis:

1. In the Vercel project open **Storage → Marketplace** and add a Redis
   (Upstash Redis or Redis Cloud both work; any Redis 6+ reachable over
   `redis://` / `rediss://` does).
2. Make sure the project has the connection string as **`REDIS_URL`** in its
   environment variables (rename the marketplace's variable if it uses a
   different name, e.g. `KV_URL`).
3. Redeploy.

With `REDIS_URL` set, every instance connected to that Redis presents the same
lobby and race (`coord.js`): one instance holds a 3 s leader lease and runs
the race exactly as the single-process server does; the others relay their
players' messages to it and its snapshots back over pub/sub. If the leader is
scaled down or dies, another instance takes over within about 0.5 s (clean
shutdown) or 3.5 s (crash), restoring the phase, timers, track and grid from
Redis; only the players who were connected to the dead instance drop out, and
they reconnect as spectators. Without `REDIS_URL` the server is exactly what it
was: one in-memory lobby per process, which on Vercel means one lobby per
instance.

Redis traffic is small and predictable, which matters for per-command
pricing: the leader issues about 3 commands/s on its own (lease refresh
twice a second, state write once a second), plus 20 publishes/s (one per
snapshot) while at least one other instance is alive. Each other instance
issues about 6 commands/s (lease poll, leader lookup and presence beat twice a
second) plus at most 20 publishes/s of batched player messages while its
players are driving, and 3 commands per new connection. Two busy instances
therefore stay under ~50 commands/s; an idle single instance under ~4.

Caveats:

- Each WebSocket connection is capped by the function max duration (300 s on
  Hobby, up to 800 s on Pro). The client auto-reconnects afterwards, which
  drops a racer mid-race if it happens during a race.
- Instances scale to zero after 5 minutes without traffic, so the first visit
  after idle takes a cold start.
- If Redis becomes unreachable the race pauses (nobody can hold the lease)
  rather than splitting into per-instance lobbies; it resumes when Redis is
  back. Messages sent during a leader change are dropped, not queued.

You get a random call sign like `Turbo-482`; type your own name in the
**RACING AS** box next to JOIN RACE (up to 14 characters, remembered for next
time). Names can be changed freely in the lobby, even after joining, and lock
in the moment the countdown starts. Every rival's car carries a floating label
with their name and, once the race is on, their current place (`1st`, `2nd`,
…). Your own car never shows a label; your place is in the panel top right.

The join panel also lets you pick a car: one of four body styles (**Racer**,
**Muscle**, **Buggy**, **Van**) and one of 14 paint colours. The choice is
remembered for next time, can be changed freely in the lobby, even after
joining, and locks in the moment the countdown starts; everyone sees each
racer in the style and colour they picked. Colours are not exclusive, so two
racers can share one.

## Controls

| Key | Action |
|-----|--------|
| `←` `→` (or `A` `D`) | Steer — the car accelerates by itself once the race starts |
| `W` (or `Shift`, `↑`) | Boost — drains the boost meter, which refills over time and faster while drifting |
| `S` (or `↓`) | Brake / stop, hold at a standstill to reverse |
| `Space` | Drift — hold while steering; a long drift releases a mini-turbo |
| `R` | Rescue: snap back onto the track if you get stuck |
| `C` | Cycle camera: chase, far chase, bonnet |
| `M` | Mute / unmute |

Leaving the asphalt slows you down hard (grass and gravel have heavy drag and a
low speed cap), the rumble strips cost a little speed, and the steel barriers
bounce you off and bleed speed on impact.

## Race format

| Phase       | Duration            | What happens |
|-------------|---------------------|--------------|
| `lobby`     | until someone joins, then 30 s | JOIN RACE is live, cars park on the grid, spectators orbit the track. Everyone (racers and spectators) can **vote for the next map** in the PICK A MAP panel; the vote closes 8 s before the countdown, most votes wins, ties are random, no votes keeps the rotation's pick |
| `countdown` | 4 s                 | Grid locked, gantry lights, 3-2-1-GO |
| `racing`    | 2 laps              | First across the line starts a **30 s** finish window for everyone else |
| `finished`  | 10 s                | Results board (DNF for anyone who ran out of time) |

After the results everyone who actually drove is put straight back on the grid
for the next race on the next circuit (the circuits rotate unless a lobby vote
picks a different one). Racers who never
moved (disconnected keyboard, tabbed away) are dropped to spectator so an idle
car never blocks the lobby. A 300 s hard cap ends a race even if nobody finishes.

## Graphics presets

The selector in the top right switches between **Ultra** (2x pixel ratio, 4K
shadow map, GTAO ambient occlusion, bloom, dense forests and grass), **High**
and **Medium**. Ultra is the default; if the average frame rate drops under
~27 fps the game steps down to High once and remembers the choice.

## Tuning knobs (env vars)

`PORT`, `LOBBY_SEC`, `COUNTDOWN_SEC`, `RESULTS_SEC`, `GRACE_SEC`,
`HARD_CAP_SEC`, `REDIS_URL` (shared lobby across instances, see above),
`INSTANCE_ID` (label for this instance in logs and the leader lease; random by
default). Laps, player cap and track width live in `shared/track.js`.

## Test

```sh
npm test           # spins up a server on :8799 and runs the lobby/race/timeout smoke test
npm run test:shared # needs Docker: starts redis:7-alpine on :6399, two servers on :8801/:8802,
                    # checks they share one race, then kills the leader and checks the takeover
```

## Layout

- `server.js` — static files + WebSocket lobby/race state machine (20 Hz snapshots)
- `coord.js` — leader lease, state hand-off and pub/sub relays over Redis when `REDIS_URL` is set
- `shared/track.js` — circuit definitions, centreline resampling, elevation profile, grid slots
- `public/main.js` — game loop, car physics, networking, chase camera, HUD, minimap, post-processing
- `public/world.js` — terrain, track ribbon, curbs, barriers, ponds, forests, grandstand, sky, props
- `public/car.js` — procedural car model with wheels, lights, spoiler and boost flames
- `public/textures.js` — procedural canvas textures; `public/audio.js` — synthesised engine and effects
