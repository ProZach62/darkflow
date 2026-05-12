Sound Files for Darkflow
========================

This directory contains .mp3 sound files for the client sound system.

Sound Resolution
----------------
When playing a sound, the system resolves the file path in this order:

1. Predefined sounds - Check the built-in sound map
   play_sound(player, "combat", "hit")  ->  assets/sounds/combat-hit.mp3

2. Explicit .mp3 filename - Use directly
   play_sound(player, "combat", "custom.mp3")  ->  assets/sounds/custom.mp3

3. Path-style - Treat as subdirectory path
   play_sound(player, "spell", "fire/explosion")  ->  assets/sounds/fire/explosion.mp3

4. Default pattern - Combine category and sound name
   play_sound(player, "combat", "slash")  ->  assets/sounds/combat-slash.mp3

The category parameter controls:
- Which indicator icon is shown in the UI
- Which toggle enables/disables the sound

File Naming Convention
----------------------
Predefined files should be named as: category-sound.mp3
Custom files can use any naming convention.

Predefined Sound Files
----------------------

Combat Sounds:
  combat-hit.mp3           - Combat hit sound
  combat-miss.mp3          - Combat miss sound
  combat-critical.mp3      - Critical hit sound
  combat-block.mp3         - Block sound
  combat-parry.mp3         - Parry sound

Spell Sounds:
  spell-cast.mp3           - Generic spell cast
  spell-fire.mp3           - Fire spell
  spell-ice.mp3            - Ice spell
  spell-lightning.mp3      - Lightning spell
  spell-heal.mp3           - Healing spell
  spell-buff.mp3           - Buff spell

Skill Sounds:
  skill-use.mp3            - Generic skill use
  skill-success.mp3        - Skill success
  skill-fail.mp3           - Skill failure
  bard/harp_C4.mp3         - Bard lute note C4
  bard/harp_D4.mp3         - Bard lute note D4
  bard/harp_E4.mp3         - Bard lute note E4
  bard/harp_F4.mp3         - Bard lute note F4
  bard/harp_G4.mp3         - Bard lute note G4
  bard/harp_A4.mp3         - Bard lute note A4
  bard/harp_B4.mp3         - Bard lute note B4
  bard/harp_C5.mp3         - Bard lute note C5
  bard/harp_D5.mp3         - Bard lute note D5
  bard/harp_E5.mp3         - Bard lute note E5
  bard/harp_F5.mp3         - Bard lute note F5
  bard/harp_G5.mp3         - Bard lute note G5
  bard/harp_A5.mp3         - Bard lute note A5
  bard/harp_B5.mp3         - Bard lute note B5
  bard/harp_C6.mp3         - Bard lute note C6

Potion Sounds:
  potion-drink.mp3         - Drinking potion
  potion-heal.mp3          - Health potion
  potion-mana.mp3          - Mana potion

Quest Sounds:
  quest-accept.mp3         - Quest accepted
  quest-complete.mp3       - Quest completed
  quest-update.mp3         - Quest objective updated

Celebration Sounds:
  celebration-levelup.mp3  - Level up fanfare
  celebration-achievement.mp3 - Achievement unlocked

Discussion Sounds:
  discussion-tell.mp3      - Private message received
  discussion-tell.mp3      - Nearby speech fallback
  discussion-tell.mp3      - Channel message fallback

Alert Sounds:
  alert-low-hp.mp3         - Low health warning
  alert-incoming.mp3       - Incoming attack warning
  alert-warning.mp3        - General warning

Ambient Sounds:
  ambient-rain.mp3         - Rain loop
  ambient-fire.mp3         - Crackling fire loop
  ambient-wind.mp3         - Wind loop
  ambient-combat-music.mp3 - Combat music loop

UI Sounds:
  ui-click.mp3             - Button click
  ui-open.mp3              - Menu open
  ui-close.mp3             - Menu close

Custom Sounds
-------------
You can add custom sounds anywhere in this directory:

  assets/sounds/
    bosses/
      dragon-roar.mp3
      lich-laugh.mp3
    areas/
      tavern-music.mp3
      forest-ambience.mp3

Then play them with any category indicator:
  play_sound(player, "alert", "bosses/dragon-roar")
  loop_sound(player, "ambient", "areas/tavern-music.mp3", "room-music")

Notes
-----
- Sound files should be reasonably small (under 500KB recommended)
- Looping sounds (ambient) should be seamless loops
- Missing sound files will be silently ignored
- Volume can be controlled per-category in the sound panel
