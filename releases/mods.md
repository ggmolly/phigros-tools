---
date: 2026-11-21
phigrospp: 0.1.0-beta.14
---
# Install mods from the settings

The settings have a Mods tab: the mods players published, each with what it shows and what it does, installed and
updated with one tap.

![](cover.svg)

## The catalog

![](mods.webp)

- Every mod of the [catalog](/mods) is listed with its author, version and size.
- A switch turns an installed mod on or off, and **Update all** brings the new releases in.
- **Install from GitHub** installs any other mod from the link of its repository, behind a warning.

## A page for each mod

![](mod-page.webp)

- A mod's page shows its clip and its README, with links you can tap.
- Each release is signed by its author, and the game checks the signature before installing it.
- A mod with settings gets a tab of its own next to the game's.

Writing one takes a few lines of Lua: the [wiki](https://github.com/ggmolly/PhigrosPlusPlus/wiki) says how.
