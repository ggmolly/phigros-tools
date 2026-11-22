# phigros.tools

![phigros.tools, a save analyzer, chart player and leaderboard for Phigros](docs/banner.webp)

Analyze your Phigros save (ranking score, Best charts, records, progress) privately in your browser, and browse every chart's difficulty constant.

![Overview](docs/screenshots/02-overview.png)

## Features

### Import a save

Sign in from [Phigros++](../mod) to open the save it uploads: the game shows a code to type here (or opens the site
already signed in), or type the profile's 16-word recovery phrase. The browser makes its own key for the profile,
listed in **Devices** with every phone signed in, each removable. A ZIP or JSON save file opens too. The main menu
remembers every player you've opened before, laid out as a carousel like the game's own.

A save that only lives in this browser can be sent to Phigros++, which offers to load it at its next start.

A save that only lives in the game has no way out without root, so **Bring Your Save Over** (`/start`) asks where it
is and says what works there. Without root the save is rebuilt by hand (`/rebuild`): the scores as the game shows them
with the RKS they make, the profile, and what was unlocked, never Data. The browser then makes the profile and its 16
words, and Phigros++ loads the save once signed in to it. Typed scores are **Declared**: listed on the player's page
and counted nowhere until a play from the game matches or beats them.

![Main menu carousel with the import options open](docs/screenshots/01-start.png)

### Overview

Your RKS, played / Full Combo / All Perfect counts per difficulty, Challenge Mode rank, Data and self-intro, and your Best 27 + 3 Phi slots. Pick a chart and drag its target accuracy to see how it would move your ranking score; **Next Target** lists the charts closest to raising it.

![Best chart detail with the accuracy simulator and next targets](docs/screenshots/03-simulator.png)

The background fog takes on the colours of the selected song's cover.

![Overview tinted with the selected song's colours](docs/screenshots/07-song-colours.png)

### Records

Every chart you've played, searchable, filterable by difficulty and clear status (not FC, FC but not φ, φ), and sortable, including by how much an All Perfect would raise your RKS.

![Chart records table filtered to IN](docs/screenshots/04-records.png)

### Charts

The full chart list with difficulty constants, filterable by title, artist, illustrator, chapter and difficulty. No save needed.

![Chart list filtered by artist](docs/screenshots/10-charts-artist-filter.png)

Each song has its own page with your records on it when a save is loaded, charters, per-difficulty chart stats (note counts, density, BPM, scroll speed, judge lines…) and related songs.

<img src="docs/screenshots/11-chart-page.png" alt="Song page with chart stats" width="600">

### Play a chart

Watch any chart play out right in the browser from its **Preview** link, no save needed: adjustable speed and hitsound volume, and an optional local audio file to sync against. Share a link to a specific moment and it opens right there.

![A dense IN chart mid-playback, with judge lines, combo and score](docs/screenshots/12-play.png)

### Leaderboard

Players who sync from the game with [Phigros++](../mod) are ranked by RKS, and every chart has its own ranking, counting
all plays or verified replays only. A player's page is their profile: global rank, play count and time, notes hit,
accuracy, RKS history, top plays (with what each adds to their RKS), the ranks their new bests took, and recent plays,
with a **Watch** link on each verified one: the chart plays back with their fingers and their real judgements, score and
combo.

Records the game declares are marked **Imported**. An uploaded replay counts once the worker has judged it with a port
of the game's judgement (`src/judge.ts`) and its touches give the result the game recorded: it's then **Verified**, and
replaces an imported record of the same score, so a player can prove their records by playing them again. A replay that
gives another result doesn't count.

A song played with Phigros++'s modifiers (Easy, Hard Rock, Half Time, Nightcore, Hidden, Flashlight, Sudden Death,
Perfect, Random) is no record of the game's, so its replay only counts on the chart's **Modifiers** ranking: a row for
a player's best with each set of modifiers, by the total they give the score (up to 1,409,444). `src/modifiers.ts` holds their rules, the same as the game's:
the worker judges such a replay with them, and the player shows it at its speed, with its drums, shuffled notes and
hidden ones.

Links to a player or a replay show a preview on Discord and other apps, coloured like the song's cover: the player's
card (their RKS, counts and best charts), or the replay's (score, rank, accuracy and judgements), both drawn by
`server/card.tsx`.

### Rooms

[Phigros++](../mod) plays multiplayer rooms through the site: everyone in a room plays the chart its host picks at the
same time, over one WebSocket per game (`server/rooms.ts`, which documents the protocol). **Rooms** lists the open
ones live, and a room's page shows its players (the host wears a crown), the chart they're on and everyone's score
while a match is played, with a link that opens the game in the room (`phigrospp://room/<id>`). Under it, the room's
recap: the standings over its matches, then every match with its players ranked. The recap stays once the room is
closed.

A room with a password shows its name and how many players are in it, nothing else: its matches aren't kept. Chat
only goes from the game to the games of the same room, the site never sees it.

Links to a room show a preview drawn by `server/card.tsx` like the others: the room's name over the ranking of its
latest match, on that chart's cover.

Screenshots use a fictional demo save; regenerate them with `scripts/screenshots.ts` (see its header).

## Develop

```sh
bun install
bun run dev
```

Production: `bun run build && bun run start`, with the replay worker beside it: `bun .output/worker.mjs`. They share
`data/` and a RabbitMQ queue (`AMQP_URL`, `amqp://localhost` by default), and the worker reads charts from
`CHART_DIR` (`./public/chart-data`).

## Data

Songs, constants, charters, chapters, covers and chart stats all come from the game's APK. To refresh after a game update:

```sh
cd ../extract && .venv/bin/python export_game_info.py   # song database -> game_info.json
cd ../web && bun scripts/build-catalog.ts ../extract/game_info.json
```

The export reads the APKs' `assets/bin/Data` unzipped into `../extract/game_data/` (see the script's header). The other `scripts/build-*.ts` regenerate chart stats, covers, avatars, share-card fonts, palettes, accent colours and the sitemap; each file's header says what it reads.

## Credits

Saira, Noto Sans SC and Noto Sans Armenian fonts under the OFL, DejaVu Sans under its own license, see `LICENSES/`. The player cards use subsets of all four.

Unofficial third-party tool · Not affiliated with Pigeon Games.
