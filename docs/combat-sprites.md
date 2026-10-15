# Combat Sprite Sheets

The visual Combat pane draws each fighter as a body plus overlays. The body
comes from a sprite sheet when one is shipped for the figure kind, and from
the procedural rig in `combat-rig-core.mjs` otherwise. Generated transparent
paintings in `public/assets/sprites/weapons/` supply sword, axe, hammer,
shield, spear, great sword, great axe, and maul overlays. Their grip metadata
lives in `combat-weapon-sprites.mjs`; the original vector silhouettes remain
as loading and error fallbacks. Cloak and portrait-head overlays also draw
when enabled by the sheet. Helmet equipment remains in the profile, but the
Scene does not draw a separate helmet cap over the character's head.

Sheets live in `public/assets/sprites/` as a PNG plus a manifest with the
same base name. A missing or invalid sheet costs one request and falls back
to the next candidate, and finally to the rig.

## Lookup order

Every fighter, including targets and observed participants, uses its own
public `appearance` when supplied. An explicit empty object is authoritative
redaction: it selects only generic body art, never name or private-data guesses.
Without public appearance, recipient-private race and character sheets remain
available only for the recipient's own fighter in their own fight.

Public creature races select shared art before the body-kind fallback:
Wolf uses `wolf`; rat/rodent/mouse use `enemies/rat`; bat uses `enemies/bat`;
bear uses `enemies/bear`; golem uses `enemies/golem`;
boar/wild-boar use `enemies/boar`; snake/serpent use `enemies/serpent`;
crab/giant-crab use `enemies/crab`; crocodile/alligator use `enemies/crocodile`;
dragon/drake/wyvern/wyrm use `enemies/drake`;
spider/arachnid/scorpion use `enemies/spider`; skeleton/zombie/undead/ghoul/
wight/lich use `enemies/undead`; troll/ogre/giant use `enemies/troll`.
Goblin, kobold, minotaur, and gargoyle each use their own `enemies/<race>` sheet.
Wolf, rat, bat, bear, boar, serpent, crab, crocodile, drake, and spider profiles
use beast geometry, while golem, undead, troll, goblin, kobold, minotaur, and
gargoyle profiles use humanoid geometry. An explicit form outranks these race defaults;
an incompatible or unknown form does not reuse the creature sheet. Other
unknown races use the explicit public family, when supplied, then generic art.

Garou's quadruped Wolf form uses gender-neutral art and suppresses stale
humanoid equipment. Crinos and Ursavar keep their humanoid sheets. Playable
Dragon's public `race: "dragon", family: "dragon"` retains the Arthok-family
humanoid fallback unless an explicit form overrides it; an NPC dragon without
that family uses drake art.
Ice Ogre's public `race: "ice ogre", family: "ogre"` keeps its race-specific
humanoid sheet instead of the generic Ogre family's troll art. Ordinary Ogre
NPCs still use `enemies/troll`. Swamp Troll similarly keeps its humanoid
Arthok art fallback rather than the generic Troll family's NPC sheet.

For humanoid forms the stage tries, most specific first:

1. `characters/<name>` only for the legacy recipient case above. The name is
   lowercased with non-alphanumeric runs replaced by `-` (`characters/grash-ironjaw`).
2. `<gender>-<race>`, slugged the same way (`male-scro`). Female uses female
   art; absent or unspecified gender uses male art as a visual default only,
   without adding a gender to the public snapshot.
3. Dedicated gender-neutral `<race>` art when registered in
   `NEUTRAL_RACE_SPRITES`. This uses the same body sheet for every gender,
   without adding or changing the actor's public gender.
4. `<gender>-<shared>` from the race's curated `SPRITE_RACE_FAMILIES` entry.
   A race's intended artwork family precedes its broader biological family:
   Gnomes can fall back to Dwarf, Ice Gnoll and Crinos to Ursavar, Thraxian
   to Scro, and Swamp Troll and Yugoloth to Arthok.
5. `<gender>-<family>` from the explicit public family. If the race has no
   curated entry, a curated entry for that public family is tried first.
   Unknown races can still borrow public family art; absent hints do not
   permit private identity guesses.
6. The body kind, `humanoid` or `beast`. Duplicate candidates are removed.

