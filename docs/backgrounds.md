# Curated Backgrounds

Darkflow includes a fixed catalog of workspace backgrounds. Players choose a
background from **Settings > Appearance > Background**. There is no file upload,
remote URL, delete, or custom-background management surface.

## Included Presets

| Key | Label |
| --- | --- |
| `none` | None |
| `twilight-citadel` | Twilight Citadel |
| `moonlit-forest` | Moonlit Forest |
| `deep-halls` | The Deep Halls |
| `storm-coast` | Storm Coast |
| `neon-city` | Neon City |
| `arcane-observatory` | Arcane Observatory |
| `berserker-hold` | Berserker Hold |
| `outback-night` | Outback Night |

New installations start with `twilight-citadel`. Existing settings written
before background support migrate to `none`, preserving the prior solid-color
appearance.

The selected key is stored with the rest of `darkwind-client-settings`, so it
survives browser reloads and Electron restarts and is included in the existing
settings export. Unknown or retired keys fall back to `none`.

## Rendering

The decorative `#app-background` layer sits behind the workspace. Each preset
defines its own position, dimming level, and terminal backdrop opacity.
Backgrounds do not alter terminal foreground colors, ANSI background colors, or
theme variables.

Every bundled image is a horizontally seamless 1792 by 960 tile. Darkflow
renders it with:

```css
background-repeat: repeat-x;
background-size: auto 100%;
```

The image therefore fills the available workspace height and repeats only along
the horizontal axis. This avoids stretching on 21:9 and 32:9 monitors. Presets
are checked as repeated composites before they are accepted into the catalog.

## Adding A Preset

1. Add a horizontally seamless 1792 by 960 JPEG to
   `public/assets/backgrounds/`.
2. Add a 336 by 180 thumbnail to `public/assets/backgrounds/thumbs/`.
3. Add the preset metadata to `public/js/background-manager.js`.
4. Confirm the repeated seam at 16:9, 21:9, and 32:9 viewport widths.
5. Run `npm test`; the background tests validate catalog uniqueness, asset
   dimensions, and the horizontal-repeat CSS contract.
