# Shared Music in Darkflow

## Summary
Darkflow already supports browser playback through `Darkwind.Sound`. The practical way to share music in-game is not raw audio streaming, but a shared playback layer that sends track events to the relevant Darkflow clients. The first version should use pre-hosted MP3 tracks, with room-local and global broadcast scopes.

## Key Changes
- Add a dedicated `music` sound category so players can mute music separately from ambient effects.
- Introduce a shared music controller on the mudlib side that can start, stop, and replace music by scope:
  - room-local playback for players in the same room
  - global playback for all connected Darkflow players
- Reuse the existing `Darkwind.Sound` GMCP path instead of inventing a separate transport.
- Keep playback metadata explicit so clients can replace or stop the active track cleanly.
- Default to asset-backed MP3s under `public/assets/sounds/`; treat live stream URLs as a later extension, not the first implementation.
- Preserve existing audio unlock, mute, volume, and category filtering behavior.

## Test Plan
- Verify Darkflow advertises the new `music` category.
- Start a room-local track and confirm only players in that room hear it.
- Move a player out of the room and confirm the old track is replaced or stopped.
- Trigger a global music event and confirm all connected Darkflow clients with sound enabled receive it.
- Confirm players who mute the music category do not hear it while other sound categories still work.
- Confirm non-Darkflow or legacy clients are unaffected.

## Assumptions
- “Shared music” means coordinated browser playback, not raw byte streaming.
- Pre-hosted MP3 playback is the correct first step because it fits the current sound system.
- A dedicated `music` category is preferable to overloading `ambient`.
- Live stream support can be added later if needed, but it should not block the initial shared-music path.
