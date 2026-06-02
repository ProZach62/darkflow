# Darkwind GMCP Package Index

This index lists every custom `Darkwind.*` package currently advertised by the Darkflow client handshake in [`public/js/gmcp.js`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/public/js/gmcp.js). Darkflow identifies itself as the `Core.Hello.client`; the custom protocol package names remain `Darkwind.*`.

## Advertised Packages

| Package | Support String | Messages | Direction | Source Doc | Implementation Note |
|---------|----------------|----------|-----------|------------|---------------------|
| `Darkwind.Char.Avatar` | `Darkwind.Char.Avatar 1` | (root) | Server -> Client | [`docs/gmcp-darkwind-char-avatar.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-char-avatar.md) | One-shot URL push; refresh requested via `Darkwind.Client.RefreshMedia`. |
| `Darkwind.Room.Image` | `Darkwind.Room.Image 1` | (root) | Server -> Client | [`docs/gmcp-darkwind-room-image.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-room-image.md) | Client preloads via probe `Image` element; cleared on room change. |
| `Darkwind.Divine` | `Darkwind.Divine 1` | (root) | Server -> Client | [`docs/gmcp-darkwind-divine.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-divine.md) | Replaces full omens/patron snapshot each push. |
| `Darkwind.Sky` | `Darkwind.Sky 1` | (root) | Server -> Client | [`docs/gmcp-darkwind-sky.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-sky.md) | Periodic time/lunar sync; client animates locally between pushes. |
| `Darkwind.Client` | `Darkwind.Client.Subscriptions 1`, `Darkwind.Client.NAWS 1` | `Subscriptions`, `NAWS`, `RefreshMedia` | Client -> Server | [`docs/gmcp-darkwind-client.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-client.md) | `Subscriptions` and `NAWS` are advertised; `RefreshMedia` is gated by media packages. |
| `Darkwind.Window` | `Darkwind.Window 1` | `Open`, `Update`, `Close`, `Submit`, `Action`, `Closed` | Mixed | [`docs/gmcp-darkwind-window.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-window.md) | `Update` supports only the renderer operations implemented in the current client. |
| `Darkwind.Snoop` | `Darkwind.Snoop 1` | `Open`, `Append`, `Status`, `Close`, `Command`, `Stop`, `Closed` | Mixed | [`docs/gmcp-darkwind-snoop.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-snoop.md) | Builder-only graphical snoop modal with target/self command execution. |
| `Darkwind.IDE` | `Darkwind.IDE 2` | `Open`, chunked open/save, `SaveResult`, `Close` | Mixed | [`docs/gmcp-darkwind-ide.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-ide.md) | Large files use chunked transfers; `Close` includes `{ "path": ... }`. |
| `Darkwind.MapData` | `Darkwind.MapData 1` | `RoomUpdate`, `Area`, `Update`, `Sync`, `RoomCoords` | Mixed | [`docs/gmcp-darkwind-mapdata.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata.md) | `Update` and `Sync` are live client behavior; `RoomCoords` is implemented as an active correction path, not reserved. |
| `Darkwind.MapData2` | `Darkwind.MapData2 1` | `Current`, `Area`, `Update`, `Sync` | Mixed | [`docs/gmcp-darkwind-mapdata-v2.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata-v2.md) | Server-authoritative graph; coordinates are display metadata and V1 remains fallback. |
| `Darkwind.Completion` | `Darkwind.Completion 1` | `Request`, `Result` | Mixed | [`docs/gmcp-darkwind-completion.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-completion.md) | Ambiguous results are shown to the user only on repeated Tab for the same line and cursor state. |
| `Darkwind.Quests` | `Darkwind.Quests 1` | `List`, `Active`, `Update`, `Complete` | Server -> Client | [`docs/gmcp-darkwind-quests.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-quests.md) | Payload shapes are documented from current client usage because no prior in-repo spec existed. |
| `Darkwind.Achievements` | `Darkwind.Achievements 1` | `List`, `Update` | Server -> Client | [`docs/gmcp-darkwind-achievements.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-achievements.md) | `Update` merges per-family entries by `id` and replaces `summary` wholesale. |
| `Darkwind.Announcements` | `Darkwind.Announcements 1` | `List`, `New`, `Update`, `State`, `MarkRead` | Mixed | [`docs/gmcp-darkwind-announcements.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-announcements.md) | `List` is the login snapshot; read/archive changes now use targeted `Update` payloads. |
| `Darkwind.Giphy` | `Darkwind.Giphy 1` | `Show` | Server -> Client | [`docs/gmcp-darkwind-giphy.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-giphy.md) | Transient overlay; gated by the `giphy` feature flag in `Darkwind.Client.Subscriptions`. |
| `Darkwind.Sound` | `Darkwind.Sound 1` | (root) | Server -> Client | [`docs/gmcp-darkwind-sound.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-sound.md) | Toolbar audio widget; player-controlled volume, mute, category filtering, and loop stop handling. |

## Message Catalog

