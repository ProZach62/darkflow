# Darkwind.Cyberware GMCP Protocol Specification

`Darkwind.Cyberware` provides the installed-implant panel, on-demand implant
details, and asynchronous schematic images.

## Support String

```text
Darkwind.Cyberware 1
```

## Messages

| Message | Direction | Purpose |
| --- | --- | --- |
| `Darkwind.Cyberware.List` | Server -> Client | Replace installed cyberware and strain state |
| `Darkwind.Cyberware.Details` | Client -> Server | Request detail for one installed implant |
| `Darkwind.Cyberware.Details` | Server -> Client | Return description, scan report, and image state |
| `Darkwind.Cyberware.Image` | Server -> Client | Push an asynchronously generated implant image |

## List

```json
{
  "installed": [
    {
      "id": "eyes+neural",
      "name": "Ares targeting suite",
      "family": "optics",
      "type": "targeting",
      "grade": "military",
      "locations": ["eyes", "neural"],
      "strain": 4,
      "visible": 0,
      "durability": 92
    }
  ],
  "strain": { "used": 4, "total": 12 }
}
```

The entire panel snapshot is replaced. `id` is the stable request key. The
list renders `name`, `grade`, `locations`, and `strain`; the remaining fields
are retained in live GMCP state for extensions and inspection.

## Details Request And Response

Selecting an implant sends:

```text
Darkwind.Cyberware.Details {"id":"eyes+neural"}
```

The normal response is:

```json
{
  "id": "eyes+neural",
  "name": "Ares targeting suite",
  "description": "A compact targeting implant.",
  "scan": "Strain: 4\nGrade: military",
  "image": "https://example.invalid/cyberware.png",
  "image_pending": 0
}
```

If the implant is no longer installed, the server may return
`{ "id": "...", "error": "That implant is no longer installed." }`.
The client applies a response only when its `id` matches the open modal.

## Image

When image generation completes after the details response:

```json
{
  "id": "eyes+neural",
  "url": "https://example.invalid/cyberware.png"
}
```

The update is ignored unless the matching implant modal remains open.