Only legacy NPC targets without public appearance match their display name:
drake/dragon, spider/arachnid, rat/rodent/mouse, bat, bear, golem,
skeleton/undead, troll/ogre, goblin, kobold, minotaur, gargoyle, boar,
snake/serpent, crab, or crocodile/alligator.
Specific species precede broad legacy
matches such as "giant", so a giant rat is not drawn as a troll. Unmatched NPCs
use `beast`. Observed fighters without public appearance get only generic art.
Every candidate is requested, so a more specific sheet that finishes loading later takes over
on the next frame. A character, race, or enemy sheet must still declare
`kind` as `humanoid` or `beast`.

### Wolf artwork

`wolf.png` is a transparent 1536 x 1536 sheet of a charcoal/silver quadruped
wolf, using the existing painterly Ursavar art as a style reference. The
gender-neutral `wolf.json` uses nine 512-pixel cells, 128 pixels per body unit,
and ground anchor (200, 464). Row order is idle/windup/maul,
whiff/recoil/dodge, and guard/cast/look. The cast pose is a howl; look is an
alert standing pose. Unpainted poses, including walking, fall back to idle.

The transparent generated figures were extracted as whole alpha-connected
components rather than fixed grid crops, then normalized with one shared
scale and grounded before assembly. This preserves paws, ears, and tails
that cross a source cell boundary. The sheet owns its complete head, claws,
and tail (`weaponsInArt: true`, `portrait: false`, `secondary: false`).

### Additional enemy artwork

Rat, bat, bear, boar, serpent, giant crab, crocodile, and stone golem use the
same transparent nine-pose layout as Wolf: idle/windup/maul,
whiff/recoil/dodge, and guard/cast/look. Each sheet is
1536 x 1536 with 512-pixel frames, unit 128, and ground anchor (200, 464).
They use Wolf's painted style, whole-silhouette alpha extraction, one shared
scale per species, and the repository's frame assembler. Cast is a natural
squeal/shriek/roar or golem gesture, without baked spell effects.

Boar charges with its tusks; serpent lunges from a coil; giant crab snaps
its pincers; crocodile lunges with open jaws. Their cast poses are natural
threat displays. Snake shares serpent art and alligator shares crocodile art;
broad reptile or crustacean families do not imply either specific species.

The sheets own their complete heads and natural attacks, with no procedural
weapon, portrait, or secondary tail/cloak overlays. Bear is a natural
quadruped, not the humanoid Ursavar sheet. Golem is an unarmed stone construct.
Broad races such as reptile, elemental, and plant are intentionally not mapped
to these species; neither is a redacted appearance inferred from its name.

Goblin, kobold, minotaur, and gargoyle add unarmed humanoid bodies under
`enemies/`, using the Crinos sheet as the painterly style reference. Goblin is
green and ragged; kobold is a small rust-scaled reptilian; minotaur is a brown
bull-headed humanoid; gargoyle is gray stone with folded wings and a tail.
These are shared race silhouettes, not portraits of individual named NPCs.
Each transparent 1536 x 1536 sheet paints idle/windup/strike,
whiff/recoil/dodge, and guard/cast/look. Attack aliases cover maul, thrust,
chop, and loose, with draw/raise reusing windup. Whole-silhouette alpha
extraction, one shared scale per species, and pelvis/ground alignment keep
horns, tails, wings, and crouches intact. Hand-placed head, neck, hand, and
off-hand elbow anchors support runtime weapons and shields (`weaponsInArt: false`);
the art owns its head, clothing, wings, and tail (`portrait: false`,
`secondary: false`). Public race/family hints select these sheets, but broad
labels such as reptile or construct do not. Explicit forms and appearance
redaction retain priority, and existing player-race sheets are unchanged.

### Additional player-race artwork

Ten dedicated gender-neutral humanoid sheets cover Crannian Gnome,
Hyperborean Gnome, Ice Gnoll, Thraxian, Vaelkar, Crinos, Reedstalker, Boneback,
Miura, and Zymari. Each PNG/JSON pair uses the slugged race name at the
sprites root. Gender-specific sheets, if supplied later, retain priority.

Their identities follow the existing portraits and live race/guild help:
earthy Crannian and blue-clothed northern Gnomes; spotted hyena-humanoid Ice
Gnoll; small-winged Thraxian; wingless scaled Vaelkar; upright wolfman Crinos;
tailed predatory Reedstalker; upright turtle-headed, shell-backed Boneback;
upright feline Miura; and a person-shaped colony of caps and mycelial threads
for Zymari. Colors, clothing, reptile subtype, and Miura coat are representative
art choices, not claims about every character's customized appearance.