| Message | Direction | Documented In |
|---------|-----------|---------------|
| `Darkwind.Char.Avatar` | Server -> Client | [`docs/gmcp-darkwind-char-avatar.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-char-avatar.md) |
| `Darkwind.Room.Image` | Server -> Client | [`docs/gmcp-darkwind-room-image.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-room-image.md) |
| `Darkwind.Divine` | Server -> Client | [`docs/gmcp-darkwind-divine.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-divine.md) |
| `Darkwind.Sky` | Server -> Client | [`docs/gmcp-darkwind-sky.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-sky.md) |
| `Darkwind.Client.Subscriptions` | Client -> Server | [`docs/gmcp-darkwind-client.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-client.md) |
| `Darkwind.Client.NAWS` | Client -> Server | [`docs/gmcp-darkwind-client.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-client.md) |
| `Darkwind.Client.RefreshMedia` | Client -> Server | [`docs/gmcp-darkwind-client.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-client.md) |
| `Darkwind.Window.Open` | Server -> Client | [`docs/gmcp-darkwind-window.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-window.md) |
| `Darkwind.Window.Update` | Server -> Client | [`docs/gmcp-darkwind-window.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-window.md) |
| `Darkwind.Window.Close` | Server -> Client | [`docs/gmcp-darkwind-window.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-window.md) |
| `Darkwind.Window.Submit` | Client -> Server | [`docs/gmcp-darkwind-window.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-window.md) |
| `Darkwind.Window.Action` | Client -> Server | [`docs/gmcp-darkwind-window.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-window.md) |
| `Darkwind.Window.Closed` | Client -> Server | [`docs/gmcp-darkwind-window.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-window.md) |
| `Darkwind.Snoop.Open` | Server -> Client | [`docs/gmcp-darkwind-snoop.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-snoop.md) |
| `Darkwind.Snoop.Append` | Server -> Client | [`docs/gmcp-darkwind-snoop.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-snoop.md) |
| `Darkwind.Snoop.Status` | Server -> Client | [`docs/gmcp-darkwind-snoop.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-snoop.md) |
| `Darkwind.Snoop.Close` | Server -> Client | [`docs/gmcp-darkwind-snoop.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-snoop.md) |
| `Darkwind.Snoop.Command` | Client -> Server | [`docs/gmcp-darkwind-snoop.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-snoop.md) |
| `Darkwind.Snoop.Stop` | Client -> Server | [`docs/gmcp-darkwind-snoop.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-snoop.md) |
| `Darkwind.Snoop.Closed` | Client -> Server | [`docs/gmcp-darkwind-snoop.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-snoop.md) |
| `Darkwind.IDE.Open` | Server -> Client | [`docs/gmcp-darkwind-ide.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-ide.md) |
| `Darkwind.IDE.Save` | Client -> Server | [`docs/gmcp-darkwind-ide.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-ide.md) |
| `Darkwind.IDE.SaveResult` | Server -> Client | [`docs/gmcp-darkwind-ide.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-ide.md) |
| `Darkwind.IDE.Close` | Client -> Server | [`docs/gmcp-darkwind-ide.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-ide.md) |
| `Darkwind.MapData.RoomUpdate` | Client -> Server | [`docs/gmcp-darkwind-mapdata.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata.md) |
| `Darkwind.MapData.Area` | Server -> Client | [`docs/gmcp-darkwind-mapdata.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata.md) |
| `Darkwind.MapData.Update` | Server -> Client | [`docs/gmcp-darkwind-mapdata.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata.md) |
| `Darkwind.MapData.Sync` | Client -> Server | [`docs/gmcp-darkwind-mapdata.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata.md) |
| `Darkwind.MapData.RoomCoords` | Server -> Client | [`docs/gmcp-darkwind-mapdata.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata.md) |
| `Darkwind.MapData2.Current` | Server -> Client | [`docs/gmcp-darkwind-mapdata-v2.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata-v2.md) |
| `Darkwind.MapData2.Area` | Server -> Client | [`docs/gmcp-darkwind-mapdata-v2.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata-v2.md) |
| `Darkwind.MapData2.Update` | Server -> Client | [`docs/gmcp-darkwind-mapdata-v2.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata-v2.md) |
| `Darkwind.MapData2.Sync` | Client -> Server | [`docs/gmcp-darkwind-mapdata-v2.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-mapdata-v2.md) |
| `Darkwind.Completion.Request` | Client -> Server | [`docs/gmcp-darkwind-completion.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-completion.md) |
| `Darkwind.Completion.Result` | Server -> Client | [`docs/gmcp-darkwind-completion.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-completion.md) |
| `Darkwind.Quests.List` | Server -> Client | [`docs/gmcp-darkwind-quests.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-quests.md) |
| `Darkwind.Quests.Active` | Server -> Client | [`docs/gmcp-darkwind-quests.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-quests.md) |
| `Darkwind.Quests.Update` | Server -> Client | [`docs/gmcp-darkwind-quests.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-quests.md) |
| `Darkwind.Quests.Complete` | Server -> Client | [`docs/gmcp-darkwind-quests.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-quests.md) |
| `Darkwind.Achievements.List` | Server -> Client | [`docs/gmcp-darkwind-achievements.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-achievements.md) |
| `Darkwind.Achievements.Update` | Server -> Client | [`docs/gmcp-darkwind-achievements.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-achievements.md) |
| `Darkwind.Announcements.List` | Server -> Client | [`docs/gmcp-darkwind-announcements.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-announcements.md) |
| `Darkwind.Announcements.New` | Server -> Client | [`docs/gmcp-darkwind-announcements.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-announcements.md) |
| `Darkwind.Announcements.Update` | Server -> Client | [`docs/gmcp-darkwind-announcements.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-announcements.md) |
| `Darkwind.Announcements.State` | Server -> Client | [`docs/gmcp-darkwind-announcements.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-announcements.md) |
| `Darkwind.Announcements.MarkRead` | Client -> Server | [`docs/gmcp-darkwind-announcements.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-announcements.md) |
| `Darkwind.Giphy.Show` | Server -> Client | [`docs/gmcp-darkwind-giphy.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-giphy.md) |
| `Darkwind.Sound` | Server -> Client | [`docs/gmcp-darkwind-sound.md`](/Users/jasonalexander/coding/darkwind/play.darkwind.ai/docs/gmcp-darkwind-sound.md) |
