# POS Planner

## Release

- Version: `1.0.0`
- Release Date: `March 8, 2026`

## Site Information

- Name: `POS Planner`
- Purpose: `EVE Online control tower planner`
- Scope: build, review, and share control tower fits for EVE Online starbases

## Core Features

- Control tower fitting by tower type and faction variant
- Module library grouped into:
  - `Defense`
  - `ECM`
  - `EWAR`
  - `Shield Hardening`
  - `Production`
  - `Services`
  - `Deprecated`
  - `Partially Deprecated`
- Shield hardener resist calculations
- Layer and balanced EHP calculations
- Damage profile by damage type
- Powergrid, CPU, fuel per hour, and sovereignty bonus tracking
- Shareable fit text output
- Local module icon support
- Module descriptions with status/info popups

## Data and Build

- Module and tower data are stored in:
  - `public/data/modules.json`
  - `public/data/towers.json`
  - `public/data/game-data.js`
- Module descriptions and icon metadata are populated through:
  - `scripts/Update-PosEsiDescriptions.ps1`
- Build command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

## Assets

- Site font, logo, and background image are stored under `public`
- Module icons are stored locally under `public/images/modules`

## Header Links

- `Blacktail Tools`: https://blacktailtools.space/
- `Get 1m SP`: https://www.eveonline.com/signup?invc=b558b66f-b89e-4f14-a2a3-ae4f64510d85
- `EVE Game Codes`: https://store.markeedragon.com/affiliate.php?id=1191&redirect=index.php?cat=4
- `Support`: https://discord.gg/6tuWzarK74

## Footer Links

- `Blacktail Tools`: https://blacktailtools.space/
- `Fading Lotus`: https://zkillboard.com/character/2123030234/
- `EVE Related Materials`: https://support.eveonline.com/hc/en-us/articles/8563917741084-EVE-Online-Content-Creation-Terms-of-Use
- `CCP Games`: https://www.ccpgames.com/

## Ownership and Credits

- Created by: `Fading Lotus`
- Corp: `Blacktail Syndicate`
- Alliance: `Brotherhood of Spacers`

## Notice

- All EVE related materials are property of CCP Games.