These use the existing painted style, whole-alpha-component extraction, one
shared scale per sheet, and the frame assembler. Geometry is 1536 x 1536,
nine 512-pixel cells, unit 128, ground anchor (200, 464), facing right.
Painted poses are idle/windup/strike, whiff/recoil/dodge, guard/cast/look.
Maul, thrust, chop, and loose reuse strike; raise and draw reuse windup.
These are shared action illustrations, not bespoke sword/bow animations.

Unlike complete natural-creature sheets, these bodies are unarmed and keep
equipment overlays enabled (`weaponsInArt: false`). Manually placed head,
neck, main-hand, and off-hand anchors support equipment on either facing side.
Some rear palms are occluded in strike/whiff artwork; their attachment points
are inferred at the tucked hand location. The sheets own heads, tails, and clothes
(`portrait: false`, `secondary: false`, `rigAligned: false`). Explicit
non-humanoid or unknown forms never reuse these base humanoid race sheets.

## Manifest

```json
{
  "version": 1,
  "kind": "humanoid",
  "image": "/assets/sprites/humanoid.png",
  "frameWidth": 256,
  "frameHeight": 256,
  "unit": 64,
  "anchor": { "x": 128, "y": 232 },
  "facing": "right",
  "rigAligned": false,
  "frames": {
    "idle":   { "x": 0,   "y": 0, "anchors": { "head": { "x": 128, "y": 62, "r": 20 }, "hand": { "x": 152, "y": 150 }, "offHand": { "x": 104, "y": 148 }, "cloak": { "x": 110, "y": 96 } } },
    "windup": { "x": 256, "y": 0, "anchors": { "...": "..." } }
  }
}
```

| Field | Meaning |
| --- | --- |
| `version` | Always `1`. |
| `kind` | `humanoid` or `beast`. Must match the file name. |
| `image` | Root-relative path or HTTPS URL of the sheet PNG. |
| `frameWidth`, `frameHeight` | Size of one frame in image pixels. Every frame is the same size. |
| `unit` | Image pixels per body unit at scale 1. The stage scales the frame by its own unit divided by this, so a sheet drawn at 64 px per unit and one drawn at 128 px per unit render the same size. A humanoid stands about 2.9 units tall; see the rig for proportions. |
| `anchor` | Ground point in frame pixels: where the figure's hip meets the floor line. The stage places this point on the stage ground under the fighter. |
| `facing` | Direction the art faces, `right` or `left`. The stage mirrors the frame for the other side. |
| `pixelated` | Optional. `true` draws the sheet with image smoothing off, for pixel art. The assembler's `--pixel` sets it. |
| `weaponsInArt` | Optional. `true` means the frames already show the character's weapons, so the stage draws no weapon overlays (the shield still draws). The assembler's `--weapons-in-art` sets it. |
| `portrait` | Optional. `false` means the sheet includes its complete head, so the stage does not overlay the circular avatar portrait. Enemy archetype sheets use this. |
| `secondary` | Optional. `false` means complete creature art owns its tail or cloak silhouette, so the stage does not add the rig's procedural secondary motion. |
| `cloak` | Optional. `false` hides the stage's cloak overlay because the art has its own; a `#rrggbb` color recolors it. |
| `rigAligned` | `true` only for sheets baked from the rig. The stage then positions overlays from rig geometry. Hand-drawn art sets `false` and supplies anchors per frame. |
| `frames` | One entry per pose name. Unknown names are ignored; `idle` is required. |

### Frame anchors

Per-frame pixel positions the overlays attach to. All are optional; a
missing anchor makes that overlay use rig geometry, which will be wrong for
hand-drawn art, so supply them.

| Anchor | Used for |
| --- | --- |
| `head` | Center and radius of the portrait disc. The art should leave the head area empty or draw a neutral back-of-head shape underneath. |
| `neck` | Where the neck meets the shoulders; retained attachment metadata. |
| `hand` | Weapon hand. The main-hand weapon is drawn from here. |
| `offHand` | Off-hand item or shield. |
| `offElbow` | Optional painted off-hand elbow. Together with `offHand`, positions and angles the forearm-mounted shield; older sheets retain the rig elbow. |
| `cloak` | Top of the cloak at the back shoulder. Omit if the art already includes a cloak. |

