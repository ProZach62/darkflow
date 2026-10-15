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

### Named boss artwork

The dedicated boss sheets come from the server's `bosses` catalogue,
not from invented client boss names. `cmds/std/_bosses.c` reads
`secure/daemons/boss_catalog_d.c`; the daemon discovers authored boss contracts
under `/domains` and `/planets`. Source references below are relative to the
server's `codebase/` directory in `jasona/darkwind-nextgen`.

| Sheet under `enemies/` | Visible names and public race | Authored visual source |
| --- | --- | --- |
| `ilyrra` | Ilyrra; Ilyrra Still-Wing; dragon | `domains/auralis/areas/azure_expanse/monsters/ilyrra.c`: azure dragon, fractured ice, wings locked against flanks |
| `orryx` | Orryx; Orryx, Root of Thunder; dragon | `domains/auralis/areas/emerald_tempest/monsters/orryx.c`: emerald dragon, copper-bark wing plates, root growth, breastbone stormseed and conductor blossoms |
| `lord-blackbriar` | Lord Blackbriar; Lord Blackbriar, the Sole Heir; spirit | `domains/bodachian_fallows/areas/blackbriar_manor/monsters/lord_blackbriar.c`: tall formal noble ghost; no wielded rapier |
| `languish` | Languish; a smooth priest; undead | `domains/darkwind/pirate/mon/priest.c`: deceptively smiling man, long canines, worn heavy green cloak, unarmed |
| `gravewatch-penitent` | The Gravewatch Penitent; undead | `domains/darkwind/areas/abbey/monsters/gravewatch_penitent.c`: ash-streaked iron burial mask, torn habit over abbey mail, chain-wrapped body; mechanically equipped hammer |
| `vaelkor` | Vaelkor; Vaelkor, the Ash Regent; Vaelkor the Ash Regent; dragon | `domains/auralis/areas/crimson_reach/monsters/vaelkor.c`: old crimson dragon, fused ash/emberglass mantle, three pale breast fractures |
| `unarrived` | The Unarrived; dragon | `domains/auralis/areas/violet_rift/monsters/unarrived.c`: violet phaseborn dragon, backward-curving horns with caught silver thread |
| `swamp-wyrm` | Swamp Wyrm; dragon | `domains/darkwind/areas/4dragons/mob/wyrm.c`: rat-like face, tiny black eyes, wet jaws, alternating scales and matted fur |
| `bandit-king` | The Bandit King; human | `domains/darkwind/areas/archtower/monsters/banditK.c`: large scarred man, left facial scar, dented bronze breastplate, steel helmet, leather leggings and silver shoulder badge |
| `tidemother` | The Tidemother; beast | `domains/underworld/areas/necropolis/monster/tidemother.c`: huge female eel-like oracle, black coral crusting and pearl scars |
| `carrion-queen` | Carrion Queen; the Carrion Queen of the Black Boughs; bird | `domains/underworld/areas/eternal_darkness/monsters/carrion_queen.c`: huge female winged scavenger, black hair braided with a giant-finger-bone crown and ragged wings |
| `drowned-dryad` | Drowned Dryad; the Drowned Dryad of the Root-Ford; spirit | `domains/underworld/areas/eternal_darkness/monsters/drowned_dryad.c`: large pale female spirit rising waist-deep from black water, hair drifting among drowned roots |
| `furnace-king` | The Furnace King; elemental | `planets/markas/areas/rainbow_abyss/monsters/furnace_king.c`: huge male ruler of fused iron and fire; reward crown/cuirass are not explicitly equipped |
| `thaloryn` | Thaloryn; Thaloryn, the Unmoored Leviathan; beast | `planets/markas/areas/rainbow_abyss/monsters/thaloryn.c`: huge male blue-black creature in a suspended sea; finned/coiled marine anatomy is an artistic interpretation, not an authored species |
| `greg-director` | Greg, Director of Security; human | `planets/tekal/areas/emerald_spire/level3/monsters/greg.c`: medium male human, fitted dark coat concealing cybernetics, equipped steel restraint gauntlet |
| `aralith` | Aralith; Aralith the Nature Mage; gargoyle | `domains/kerei/areas/garset/npc/aralith.c`: large female malachite gargoyle, bronze eyes, ivory horns, moss and vines, ruby robe with silver trim; equipped ash quarterstaff |
| `sayf-al-murr` | Sayf al-Murr; Sayf al-Murr, the salt baron; human | `domains/souvrael/areas/ulqathra/monsters/baron.c`: large heavy smiling man in salt-white silk, rings on every finger; equipped gilded sabre |
| `waternix` | Waternix; each-uisge; faerie | `domains/islands/areas/briton/monsters/waternix.c`: large male black stallion, dripping coat and glowing red eyes; no rider or equipment |
| `gaean-warden` | Gaean warden; Warden of Gaea's Vigil; spirit | `domains/underworld/areas/eternal_darkness/monsters/gaean_warden.c`: large female spirit of leaf-shadow and riverstone, calm old face, bare feet with living roots |
| `astral-colossus` | Astral Colossus; construct | `planets/markas/areas/rainbow_abyss/monsters/astral_colossus.c`: huge male giant of drifting stone; carried starblade is not equipped |
| `splintermaw` | Splintermaw; reptile | `domains/highway/areas/blackmouth_pass/monsters/splintermaw.c`: huge reptile, broken stalagmite teeth regrown as mineral shards |
| `ironheart-treant` | Ironheart Treant; treant | `domains/underworld/areas/eternal_darkness/monsters/ironheart_treant.c`: huge oak, black iron grown through heartwood, thorn-healed branch wounds |
| `sablehorn` | Sablehorn; Sablehorn Moltwyrm; dragon | `domains/highway/areas/blackmouth_pass/monsters/sablehorn_moltwyrm.c`: huge male dragging wyrm, two black horns cracked by orange heat |
| `vorrak` | Vorrak; Vorrak the Acid Coil; dragon | `domains/highway/areas/blackmouth_pass/monsters/vorrak_acid_coil.c`: huge male coiled deep wyrm, slick black scales with bright green acid threads |
| `lower-jaw-alpha` | Lower Jaw Alpha; reptile | `domains/highway/areas/blackmouth_pass/monsters/lower_jaw_alpha.c`: huge male reptile, one missing eye and extensively lost hide, healed scars and muscle |
| `qitar` | Qitar; Qitar, the Unbound; demon | `domains/souvrael/areas/babylon/monsters/qitar.c`: large male shape of smoke and black bronze, burned-mask face, hooked hands, equipped blackened-bronze diadem |
| `mawspike` | Mawspike; Mawspike the Burrower; reptile | `domains/highway/areas/blackmouth_pass/monsters/mawspike_burrower.c`: huge male long-bodied gnasher, broken stone jaw spurs, basalt-ripping claws |
| `uncolored-one` | The Uncolored One; spirit | `planets/markas/areas/rainbow_abyss/monsters/uncolored_one.c`: huge male figure between nine currents, drawing colour from nearby edges |
| `warden-post-golem` | Warden post golem; the Warden Post Golem; golem | `domains/highway/areas/blackmouth_pass/monsters/warden_post_golem.c`: huge neuter squat basalt block, empty guard chair embedded in its back, weapon-rack hooks along its arms |
| `defiler` | Defiler; daemon of defilement; fiend | `domains/kerei/areas/catacombs/mobs/defiler.c`: huge male twelve-foot daemon of immense bulk, lowered head, bared teeth, burning claws |
| `white-shark` | White shark; fish | `domains/kerei/areas/otemple/monster/white_shark.c`: huge male fourteen-foot shark, grey back, white belly and dorsal-fin tips, two rows of sharp teeth |
| `ruby-dragon` | Ruby dragon; dragon of ruby; dragon | `domains/kerei/areas/otemple/monster/ruby_dragon.c`: huge female upright red dragon, curled tail, copper-accented wings, glowing red eyes |
| `regrowth-mass` | Regrowth mass; a regrowth mass; reptile | `domains/highway/areas/blackmouth_pass/monsters/regrowth_mass.c`: huge neuter living heap of scale, tooth and meat, regrowing jaws and knitting flesh |
| `bankbreaker` | Bankbreaker; Bankbreaker, the root-burrowing beast; animal | `domains/talamh_darag/areas/redroot_ringfort/monsters/burrower.c`: huge neuter digging beast, clay lodged in old hide ridges, one foreclaw worn shorter than the other |
| `nhal-serev` | Nhal Serev; Nhal Serev, the Rimebound Archlich; undead | `domains/dramasa/areas/rimevault/monsters/nhal_serev.c`: medium preserved floating sorcerer, broken ancient ice shell, blue skull fire and orbiting spell fragments |
| `rabbit-of-caerbannog` | Rabbit of Caerbannog; fiend | `domains/hyperborea/areas/crystal_tower/monsters/rabbit_of_caerbannog.c`: small white rabbit, immaculate fur, glowing red eyes and unnaturally fine sharp incisors |
| `volcano-heart` | Volcano Heart; the Volcano Heart; elemental | `domains/darkwind/areas/qazaash/rainbow4/monsters/volcano_heart.c`: huge elemental figure, molten core enclosed in black stone slabs, red-lit fractures |
| `gravemarch-span` | Gravemarch span; the Gravemarch Span; golem | `domains/highway/areas/blackmouth_pass/monsters/gravemarch_span.c`: huge neuter hunched bridge-warden of fitted basalt plates |
| `obsidian-thane` | Obsidian thane; the Obsidian Thane; giant | `domains/highway/areas/blackmouth_pass/monsters/obsidian_thane.c`: huge male basalt giant, crown grown from skull, chest laws carved in dust-filled letters |
| `parallax-queen` | The Parallax Queen; construct | `planets/tekal/areas/parallax_hive/monsters/parallax_queen.c`: huge neuter insect-shaped machine, ceramic mandibles, charged needles, solvent ducts and contained quantum core |
| `cragjaw` | Cragjaw; Cragjaw, First Hunger; reptile | `domains/highway/areas/blackmouth_pass/monsters/cragjaw_first_hunger.c`: huge male black-scaled fault predator, wedge skull and exceptionally long teeth |
| `rattleback` | Rattleback; Rattleback Gnashmother; reptile | `domains/highway/areas/blackmouth_pass/monsters/rattleback_gnashmother.c`: huge female brood-mother, rows of loose black spinal plates and a plated tail |
| `echoing-drop-stalker` | Echoing drop stalker; an echoing drop stalker; reptile | `domains/highway/areas/blackmouth_pass/monsters/echoing_drop_stalker.c`: huge neuter vertical-stone climber whose throat repeats vanished prey's sounds |
| `black-vent-ancient` | Black vent ancient; the Black Vent Ancient; dragon | `domains/highway/areas/blackmouth_pass/monsters/black_vent_ancient.c`: huge neuter heat-drinking wyrm, matte lightless scales and fireless teeth |
| `hollow-antler` | Hollow Antler; the Hollow Antler; spirit | `domains/darkwind/areas/syldenith_heartroot_descent/monsters/hollow_antler.c`: large wound spirit, root-bone limbs, empty antler rack, red sap and founder-stone core |
| `warg-leader` | Warg leader; the warg leader; dog | `domains/hyperborea/areas/wolfjord/monsters/wargleader.c`: large male black-grey canine brute, coarse ruff, torn ear, scarred grey muzzle and yellow eyes |
| `molten-rib-serpent` | Molten rib serpent; the molten rib serpent; dragon | `domains/highway/areas/blackmouth_pass/monsters/molten_rib_serpent.c`: huge neuter long pale wyrm, bones glowing through translucent hide like a furnace behind smoke |
| `crystalline-monarch` | Crystalline monarch; the Crystalline Monarch; elemental | `domains/souvrael/areas/crystalline_sands/monsters/crystalline_monarch.c`: large neuter elemental fused with crystal growth, heavy amber/ivory arms and cyan core beneath chest plates |
| `jade-dragon` | Jade dragon; dragon of jade; dragon | `domains/kerei/areas/otemple/monster/jade_dragon.c`: huge male seated green dragon, tail around feet, gold-accented wings and red eyes |
| `ghost-of-varg` | Ghost of Varg; the ghost of Varg the Grey; ghost | `domains/darkwind/areas/vargs_teeth/monsters/ghost_of_varg.c`: vast fang-grey wolf spirit, outline of still air and remembered claws, not a returned corpse |
| `red-scree-lurker` | Red scree lurker; a red scree lurker; reptile | `domains/highway/areas/blackmouth_pass/monsters/red_scree_lurker.c`: huge neuter ambusher lying almost flat, jagged hide plates camouflaged against red stones |
| `buried-mile-colossus` | Buried mile colossus; the Buried Mile Colossus; golem | `domains/highway/areas/blackmouth_pass/monsters/buried_mile_colossus.c`: huge neuter golem of fused road blocks, each numbered and crossed out by a later hand |
| `brood-cradle-matron` | Brood cradle matron; the Brood Cradle Matron; dragon | `domains/highway/areas/blackmouth_pass/monsters/brood_cradle_matron.c`: huge ancient female wyrm with a plated belly scarred by hundreds of hatchings |
| `deep-spine-wyrm` | Deep spine wyrm; the Deep Spine Wyrm; dragon | `domains/highway/areas/blackmouth_pass/monsters/deep_spine_wyrm.c`: huge male wyrm, overlapping natural armour plates from skull to tail |
| `pale-furnace-wyrm` | Pale furnace wyrm; the Pale Furnace Wyrm; dragon | `domains/highway/areas/blackmouth_pass/monsters/pale_furnace_wyrm.c`: huge neuter wyrm almost white from heat, open mouth glowing like a kiln full of bone ash |
| `crushed-arch-warden` | Crushed arch warden; the Crushed Arch Warden; golem | `domains/highway/areas/blackmouth_pass/monsters/crushed_arch_warden.c`: huge carved warden stooping beneath a shoulder-fused keystone, spread stone hands |
| `ninth-mile-marker` | Ninth mile marker; the Ninth Mile Marker; golem | `domains/highway/areas/blackmouth_pass/monsters/ninth_mile_marker.c`: huge living road-stone on four basalt legs, faint erased number beneath claw marks |
| `sealed-descent-keeper` | Sealed descent keeper; the Sealed Descent Keeper; golem | `domains/highway/areas/blackmouth_pass/monsters/sealed_descent_keeper.c`: huge basalt figure with an already-split chest leaking hot dust |
| `last-chain-sentinel` | Last chain sentinel; the Last Chain Sentinel; giant | `domains/highway/areas/blackmouth_pass/monsters/last_chain_sentinel.c`: huge giant in black armour attached to the final chain |
| `last-breath-herald` | Last breath herald; the Last Breath Herald; reptile | `domains/highway/areas/blackmouth_pass/monsters/last_breath_herald.c`: vast blind reptile with bellows-like lungs |
| `emerald-dragon` | emerald dragon; dragon | `domains/hyperborea/areas/north_hyper/monsters/emerald.c`: emerald-scaled dragon |
| `skeletal-dragon` | skeletal dragon; dragon | `domains/hyperborea/areas/4dragons/mobs/dragon.c`: complete draconic skeleton |
| `jeweled-dragon` | jeweled dragon; dragon | `domains/kerei/areas/4dragons/mobs/dragon.c`: golden wings and gemstone-bladed tail |
| `faerie-dragon` | huge faerie dragon; dragon | `domains/kerei/areas/faerie/monster/faeriedragon.c`: full-sized green and silver dragon |
| `white-wyrm` | White Wyrm; huge white wyrm; dragon | `domains/kerei/areas/temple/monster/boss.c`: eyeless limbless white serpent with two short horns |
| `tarrasque-mountain-eater` | Tarrasque; the Tarrasque, Mountain-Eater; reptile | `domains/highway/areas/blackmouth_pass/monsters/tarrasque_mountain_eater.c`: huge fortress-eater with overlapping natural armour |
| `batrachiarch` | Batrachiarch; Arch-Demon Batrachiarch; demon | `domains/darkwind/areas/garden/monsters/batrachiarch.c`: huge hairy ape-bat with broad wings and pale yellow eyes |
| `mud-golem-king` | The King of the Mud Golems; golem | `domains/darkwind/areas/mound/npc/mud_king.c`: gem-studded amorphous mud blob |
| `iron-golem` | A huge iron golem; golem | `domains/darkwind/areas/syldenith/monsters/igolem.c`: fifteen-foot iron body, two huge fists |
| `uncrowned-witness` | the Uncrowned Witness; spirit | `domains/darkwind/areas/syldenith_founding_scar/monsters/uncrowned_witness.c`: absence outlined by a crown-shaped gap and five gifts |
| `nidhug` | Nidhug; dragon | `domains/hyperborea/areas/asgard/monsters/odinspalace/nidhug.c`: ancient black-scaled smoking dragon |
| `charnel-crawler` | the Charnel Crawler; insect | `domains/hyperborea/areas/asgard/monsters/valhalla/charnel_crawler.c`: green carrion crawler, black tendrils, eight pale tentacles |
| `midgard-serpent` | The Midgard Serpent; reptile | `domains/hyperborea/areas/asgard/quest/serpent.c`: salt-crusted grey-green world-serpent |
| `knot-chewer` | Knot Chewer; gnoll | `domains/hyperborea/areas/knucklebone_road/monsters/knot_chewer.c`: aged female gnoll, silver muzzle, patched hide coat and red cords |
| `umberhulk-matriarch` | Matriarch; the umberhulk matriarch; ogre | `domains/hyperborea/areas/asgard/monsters/nidavellir/hulk_matriarch.c`: pitted mossy carapace, four eyes and crushing mandibles |
| `tree-spirit` | tree spirit; spirit | `domains/underworld/areas/gcity/monster/tspirit.c`: huge female shimmering water-energy mass, not a wooden treant |
| `giant-grubber` | A giant grubber; invertebrate | `domains/underworld/areas/underdark/mobs/grubber2.c`: pale grey worm with hundreds of tiny feet |
| `tunnelworm` | A giant, blundering worm; invertebrate | `domains/underworld/areas/underdark/mobs/tunnelworm.c`: eyeless grey worm with long mouth-talons |
| `squiggoth` | squiggoth; fiend | `domains/underworld/areas/orcnewbie/mobs/squigc.c`: mammoth-sized blue-tinged mount with pointed ears |
| `bone-goliath` | Bone Goliath; demon | `domains/underworld/areas/demon_plain/monster/bonegoliath.c`: humanoid aggregate of clean white skulls and long bones |
| `unus` | Unus; Unus, a majestic white unicorn; horse | `domains/talamh_darag/areas/forest/monsters/unicorn.c`: white unicorn with flowing mane and lion-shaped tail |
| `myriasic` | Myriasic; Myriasic the spook; undead | `domains/talamh_darag/areas/towerts/monsters/myriasic.c`: blurred male spirit with elven features |
| `ul-qathra` | Ul-Qathra; Ul-Qathra, the Patient Mouth; invertebrate | `domains/souvrael/areas/ulqathra/monsters/ulqathra.c`: wet grey ridged mouth with bone beak and coiling tongues |
| `sphinx` | Sphinx; elemental | `domains/souvrael/areas/southdesert/monsters/sphinx.c`: lion body, vaguely human head, folded feathered wings |
| `purple-worm` | Purple worm; A HUGE purple worm; invertebrate | `domains/souvrael/areas/southdesert/monsters/pworm.c`: ancient enormous purple-skinned worm |
| `lady-vesper` | Lady Vesper; Lady Vesper, Last Hostess; undead | `domains/bodachian_fallows/areas/vespercourt/monsters/lady_vesper.c`: aristocratic hostess with brittle restored-portrait beauty |
| `curator-halvek` | Curator Halvek; Curator Halvek, Master of the Last Exhibition; human | `domains/highway/areas/ochre_menagerie/monsters/curator_halvek.c`: ochre hidecoat, razormane mantle and steel gauntlets |
| `thera-runemistress` | Thera; Thera, the Runemistress; elf | `domains/hyperborea/areas/wolfjord/monsters/runemistress.c`: slight sorceress in flowing ice-blue silk |
| `archsage-caldris` | Caldris; Archsage Caldris, Keeper of the Hearthstar; human | `domains/underworld/areas/brightward_road/monsters/archsage_caldris.c`: ancient gentle magician in warm ivory robes |
| `saint-veyra` | Saint Veyra of the Burning Window; undead | `domains/underworld/areas/emberglass_reliquary/monsters/saint_veyra.c`: burning skeleton inside living emberglass |
| `orrick-last-ferryman` | Orrick; Orrick, Last Ferryman; undead | `domains/underworld/areas/saltbone_ferryworks/monsters/orrick_last_ferryman.c`: bony ferryman in salt-hardened funeral cloth |
| `archmagister-othrys` | Othrys; Archmagister Othrys, the Unending; gnome | `domains/underworld/areas/nhal_tor/monsters/archmagister_othrys.c`: gnomish skull and rotating lenses fused to a cable throne |
| `prince-morgran` | Morgran; Prince Morgran the Crownless; undead | `domains/underworld/areas/hollow_crown_bastion/monsters/prince_morgran.c`: black-steel broken-regalia armour, bare brow |
| `argent-marshal` | Argent Marshal; the Argent Marshal, Last Command of Rhuddlan; construct | `domains/underworld/areas/rhuddlan/crescent_bastion/monsters/argent_marshal.c`: empty silver-chased plate, cable tendons, cold crescent within helm |
| `chairheir-aurex` | Chairheir Aurex; Chairheir Aurex Vellum, the Seventh Firstborn; undead | `domains/underworld/areas/house_of_preferment/monsters/chairheir_aurex.c`: golden chair on black conduits, seven birthrights above brow |

