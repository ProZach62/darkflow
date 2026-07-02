# GMCP Update Consistency Audit — Darkflow + darkwind-nextgen

Date: 2026-07-01. Trigger: player reports that "some GMCP isn't firing and
updating consistently like it was before." Scope: full sweep of both sides of
the wire — production (`darkwind-nextgen/codebase`, telopt) and consumption
(this repo). Fixes shipped in darkwind-nextgen `3281aab34` (branch v4.0.0)
and Darkflow `04f9bab` (branch v1.2.8).

## 1. How GMCP flows (as-built)

Server: `telopt_d.c` builds every payload; the player-side `gmcp_message()`
(`secure/player/telopt.c:1686`) is the wire primitive. For most packages it
diffs against a per-player `nosave` cache and transmits **only changed keys —
or nothing** (`gmcp_cache_filter`, telopt.c:597). A `refresh` flag bypasses
the cache for snapshots. Client: binary WS frames → `gmcp.dispatch()` event
bus → per-panel handlers mutate `panelManager.gmcpData` → rAF-coalesced
renders. The client sends `Darkwind.Client.Subscriptions` (visible panels);
the server gates pushes on it and pushes fresh snapshots for newly-enabled
panels.

## 2. Data classes on the wire, and what updates them

| Class | Packages | Trigger / interval | Wire dedup |
| --- | --- | --- | --- |
| Fast vitals | Char.Vitals, Char.Enemy, Group | 2s tick + event pushes (HP/SP change, avatar charge) | delta cache |
| Character sheet | Char.Status, StatusVars, Name, Guilds, Stats/RealStats/MetaStats, Worth, Defences | 2s tick (panel-gated) | delta cache |
| Guild meters | Darkwind.GuildVitals, Darkwind.XPMon | 2s tick | none (always send; tiny payloads) |
| Inventory | Char.Items.List | 3s tick, full-walk diff (`gmcp_compare_mappings`); sends only on change | full-list resend on change |
| Omens / sky / game | Darkwind.Divine, Darkwind.Sky, Game | sub-throttled 5s / 60s / 30s inside the tick; sky also pushes on viewpoint change | delta cache |
| Room / map | Room.Info, Room.Players, MapData2.*, Room.Image, Char.Avatar | movement events (post_move hook), client sync requests | media/viewpoint change checks |
| Chat | Comm.Channel.Text, Comm.Channel.* | per-message events; roster on request | none (event data) |
| Lists | Darkwind.Quests/Achievements/Announcements | event-driven on change + snapshot on subscription enable; legacy (no-subscription) clients now get lists once per registration | none |
| Server-driven UI | Darkwind.Window/IDE/Snoop/Sound/Broadcast/Giphy/LinuxRescue | pure events | n/a |
| Requests (client→server) | Subscriptions, RefreshMedia, Channel.Players, MapData2.Sync/Browse, Completion, Lag.Get, IDE/Window/Snoop ops, Announcements.MarkRead | user/panel actions | n/a |

Verdict on intervals: the cadences were already well-differentiated and the
per-value delta cache keeps the steady-state wire quiet. The intervals were
not the problem — the **delivery loop and dispatch plumbing** were.

## 3. Root causes found (ranked)

### Game side

1. **Fragile per-player call_out chains** (the reported regression).
   `send_character_data`/`send_character_inv` were self-rescheduling
   call_outs per player, tail-rescheduled: any runtime error in any send
   silently killed that player's chain for the session; per LDMud semantics,
   an eval-cost error also discards *other* call_outs scheduled for the same
   second — one player's expensive tick could kill other players' chains at
   random. **Every `update` of telopt_d destroyed all chains** for everyone
   online until relogin — and telopt_d shipped frequently in late June
   (status effects 6/29, XPMon/Lag 6/12-17). Five entry points
   (login ×2, switch, recovery, GMCP negotiation ×2) stacked duplicate
   chains with no dedup. Event-driven GMCP (room, chat) kept working while
   tick-driven panels froze — exactly matching the reports.
2. **`Darkwind.Announcements.MarkRead` missing from the WebSocket dispatch
   switch** (`gmcp_input_text`) — present only in the telnet switch, so
   Darkflow mark-reads were silently dropped at `default:`. The two-switch
   discipline (telnet `telopt.c:1110` + WS `telopt.c:1464`, plus both
   capitalization whitelists) remains a standing footgun for new packages.
