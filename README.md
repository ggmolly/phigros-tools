# phigros.tools

Analyze your Phigros save (ranking score, Best charts, records, progress) privately in your browser, and browse every chart's difficulty constant.

![Overview](docs/screenshots/02-overview.png)

## Features

### Import a save

Connect an Android phone over USB, paste a session token, or open a ZIP/JSON save file.

![Start page with the three import methods](docs/screenshots/01-start.png)

### Overview

Your RKS, played / Full Combo / All Perfect counts per difficulty, Challenge Mode rank, Data and self-intro, and your Best 27 + 3 Phi slots. Pick a chart and drag its target accuracy to see how it would move your ranking score; **Next Target** lists the charts closest to raising it.

![Best chart detail with the accuracy simulator and next targets](docs/screenshots/03-simulator.png)

The background fog takes on the colours of the selected song's cover.

![Overview tinted with the selected song's colours](docs/screenshots/07-song-colours.png)

### Share card

A summary image of your RKS, counts and best charts, to download as PNG or copy.

![Share card dialog](docs/screenshots/08-share-dialog.png)

### Records

Every chart you've played, searchable, filterable by difficulty and clear status (not FC, FC but not φ, φ), and sortable, including by how much an All Perfect would raise your RKS.

![Chart records table filtered to IN](docs/screenshots/04-records.png)

### Collection

Cleared, Full Combo and Phi progress per difficulty, plus the charts you haven't played yet.

![Collection completion per difficulty](docs/screenshots/05-collection.png)

### History

Save snapshots (stored in your browser) to chart your RKS over time and see what changed since the last one.

![RKS history, changes since the last snapshot, and saved snapshots](docs/screenshots/06-history.png)

### Charts

The full chart list with difficulty constants, filterable by title, artist, illustrator, chapter and difficulty. No save needed.

![Chart list filtered by artist](docs/screenshots/10-charts-artist-filter.png)

Each song has its own page with your records on it when a save is loaded, charters, per-difficulty chart stats (note counts, density, BPM, scroll speed, judge lines…) and related songs.

<img src="docs/screenshots/11-chart-page.png" alt="Song page with chart stats" width="600">

Screenshots use a fictional demo save; regenerate them with `scripts/screenshots.ts` (see its header).

## Develop

```sh
bun install
bun run dev
```

Production: `bun run build && bun run start`.

## Data

Songs, constants, charters, chapters, covers and chart stats all come from the game's APK. To refresh after a game update:

```sh
cd ../extract && .venv/bin/python export_game_info.py   # song database -> game_info.json
cd ../web && bun scripts/build-catalog.ts ../extract/game_info.json
```

The export reads the APKs' `assets/bin/Data` unzipped into `../extract/game_data/` (see the script's header). The other `scripts/build-*.ts` regenerate chart stats, covers, avatars, palettes, accent colours and the sitemap; each file's header says what it reads.

## Credits

Saira font under the OFL, see `LICENSES/`.

Unofficial third-party tool · Not affiliated with Pigeon Games.