Dedicated art requires an exact normalized visible name AND the corresponding
public race, with no explicit transformed form. Existing `bossKey` normalization
handles articles, case, whitespace and `(BOSS)` tags. A family alone, local boss
mark, partial name, or private recipient race never unlocks a named sheet.
This is artwork selection, not authoritative boss identification: the protocol
does not yet supply a unique artwork/blueprint key. Redaction, transformed forms,
legacy actors without public appearance, and failed art loads retain existing
generic/species fallbacks. Other dragons and undead are unchanged.

The base name `Wyrm` plus race `dragon` is shared by several different server
actors. It deliberately does NOT select Swamp Wyrm art: that sheet requires
the distinctive public `Swamp Wyrm` label. Combat payloads containing only
`Wyrm` retain generic drake art until a more specific public identity is supplied.
`Vaelkor` plus `undead` is the separate Vaelkor the Unquiet and likewise must
not select the dragon's Ash Regent sheet. A public race of `beast`, used by
Tidemother, selects beast geometry without assigning any particular species;
only her exact public name unlocks her dedicated eel-like art.

The bare name `Greg` also occurs in an unrelated random-name pool. Only the
full public `Greg, Director of Security` label selects his sheet; combat
payloads exposing only `Greg` retain normal human artwork. Shared `queen`
and `harpy` aliases do not select either queen's art. Carrion Queen requires
the actual public race `bird`, not an inferred `harpy` race. No generic bird
or elemental classification is added just to support these named sheets.