### Poses

One frame per pose name. Poses the sheet does not include fall back to the
nearest frame that exists (`idle` at minimum), so a first sheet can ship with
a subset and grow.

| Pose | When |
| --- | --- |
| `idle` | Rest stance, breathing is added by the stage. |
| `windup` | Anticipation before a blade, knife, polearm, staff, or claw strike. |
| `raise` | Anticipation before an axe or mace chop, weapon overhead. |
| `draw` | Bow drawn. |
| `strike` | Blade swing at contact. |
| `thrust` | Knife or polearm thrust at contact. |
| `chop` | Axe or mace chop at contact. |
| `cast` | Staff cast, both hands forward. |
| `loose` | Bow released. |
| `maul` | Claw or unarmed attack at contact. |
| `whiff` | Overextended swing on a miss. |
| `recoil` | Taking a hit. |
| `dodge` | Sidestep and crouch. |
| `guard` | Arms up behind a shield or crossed forearms on an absorb. |

The stage blends between the current and next pose with complementary alpha,
then holds the target frame. Squash and stretch, the hit flash, and hit-stop
apply to sprites the same way they apply to the rig.

## Baking a stand-in sheet

Until art exists, a sheet in the exact format above can be baked from the
rig in the browser console while the client is open:

```js
const baked = await window.combatDebug.bakeSpriteSheet('humanoid');
// A hand-authored vector style from combat-sprite-art.mjs, written under its own key:
const scro = await window.combatDebug.bakeSpriteSheet('humanoid', 'male-scro');
```

`baked.png` is a data URL for the sheet image and `baked.manifest` is the
manifest with rig-derived anchors. Save them as
`public/assets/sprites/humanoid.png` and `humanoid.json`. The baked sheet
looks exactly like the rig; its value is proving the loader and giving an
artist the frame grid, anchors, and pose list to draw over.

## Painting over a baked sheet

To replace a baked sheet with painted art, bake it at four times the size
for crisp control images, split the cells, and paint each cell with an
image model under a structure control:

```js
const big = await window.combatDebug.bakeSpriteSheet('humanoid', 'male-scro', 4);
// With the weapons in the frames, for painting an armed character:
const armed = await window.combatDebug.bakeSpriteSheet('humanoid', 'male-scro', 4, {
  weapons: true,
  equipment: { mainHand: { name: 'a sword', kind: 'blade' }, offHand: { name: 'a sword', kind: 'blade' }, shield: false, helmet: false, bodyArmor: true, twoHanded: false },
});
// big.canvas is the 4096 px sheet, big.names the pose order, big.frame the cell size.
```

`scripts/comfyui-sprite-cell.json` is a ComfyUI graph for one cell: checkpoint,
prompts, Canny edges from the cell, ControlNet Union, sampler, save. It uses
core nodes only; add IPAdapter plus for cross-pose consistency and a
background-removal node before assembly.

`scripts/sprite-sheet-assemble.py` places finished frames (matched by pose
name) into a new sheet at the requested cell size, scales the manifest's
frame size, unit, ground anchor, frame origins, and per-frame anchors to
match, and sets `rigAligned` to false. Run it with any Python that has
Pillow, for example ComfyUI's bundled interpreter. For pixel art pass
`--pixel` (nearest-neighbor resize and the `pixelated` manifest flag) and
optionally `--colors N` to quantize each frame to a palette.


`scripts/sprite-sheet-split.py` handles the other route: a whole sheet
generated from a text prompt with no reference cells. It cuts an even grid,
flood-fills the flat background away from the cell edges (so highlights
inside the figure survive), scales every figure by one shared factor so the
median figure height lands on the rig's, and places each with its feet on
the ground anchor, writing one frame per pose in grid order. Such frames
carry no anchors of their own, so the assembler can derive them from the
art: `--detect-head #rrggbb` finds each frame's head as the largest blob of
the skin color in the figure's upper part (`--head-band` narrows that part
when bare arms in the skin color outweigh the head), and `--detect-hand` takes the
main hand as the leading extremity in the arm band (or the topmost point
of a raised arm). Either clears `rigAligned`. Without them, assemble with
`--keep-rig-aligned` and nudge the manifest where an overlay sits off.