3. Legacy clients (never send Subscriptions) received full quest,
   announcement, and achievement lists **every 2s tick** — these packages
   bypass the delta cache.
4. Linkdead bodies kept full payload rebuilds every 2s that
   `gmcp_message` could never deliver (CPU waste, no wire traffic).

### Client side

5. **No per-handler error isolation** in `gmcp.dispatch` — one throwing
   subscriber starved later subscribers (notifications, mention roster) of
   the same frame; the exception was then swallowed upstream.
6. **Character-login subscription sync was skippable** — it only fired from
   the first Char.Vitals/Char.Status/GuildVitals/XPMon frame; a login race
   could leave the session unsubscribed with panels frozen all session.
7. `Char.Stats` / `Char.RealStats` / `Char.Worth` / `Char.Enemy` handlers
   existed but were never declared in `Core.Supports.Set`.

## 4. Fixes shipped

**darkwind-nextgen `3281aab34` (v4.0.0):**
- One daemon-wide GMCP ticker replaces all per-player chains. It reschedules
  itself *before* doing any work; every player's sends are catch-wrapped; a
  low-eval-budget guard defers remaining players to the next tick (rotation
  offset keeps it fair); `reset()` rebuilds the registry on daemon load, so
  a live `update telopt_d` now heals every session within one tick
  (verified live — flow continued across an update with no relogin, exactly
  one ticker call_out existed).
- Registration is idempotent across all five entry points.
- Linkdead players skip payload builds until they're interactive again.
- Legacy list pushes throttled to once per registration/refresh.
- `Darkwind.Announcements.MarkRead` added to the WS switch + whitelist.

**Darkflow `04f9bab` (v1.2.8):**
- Per-handler try/catch in `gmcp.dispatch` (wildcard + package handlers).
- 6s post-connect fallback for the character-login subscription sync.
- The four missing `Char.*` subpackages declared in `Core.Supports.Set`.

## 5. Follow-ups (not shipped)

- **Two-switch dispatch duplication**: factor the telnet and WS inbound
  switches into one shared dispatcher so a package can never again exist on
  only one transport. Mechanical but touches the hottest input path — do it
  as its own change with live soak time.
- GuildVitals/XPMon are always-send every 2s (tiny payloads); could join the
  delta cache if wire noise ever matters.
- Chat dedup in the client is adjacent-only (`panel-manager.js`); non-adjacent
  server double-sends would render twice.
- `Darkwind.MapData 1` is declared by the client but has no handler (v2 only);
  drop the declaration when convenient.
- Reopened panels render cached data immediately and rely on the server's
  newly-enabled-panel snapshot for freshness — correct as long as
  subscriptions flow; consider a staleness stamp per panel if reports recur.
- The telopt_d whole-file reformat in `7ffe27c41` makes `git blame`
  archaeology painful; prefer format-only commits kept separate.

## 6. Connection resilience (added 2026-07-02, v1.2.8)

Follow-on work in `connection.js` / `window-manager.js` / `connection-overlay.js`:

- **Transport ladder.** Connects try wss → ws → telnets → telnet (telnet
  rungs bridge through the `/proxy` endpoint). The user's protocol selection
  seeds the ladder; a failure *before open* advances one rung; a successful
  open resets to the top. Plain `ws` is skipped on https pages (mixed
  content). Logic in `buildTransportLadder`, unit-tested in
  `test/connection-transport.test.mjs`.
- **Smart auth modal.** Login/charselect/newchar modals carry a live
  connection strip (green Connected / amber spinner Reconnecting / red
  Disconnected), survive disconnects (`resetAll({keepAuth:true})`) instead of
  being yanked, drive `ensureConnected()` themselves when the session is
  down, and preserve typed form values when the next connection's login
  window replaces them. Submits on a half-dead socket are caught by
  `expectInboundWithin(8s)` — no server response forces a reconnect (dead
  TCP keeps readyState OPEN for minutes and auth submits never tripped the
  command-burst stall detector).
- **Reconnect overlay.** A centered spinner modal with attempt count,
  transport, live countdown, Retry-now and Stop-trying buttons replaces the
  terminal "Reconnecting in Ns..." spam. Shows only after the session has
  been connected once and never fights the auth modal (which has its own
  strip). `window 'online'` events skip the remaining backoff.
- Debug hook: `window.connDebug.drop()` simulates a connection drop;
  `connDebug.retryNow()` / `connDebug.ensureConnected()` drive recovery.