Waternix's actual public name is `each-uisge`. A separate ordinary monster at
`players/redbear/area/monsters/waternix.c` shares that name, race, and black
stallion description, so both may use this artwork without assigning boss
status. The named sheet supplies a complete horse body despite the public
`faerie` race; unrelated faeries keep their existing humanoid fallback.

Each transparent 1536 x 1536 sheet has nine painted 512-pixel poses in the
same idle/windup/maul, whiff/recoil/dodge, guard/cast/look layout. Humanoid
strike/thrust/chop aliases reuse the attack frame without duplicating pixels.
Penitent's hammer uses a raise alias of the windup frame.
Generation uses the existing Wolf or male-human art as style references,
whole alpha-component extraction, one shared scale per boss, and the existing
frame assembler. Aliases are added after assembly so translucent ghost pixels
are not composited repeatedly. All sheets own their complete heads and coats,
wings or tails. Penitent's empty-handed body supplies per-pose hand grips for
runtime equipment. Bandit King's empty-handed body also has off-hand and elbow
anchors for his server-provided sword and shield; art does not force Blooddrinker
over its bastard-sword fallback. Beast sheets use natural attack poses rather
than reconstructing held gear (including Swamp Wyrm's attempted Two Moons equip).
Other sheets suppress weapon overlays for their natural or unarmed attacks.
Spell effects, environmental props and phase-dependent
transformations are not baked into these baseline sheets.
Dryad's compact watery root lower body represents her waist-deep description
without painting a room-sized pool. Carrion Queen retains her intact crown;
the later phase that destroys it is not inferred. Furnace King does not wear
his unequipped reward items, and Thaloryn does not wield his reward polearm.
Greg's coat and restraint gauntlet are painted into his body; no unique-only
retaliatory vanes, desk, or surveillance scenery are assumed. His facial
features and the Dryad's hair colour are artistic choices, not server facts.
Aralith and Sayf also use empty-handed bodies with per-pose hand grips for
server-controlled equipment. Aralith's quarterstaff currently projects as
`polearm`/`smash`, which the existing client resolves to hammer artwork; this
batch does not change shared weapon selection. Sayf's ledger is not held gear.
Waternix owns its natural hoof attacks. The Warden remains a barefoot woman,
not a tree creature, and the Colossus does not wield its unequipped starblade.
The Colossus's boulder limbs and small joint gaps are artistic interpretations
of drifting stone, not additional server appearance hints.

Splintermaw and Lower Jaw Alpha use four-legged cave-reptile silhouettes;
their precise anatomy and colours are artistic interpretations of the public
`reptile` race, not a new generic species mapping. The Alpha's missing near-side
eye is painted as a healed-over socket; the source does not specify which eye.
Sablehorn and Vorrak use legless, wingless coils as an interpretation of their
dragging/coiling descriptions. Sablehorn's bronze body colour is an art choice;
only its two horns are explicitly black. Ironheart's integrated iron plates
are body features, not equipped armour; no gender is inferred for the treant.
All five use natural attacks and own their complete silhouettes. Reptile
sheets include humanoid attack aliases for the existing broad-race rig fallback.
Shared `gnasher` and `wyrm` aliases do not select any of these named sheets.
Death-clone amulets, armour and spears are not worn, and later phase changes
(including Ironheart's exposed burning sap) are not baked into baseline art.

Qitar's painted diadem is his explicitly equipped brow band, not a helmet cap;
his tablet fragment is carried, not held. His bronze/smoke anatomy and hook
hands own their complete silhouette. Mawspike's four-legged long-bodied
reptile anatomy and dark scale colour are artistic interpretations; its stone
jaw spurs and digging claws are authored. Its beast body includes humanoid
attack aliases for the existing broad-race fallback. Warden Post Golem's
empty chair and rack hooks are integral body features, not a ridden mount or
held weapon. Its blocky legs and chair material are artistic choices. The
golem's shield/greaves and Mawspike's amulet/tooth are death-clone rewards,
not equipped items. Shared `gnasher` and `golem` names keep generic art.
Uncolored One's faceless silver-gray flowing silhouette and faint coloured
edge strands interpret its abstract description; no particular face, skeleton,
clothing, staff or carried starblade is asserted. Defiler's charcoal-maroon
hide and bulky two-legged anatomy are art choices, not additional appearance
hints. It has no invented horns or wings, no carried bag on the body, and no
later-phase split hide. Heartroot defiler is a different human and never uses
this sheet. All five own their natural attack poses without painted scenery.

Combat actor names come from `combat_presentation_d.c`'s `query_cap_name()`
fallback chain, while room occupants use rendered `short()`. These five
support their actual Combat names as well as the listed room labels. White
Bear and Gate Guardian were not selected: Combat sends only `Bear` and
`Guardian`, so distinctive room shorts cannot safely identify them in combat.

White Shark, Ruby Dragon, Regrowth Mass, Bankbreaker, and Nhal Serev were
checked against the server sources listed above. Their nine-pose sheets
include natural attack or spell poses, without painted weapons or scenery.
White Shark retains its complete aquatic body rather than a humanoid rig;
Ruby Dragon's wings stay copper-accented rather than adding equipment.
Regrowth Mass's muted flesh palette and low eyeless mound silhouette are
art choices: the source fixes neither a skeleton nor a limb count.
Bankbreaker's mammal-like outline, hide colour, and choice of shorter
foreclaw are artistic interpretations, not additional server appearance hints.
Nhal Serev's robe colour is likewise artistic; no gender is inferred from
its undead race. Its carried implant reward is not painted as a held skull.
Regrowth Mass's death-cloned ring and Bankbreaker's reward boots are not
equipped and do not appear on their bodies. Broad fish, animal, reptile and
undead labels retain generic fallbacks; only exact public name/race pairs
select these sheets. Mintohdar remains deferred until its required eight-arm
anatomy can be reproduced consistently across poses.

Rabbit of Caerbannog, Volcano Heart, Gravemarch Span, Obsidian Thane, and
the Parallax Queen add nine-pose bodies using the authored sources above.
Caerbannog's generic room short `a rabbit` deliberately does not select its
sheet, even with race `fiend`; Combat's distinctive `Rabbit of Caerbannog`
does. Its larger sheet unit keeps the painted rabbit small beside a human,
in addition to the server's small-size hint. No reward carrot juice or
grenade is painted on its body.
Volcano Heart stays in its banked black-stone/red-core form, with no reward
heartblade or invented gender. Gravemarch Span and Obsidian Thane have no
painted reward shields or greaves. The Thane's crown is grown anatomy rather
than equipped armour, and the chest marks suggest dust-filled laws without
inventing readable text. Volcano Heart's rocky facial features and exact
limb shapes, and the Span's block hands and plate layout, are art choices.
The Parallax Queen's six-legged layout, metal palette and blue core are
artistic interpretations of its insect-shaped chassis. Only attached cable
ends are included; suspension anchors belong to the room, not the body
atlas. Its equipped crown/afterimage-corona aura variants are not baked into
the chassis, avoiding a false claim about which variant is available.
Other rabbits, golems, giants and constructs retain existing generic art.

Cragjaw, Rattleback, Echoing Drop Stalker, Black Vent Ancient, and Hollow
Antler add nine-pose bodies from their authored boss definitions. The three
reptiles use quadrupedal interpretations: Cragjaw's wedge skull and long
teeth, Rattleback's loose spinal plates and plated tail, and the Stalker's
spread gripping toes and resonant throat distinguish their silhouettes.
Limb counts, eye colours, body proportions and the Stalker's slate palette
are art choices, not new public appearance hints. The Stalker has one mouth;
its phase name does not imply multiple physical mouths. The Ancient's
wingless long-necked body is likewise an interpretation; its plates remain
matte, without a glowing furnace or fire breath. Hollow Antler is a hollow
root-bone biped surrounding an exposed stone core, with red sap rather than
blood. Its stance is artistic, no gender is inferred, and it is not depicted
as a normal deer or an ancient forest deity. None has painted reward gear:
tooth/amulet drops, wyrmscale armour/spear and stone-sap gauntlets are rewards,
not authored equipped items. Exact public Combat and room labels plus race
select the sheets; generic gnashers, stalkers, wyrms and treants are unchanged.

Warg Leader, Molten Rib Serpent, Crystalline Monarch, Jade Dragon, and Ghost
of Varg add nine-pose bodies using their authored definitions above. The
Warg's torn-ear side and scar placement are artistic choices; his carried
treasure pelt is not a cloak or separate accessory. The Serpent's limbless,
wingless coil is an interpretation of the long pale wyrm. Its glowing ribs
stay beneath intact translucent hide, before the later split-hide phase;
reward armour and spear are not painted equipment. The Monarch's face and
two-legged construction are art choices, with amber/ivory mineral anatomy
and cyan core rather than a robe, sceptre or manufactured plate armour.
Its room short's colour tokens are stripped by the server's
`room_scene_text()` before entering `Room.Occupants.name`, so the plain
room label selects the sheet without client colour-token aliases.
Jade Dragon keeps its authored green/gold winged body; it is not the
different temple dragon that equips `jade_dragon_aura`.
Varg remains wolf-shaped spirit-hide, with grey eye treatment and opacity
as art choices. Neither gender nor size is invented: the source sets no
gender and `SIZ_NONE` omits `appearance.size` in the public projection.
No reward mantle is painted on the ghost. Broad canine, serpent, elemental,
dragon and ghost labels retain existing generic sheets.

Red Scree Lurker, Buried Mile Colossus, Brood Cradle Matron, Deep Spine
Wyrm, and Pale Furnace Wyrm add nine-pose bodies from Blackmouth Pass.
The Lurker's rusty palette and flat four-legged silhouette interpret its
stone camouflage. The Colossus's block proportions, stone colour and specific
crossed-out numerals are art choices, not new lore or readable room data.
The Matron's charcoal hide, pale scarred belly and wingless four-legged
anatomy are artistic interpretations; the healed hatching scars are authored.
Deep Spine's steel-blue palette and wingless long-necked anatomy are likewise
art choices. Its baseline plates stay overlapping, without the later phase's
all-raised transformation. Pale Furnace has opaque heat-bleached ivory scales
and kiln-orange jaws, not Molten Rib Serpent's translucent ribs or frost.
Its four-legged wingless silhouette is an interpretation, not a server hint.
None wears death-cloned teeth, amulets, shields, greaves, armour or spears.
The Lurker includes humanoid attack aliases for the existing reptile fallback;
generic lurkers, colossi, matrons and wyrms do not select these named sheets.

Crushed Arch Warden, Ninth Mile Marker, Sealed Descent Keeper, Last Chain
Sentinel, and Last Breath Herald retain their baseline bodies, not later
keystone splitting, burning-number, chest-eruption or chain-snapping changes.
The Marker uses beast geometry for its four basalt legs despite race golem;
its erased mark is abstract rather than an invented literal numeral. The
Herald's quadruped stance, slate palette, pupil-less eyes and pleated flanks
interpret its blind reptilian body and bellows lungs. Sentinel's bald grey
flesh is artistic; the described black armour and attached chain are canon,
not fabricated equipment hints. All five have natural attacks and no held
equipment. Death-cloned shields, greaves, mail and ring remain rewards.

Emerald, Skeletal, Jeweled and Faerie Dragons require their distinctive room
labels; generic Combat names such as Dragon must not select them. White Wyrm
replaces the ambiguous Swamp Dragon (Dragon / a huge dragon). Shared historical
copies of Emerald and White Wyrm depict the same anatomy. All five preserve
natural attacks, not phase transformations or treasure drops. Jeweled Dragon's
conditional unique scimitar is omitted from this baseline body. Wings, limb
proportions and scale shading are artistic where unspecified. White Wyrm's
ivory horns have red base cuffs, not eyes or limbs. Width-capped common scale
preserves complete anatomy instead of forcing long bodies to humanoid height.

Tarrasque replaces Jabberwocky, whose detached head shares its normalized
name/race. Mud King and Iron Golem require distinctive room labels, never
generic Golem. Their gems and iron fists are body details, not reward gear.
Batrachiarch's empty hands retain runtime overlays for its genuinely equipped
unique ball and chain when available; ape-bat anatomy uses beast geometry.
Witness's crown-shaped negative space and abstract gifts are integral body
interpretations, not a worn crown or reward mantle. No sheet depicts later
regeneration, heated-core or transformation phases.

Nidhug's historical copy describes the same World Ash dragon. Charnel Crawler
and Midgard Serpent exclude generic Crawler and Serpent identities. Coiled
serpent scale is necessarily stylized; it has no legs. Matriarch's ogre race
does not replace its authored beetle-like carapace. Knot Chewer has no equipped
Jaw reward or shield; tally bones and coat are prose details. Charnel's eight
tentacles were visually checked in idle/maul/cast only, not all nine poses;
Knot Chewer's seven closures are partially occluded. Full-pose anatomy review
remains outstanding where upload quota prevented inspection.

Tree Spirit's abstract upright water-energy body has empty gripping tendrils
for its limited blood Oak lance. It is not a bark humanoid. Per-pose anchors
include a shared visible grip in dodge where the second tendril is occluded.
Grubber and Tunnelworm require their room labels and invertebrate race;
legacy copies omit race. Generic Worm remains ambiguous. Width-capped
coiling preserves complete bodies, with tiny feet only on Grubber. Squiggoth's
quadruped stance is artistic; no saddle, rider or death-gold earring is added.
Bone Goliath replaces the colliding Queen Worm identity. Its white bones are
body material; its aura and death coins are not held equipment.

Unus keeps its integral horn and lion tail, not a detached reward horn or tack.
Myriasic requires undead race; the restored elf with the same name is separate.
Ul-Qathra depicts the original mouth, not its later heart phase or surrounding
desert. Sphinx keeps folded wings and feline paws without invented regalia.
Purple Worm has continuous leathery coils and no stinger, limbs or reward
corpse. Coils compress world-scale lengths for the frame. All five are
unarmed; intrinsic hornlight and ash-memory spirit shading are not held gear.

Vesper's burgundy dress and grey coiffure interpret unspecified attire; no
reward veil or incidental glass is equipped. Halvek's hook and Thera's staff
remain runtime weapons attached to empty painted hands; Halvek's carried
scimitar and Thera's runestone pouch are not initial hand gear. Caldris has no
invented staff or reward grimoire. Saint Veyra includes the intact living
window as body, not scenery or feathered wings. Bare Veyra is deliberately
excluded because another boss shares it; only her distinctive room label
selects this art. Bare Vesper and Halvek likewise remain unregistered.

Orrick has empty skeletal hands, not a reward flail or ferry scenery. Othrys,
Argent Marshal and Aurex retain integral throne machinery across poses, not
later detached or elevated phases. Othrys's rear mechanical buds represent
nascent bodies rather than additional actors. Morgran has no crown or axe;
Argent's plate is its empty body rather than a worn reward cuirass. Aurex's
seven brow marks are subdued at Scene scale, not equally legible in every
pose. All five are unarmed: death drops do not establish encounter equipment.

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
