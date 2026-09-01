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

Caveats:

- Lobby state lives in memory. If Vercel scales to more than one instance,
  players can land in different lobbies. Fine for small groups; use an
  external store for larger ones.
- Each WebSocket connection is capped by the function max duration (300 s on
  Hobby, up to 800 s on Pro). The client auto-reconnects afterwards, which
  drops a racer mid-race if it happens during a race.
- Instances scale to zero after 5 minutes without traffic, so the first visit
  after idle takes a cold start.

You get a random call sign like `Turbo-482`; type your own name in the
**RACING AS** box next to JOIN RACE (up to 14 characters, remembered for next
time). Names can be changed freely in the lobby, even after joining, and lock
in the moment the countdown starts. Every rival's car carries a floating label
with their name and, once the race is on, their current place (`1st`, `2nd`,
…). Your own car never shows a label; your place is in the panel top right.

## Controls

| Key | Action |
|-----|--------|
| `←` `→` (or `A`) | Steer — the car accelerates by itself once the race starts |
| `W` (or `Shift`, `↑`) | Boost — drains the boost meter, which refills over time and faster while drifting |
| `S` (or `↓`) | Brake / stop, hold at a standstill to reverse |
| `D` (or `Space`) | Drift — hold while steering; a long drift releases a mini-turbo |
| `R` | Rescue: snap back onto the track if you get stuck |
| `C` | Cycle camera: chase, far chase, bonnet |
| `M` | Mute / unmute |

Leaving the asphalt slows you down hard (grass and gravel have heavy drag and a
low speed cap), the rumble strips cost a little speed, and the steel barriers
bounce you off and bleed speed on impact.

## Race format

| Phase       | Duration            | What happens |
|-------------|---------------------|--------------|
| `lobby`     | until someone joins, then 30 s | JOIN RACE is live, cars park on the grid, spectators orbit the track |
| `countdown` | 4 s                 | Grid locked, gantry lights, 3-2-1-GO |
| `racing`    | 2 laps              | First across the line starts a **30 s** finish window for everyone else |
| `finished`  | 10 s                | Results board (DNF for anyone who ran out of time) |

After the results everyone who actually drove is put straight back on the grid
for the next race on the next circuit (four circuits rotate). Racers who never
moved (disconnected keyboard, tabbed away) are dropped to spectator so an idle
car never blocks the lobby. A 300 s hard cap ends a race even if nobody finishes.

## Graphics presets

The selector in the top right switches between **Ultra** (2x pixel ratio, 4K
shadow map, GTAO ambient occlusion, bloom, dense forests and grass), **High**
and **Medium**. Ultra is the default; if the average frame rate drops under
~27 fps the game steps down to High once and remembers the choice.

## Tuning knobs (env vars)

`PORT`, `LOBBY_SEC`, `COUNTDOWN_SEC`, `RESULTS_SEC`, `GRACE_SEC`,
`HARD_CAP_SEC`. Laps, player cap and track width live in `shared/track.js`.

## Test

```sh
npm test           # spins up a server on :8799 and runs the lobby/race/timeout smoke test
```

## Layout

- `server.js` — static files + WebSocket lobby/race state machine (20 Hz snapshots)
- `shared/track.js` — circuit definitions, centreline resampling, elevation profile, grid slots
- `public/main.js` — game loop, car physics, networking, chase camera, HUD, minimap, post-processing
- `public/world.js` — terrain, track ribbon, curbs, barriers, ponds, forests, grandstand, sky, props
- `public/car.js` — procedural car model with wheels, lights, spoiler and boost flames
- `public/textures.js` — procedural canvas textures; `public/audio.js` — synthesised engine and effects
