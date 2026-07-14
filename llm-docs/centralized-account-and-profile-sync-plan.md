# Darkflow Centralized Accounts and Game Profiles Plan

Status: Proposed

## Executive summary

Darkflow should move from an anonymous, browser-local client to an authenticated service with three distinct concepts:

1. A **Darkflow account** owns identity, security settings, sessions, and game profiles.
2. A **MUD directory entry** describes a game and its verified connection endpoints.
3. A **game profile** represents one character or play identity on one MUD and owns every saved Darkflow customization for that identity.

A user signs in to Darkflow, searches the MUD directory or chooses a saved game profile, and presses **Play**. Darkflow loads that profile's settings before opening a game connection. Profiles on the same MUD remain independent, so two characters can have different themes, layouts, aliases, triggers, timers, functions, highlights, sounds, and key mappings.

The recommended target architecture uses PostgreSQL for durable account and profile data, opaque server-side sessions in secure cookies, optimistic versioning for synchronized profile documents, and an authenticated same-origin game relay. The relay is required for true one-click login with stored MUD credentials because it lets Darkflow use a credential without returning the plaintext secret to browser JavaScript.

This is a substantial product and platform change. It should be shipped in independently usable phases, with local data retained as a recovery cache until migration is proven safe.

## Product decisions

- [ ] Require a valid Darkflow session before the profile hub or game client can be used.
- [ ] Treat one game profile as one character/play identity, not merely one MUD connection.
- [ ] Allow any number of game profiles for the same MUD.
- [ ] Store all user-selected client customizations at game-profile scope.
- [ ] Keep account scope limited to identity, security, sessions, and profile metadata.
- [ ] Keep transient runtime state and rebuildable game caches out of synchronized customization data.
- [ ] Make manual MUD login the safe default.
- [ ] Make stored MUD credentials opt-in and never return a saved password through an API.
- [ ] Preserve JSON export/import as a user-controlled backup and portability mechanism.
- [ ] Keep the existing vanilla ES-module frontend and CommonJS/Express runtime initially; do not combine this work with a framework migration.

## Current-state findings

Darkflow is not currently an account-backed application:

- `server.js` serves static assets, configuration, version and ping endpoints, an optional MCP endpoint, and a WebSocket-to-TCP/TLS bridge. It has no application database, user model, session middleware, or authorization layer.
- `public/index.html` boots directly into the game client. Host, port, protocol, and Connect are exposed in the main toolbar.
- `public/js/app.js` initializes settings and automation managers synchronously from browser storage before loading `/config.json`. A configured host causes an immediate connection.
- `public/js/connection.js` connects directly from the browser for `ws`/`wss` targets. It uses the server's `/proxy?host=...&port=...&tls=...` bridge only for `telnet`/`telnets` targets.
- The current `/proxy` accepts a caller-supplied host and port. That cannot remain an unrestricted public relay once accounts and saved endpoints exist.
- `public/js/settings-manager.js` already has a useful versioned export envelope containing settings, aliases, highlights, triggers, timers, functions, panel state, and sound settings.
- Aliases, highlights, triggers, timers, and functions already have connection-target scopes such as `wss://host:port`. Those scopes are the main input to legacy migration, but they are not sufficient as the future identity because two characters on the same endpoint currently share one scope.

### Existing persisted data inventory

| Current data | Current location | Future owner | Migration treatment |
| --- | --- | --- | --- |
| General settings, theme, custom themes, key mappings, completion options | `darkwind-client-settings` | Game profile | Copy into each selected/imported profile |
| Aliases and automation variables | `darkwind-client-aliases-v1`, endpoint-scoped | Game profile | Map each endpoint scope to one or more profiles |
| Highlights | `darkwind-client-highlights-v1`, endpoint-scoped | Game profile | Map endpoint scope to profile |
| Triggers | `darkwind-client-triggers-v1`, endpoint-scoped | Game profile | Map endpoint scope to profile |
| Timers | `darkwind-client-timers-v1`, endpoint-scoped | Game profile | Map endpoint scope to profile; never sync running countdown state |
| Functions | `darkwind-client-functions-v1`, endpoint-scoped | Game profile | Map endpoint scope to profile |
| Classic/floating panel layout | `darkwind-panel-state` | Game profile | Import as the first desktop layout variant |
| Sound volume and category settings | `darkwind-sound-settings` | Game profile | Copy into profile |
| Command history | `darkwind-cmd-history` | Device-local, keyed by profile | Do not upload by default because it can contain private commands |
| Map areas | IndexedDB `darkflow-maps`, with localStorage fallback | Rebuildable MUD/world cache | Keep local; do not treat as user customization |
| Last protocol | `darkflow-protocol` | Replaced by MUD endpoint/profile | Import only when constructing a custom endpoint |
| Settings-window position and automation-editor UI state | Browser localStorage | Device-local UI state, keyed by profile where helpful | No mandatory server migration |
| Debug flags and expanded/collapsed transient controls | Browser localStorage | Device-local | No server migration |
| Terminal scrollback, current timer handles, GMCP state, open login windows | Memory | Runtime only | Never persist |

The distinction matters: "server-side settings" should mean durable user intent, not uploading terminal transcripts, private command history, live timer handles, or server-rebuildable map data.

## Target user experience

### Registration and login

1. Visiting Darkflow shows an account gate instead of connecting to a MUD.
2. A user can register with email, display name, and password.
3. Email verification is required before storing MUD credentials. Playing with manual MUD login may be allowed immediately if desired by policy.
4. Login creates an opaque server-side session and an `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
5. The account screen supports password reset, password change, session/device revocation, data export, and account deletion.

### Profile hub

After authentication, the user sees:

- Recently played game profiles.
- All saved game profiles, grouped or filterable by MUD.
- A MUD search field with filters for name, genre, codebase, protocol, and availability when data exists.
- A **Create custom connection** option for unlisted MUDs, subject to endpoint validation.
- A clear **Play** action on each profile.
- Profile actions: rename, duplicate, edit connection/login behavior, export, and delete.

Creating a profile requires:

- MUD selection.
- Profile display name, such as `Darkwind - Sully`.
- Optional character name.
- Endpoint selection when the MUD has more than one supported endpoint.
- Login mode: manual, username assist, or secure automatic login when an adapter supports it.
- Optional cloning from an existing profile on the same or another MUD.

### Starting play

Pressing **Play** must perform this ordered transition:

1. Flush any pending writes from the previously active profile.
2. Disconnect and tear down profile-specific runtime state.
3. Fetch the selected profile and all synchronized document revisions.
4. Hydrate settings, automations, sounds, and layout in memory.
5. Initialize/reconcile managers against the active profile ID.
6. Create a short-lived authorized play session.
7. Open a same-origin WebSocket relay using that play session.
8. Apply the profile's login strategy.
9. Mark the profile as recently played after the upstream connection succeeds.

The terminal must never render briefly with another profile's settings, and timers from one profile must never survive a switch to another.

## Target architecture

```text
Browser
  |-- HTTPS JSON API ---------------------------|
  |-- Same-origin authenticated WebSocket ------| Darkflow service
                                                 |-- PostgreSQL
                                                 |-- session/auth service
                                                 |-- profile sync service
                                                 |-- credential vault
                                                 |-- MUD directory service
                                                 |-- game relay
                                                          |
                                                          |-- WS/WSS MUD
                                                          |-- Telnet/TLS MUD
```

### Why the authenticated relay is the target

The browser currently connects directly to WebSocket MUDs. That remains possible for manual-login profiles, but it is incompatible with the strongest version of one-click login:

- Returning a saved MUD password to JavaScript exposes it to XSS, extensions, browser debugging, and accidental logs.
- Browser WebSockets cannot attach an arbitrary authorization header to a third-party connection.
- A server-side relay can authorize the profile, resolve a vetted endpoint, decrypt the secret only in server memory, run a narrowly defined login adapter, and then discard the plaintext.
- A single same-origin relay path provides consistent behavior for WS, WSS, telnet, and TLS telnet MUDs.

The tradeoff is operational: Darkflow becomes part of every live game session and must handle bandwidth, connection limits, abuse prevention, observability, and availability. This tradeoff should be accepted explicitly before implementing credential-backed automatic login.

### Recommended server layout

Keep `server.js` as the process entry point but split responsibilities before adding account features:

```text
server.js
server/
  app.js
  config.js
  db.js
  migrations/
  middleware/
    authenticate.js
    csrf.js
    rate-limit.js
    validate.js
    errors.js
  routes/
    auth.js
    account.js
    muds.js
    profiles.js
    profile-state.js
    play-sessions.js
  services/
    auth-service.js
    session-service.js
    mud-directory-service.js
    endpoint-validation-service.js
    profile-service.js
    profile-state-service.js
    credential-vault.js
    migration-service.js
  relay/
    relay-server.js
    upstream-ws.js
    upstream-telnet.js
    login-adapters.js
  jobs/
    directory-refresh.js
    session-prune.js
    deletion-prune.js
```

Use PostgreSQL as the first durable store. It fits relational ownership and authorization, supports JSONB for versioned client documents, and provides transactional migration and backup behavior. Redis is not required for the first single-instance release; introduce it only when play-ticket consumption, rate limiting, or pub/sub must span multiple Darkflow instances.

## Data model

Use opaque UUIDs for externally visible IDs. Every user-owned query must include `user_id` authorization in the database predicate; fetching by profile ID and checking ownership later is not sufficient.

### `users`

- `id`
- `email_normalized` (unique)
- `email_display`
- `display_name`
- `password_hash`
- `status` (`pending`, `active`, `locked`, `deleting`)
- `email_verified_at`
- `password_changed_at`
- `created_at`, `updated_at`, `last_login_at`

Darkflow account passwords are one-way hashed, never encrypted. Use Argon2id with parameters reviewed against the deployment environment and current OWASP guidance.

### `user_sessions`

- `id`
- `user_id`
- `token_hash` (unique; store only a hash of the opaque cookie token)
- `created_at`, `last_seen_at`, `expires_at`, `revoked_at`
- `user_agent_summary`
- optional privacy-limited IP metadata

Session IDs contain no user information. Rotate the session at login and other privilege changes. Password reset revokes existing sessions according to the selected policy.

### `email_tokens`

- `id`, `user_id`, `purpose`
- `token_hash`
- `expires_at`, `consumed_at`, `created_at`

Use separate one-time purposes for email verification and password reset. Do not automatically log the user in after password reset.

### `muds`

- `id`, `slug`, `name`
- `short_description`, `description`, `website_url`
- `genre`, `codebase`, `language`, `tags`
- `visibility` (`public`, `private`, `unlisted`)
- `status` (`pending`, `active`, `offline`, `rejected`)
- `source` and `source_external_id`
- `created_by_user_id` for custom entries
- `reviewed_at`, `last_checked_at`, `created_at`, `updated_at`

### `mud_endpoints`

- `id`, `mud_id`
- `transport` (`ws`, `wss`, `telnet`, `telnets`)
- `host`, `port`, `path`
- `priority`, `is_default`, `is_enabled`
- `supports_gmcp`, `supports_mssp`
- `last_verified_at`, `last_failure_at`, `verification_status`
- resolved-address audit metadata that contains no credentials

Directory search runs against Darkflow's own database. External catalogs may feed a background import, but user searches must not depend on a third party being online.

Grapevine is a reasonable optional seed/synchronization source because its documented `games/status` data includes display name, description, homepage, connection types, and online player counts. Treat it as an importer, not as Darkflow's canonical database or availability dependency.

### `game_profiles`

- `id`, `user_id`, `mud_id`, `endpoint_id`
- `display_name`
- `character_name`
- `login_mode` (`manual`, `username_assist`, `automatic`)
- `is_favorite`, `sort_order`
- `last_played_at`
- `created_at`, `updated_at`, `deleted_at`

Do not enforce uniqueness on `(user_id, mud_id)`. At most, enforce a user-friendly uniqueness rule on active profile display names per user.

### `profile_documents`

Store each customization domain as its own independently versioned document:

- `profile_id`
- `kind` (`settings`, `aliases`, `highlights`, `triggers`, `timers`, `functions`, `panels`, `sound`)
- `schema_version`
- `revision`
- `data` (JSONB)
- `checksum`
- `updated_at`, `updated_by_session_id`
- unique `(profile_id, kind)`

Separate documents reduce conflict scope and allow a layout edit to sync without rewriting every automation. The service validates and normalizes each kind; it must not accept arbitrary unbounded JSON.

### `profile_document_revisions`

Keep a bounded recovery history:

- `profile_id`, `kind`, `revision`
- `data`, `checksum`
- `created_at`, `created_by_session_id`

Retain enough revisions to recover accidental overwrites while bounding storage. User-facing restore can be added after core sync is stable.

### `profile_secrets`

- `id`, `profile_id`, `kind`
- `ciphertext`, `nonce`, `auth_tag`
- `key_version`
- `created_at`, `updated_at`, `last_used_at`
- unique `(profile_id, kind)`

MUD credentials must be decryptable for login and therefore cannot use password hashing. Encrypt them with authenticated encryption and a key stored outside the database, preferably a managed KMS/envelope-encryption design. API reads return only metadata such as `configured: true` and a masked username hint. Plaintext passwords are never returned, logged, exported, or placed in browser storage.

### `profile_login_steps`

- `profile_id`
- ordered, validated declarative steps
- adapter type and adapter schema version
- timeouts and failure policy

Do not allow arbitrary JavaScript. Begin with vetted adapters:

- Manual login: no credential automation.
- Username assist: prefill/show the character name but ask the user for the password.
- Generic text prompts: bounded prompt-match/send steps with no secret returned to the browser.
- Darkwind server-window adapter: a purpose-built adapter for the existing structured login flow.

### `play_sessions`

- `id`, `user_id`, `profile_id`, `endpoint_id`
- `ticket_hash`
- `created_at`, `expires_at`, `consumed_at`, `closed_at`
- connection outcome and non-sensitive diagnostics

Tickets are short lived, single use, profile-bound, and redacted from logs.

## API surface

All JSON routes live under `/api`. State-changing requests require an authenticated session, same-origin checks, and CSRF protection. Return consistent error objects with a request ID, stable error code, user-safe message, and optional field errors.

### Authentication and account

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/account/sessions`
- `DELETE /api/account/sessions/:sessionId`
- `POST /api/account/export`
- `DELETE /api/account`

### MUD directory

- `GET /api/muds?q=&genre=&codebase=&transport=&cursor=`
- `GET /api/muds/:mudId`
- `POST /api/muds/custom`
- `POST /api/muds/:mudId/endpoints` for a user's private custom entry or authorized admin flow
- Administrative review and import routes must be separately authorized and should not share normal-user permissions.

### Profiles

- `GET /api/profiles`
- `POST /api/profiles`
- `GET /api/profiles/:profileId`
- `PATCH /api/profiles/:profileId`
- `POST /api/profiles/:profileId/duplicate`
- `DELETE /api/profiles/:profileId`
- `PUT /api/profiles/:profileId/credential`
- `DELETE /api/profiles/:profileId/credential`
- `PUT /api/profiles/:profileId/login-steps`

### Profile state and sync

- `GET /api/profiles/:profileId/state` returns all document kinds with schema versions and revisions.
- `GET /api/profiles/:profileId/state/:kind`
- `PUT /api/profiles/:profileId/state/:kind` requires the client's base revision or `If-Match` value.
- `GET /api/profiles/:profileId/state/:kind/revisions` can be deferred until recovery UI exists.
- `POST /api/profiles/:profileId/import` validates an existing Darkflow export and returns a dry-run summary before commit.
- `GET /api/profiles/:profileId/export` omits credentials and transient data.

### Play

- `POST /api/play-sessions` accepts a profile ID, not a caller-controlled host or port.
- `DELETE /api/play-sessions/:playSessionId` explicitly stops a pending/current relay.
- `WSS /play?ticket=...` consumes the short-lived ticket and opens the authorized upstream target.

Never accept a raw target host from the play WebSocket request. The server resolves the endpoint through the authorized profile and directory record.

## Client refactor

### New modules

- `public/js/api-client.js`: same-origin fetch wrapper, CSRF handling, normalized errors, and request cancellation.
- `public/js/auth-manager.js`: session bootstrap, login/register/reset/logout, and auth-state events.
- `public/js/account-shell.js`: auth gate and account menu.
- `public/js/profile-hub.js`: saved profiles, MUD search, create/edit/duplicate/delete flows.
- `public/js/profile-context.js`: the single active profile ID and immutable MUD endpoint metadata.
- `public/js/profile-store.js`: normalized in-memory profile documents and manager adapters.
- `public/js/sync-manager.js`: debounced writes, revisions, mutation IDs, conflicts, retries, and page-hide flush.
- `public/js/legacy-migration.js`: local-storage discovery and migration wizard.
- `public/js/play-session-manager.js`: play-ticket creation and relay URL lifecycle.

### Existing modules to change

- `public/index.html`: add account gate, profile hub, profile editor, account menu, loading/error states, and accessible focus management. Keep the terminal shell hidden until a profile is hydrated.
- `public/js/app.js`: replace immediate manager initialization/auto-connect with an asynchronous boot state machine: `session -> hub -> profile hydration -> play`.
- `public/js/state.js`: add account, active profile, directory, hydration, and sync status. Never put passwords or session tokens in this state object.
- `public/js/connection.js`: connect through `play-session-manager` and same-origin `/play`; remove caller-controlled profile host/port from normal play flow.
- `public/js/settings-manager.js`: build/apply profile documents instead of writing global localStorage; retain export/import using the current `darkwind-client-settings-export` envelope and introduce a backward-compatible new format version.
- Alias, highlight, trigger, timer, and function managers: accept a profile-store adapter, expose deterministic `load`, `snapshot`, and change events, and stop deriving identity from `protocol://host:port` after migration.
- `public/js/panel-manager.js`: hydrate and save profile layout documents. Add layout schema metadata so positions can be clamped or adapted on different viewport sizes.
- `public/js/sound-manager.js`: persist through the profile store.
- `public/js/input.js`: key local command history by profile ID, keep it local by default, and clear in-memory history during profile switches.
- `public/js/map-storage.js`: key local map caches by stable MUD/world identity, not game-profile identity, so multiple characters can share rebuildable map data without sharing customizations.

### Storage adapter rule

Managers should not know whether data came from PostgreSQL, an IndexedDB recovery cache, or an imported file. Each manager receives normalized data and emits mutations through the profile store. This prevents another round of direct localStorage coupling.

During transition, local storage becomes a write-through recovery cache:

- Server state is canonical after successful account migration.
- The browser retains the most recently acknowledged profile documents for fast boot and disaster recovery.
- Pending mutations use an IndexedDB outbox with profile ID, document kind, base revision, mutation ID, and payload.
- Authentication/session secrets are never stored in localStorage or IndexedDB.
- The UI visibly distinguishes **Saved**, **Saving**, **Offline changes**, and **Conflict**.

## Synchronization and conflict behavior

### Write protocol

1. A manager changes a profile document in memory.
2. `sync-manager` records a durable local outbox mutation.
3. Writes are debounced by document kind, with an immediate flush for explicit Apply/Save actions.
4. The client sends `baseRevision`, `mutationId`, `schemaVersion`, and normalized data.
5. The server updates only when `baseRevision` matches and returns the new revision/checksum.
6. The client marks the outbox entry acknowledged and updates its cache.
7. Duplicate mutation IDs are idempotent.

### Conflicts

Do not silently use last-write-wins for automations.

- A revision mismatch returns `409` with the current server revision and document.
- For scalar settings, perform a three-way field merge when local and remote changed different keys.
- For automation arrays, merge disjoint stable item IDs. If the same item changed on both devices, show a conflict dialog with local/server versions and choices to keep local, keep server, or duplicate.
- For layouts, retain both variants when they represent different viewport/layout classes; otherwise ask which layout to keep.
- Never merge running timer state; only timer definitions synchronize.

A simpler first release may enforce one active editor lease per profile, but it must fail visibly rather than overwrite another device. Optimistic revisions remain the long-term model.

## Game relay and endpoint security

The existing open `/proxy?host=&port=` design must be retired or locked down as part of this work.

### Relay handshake

1. Authenticated client calls `POST /api/play-sessions` with a profile ID.
2. Server verifies account ownership, profile status, endpoint status, account limits, and credential/login-mode eligibility.
3. Server creates a short-lived single-use ticket.
4. Browser opens same-origin `WSS /play?ticket=...`.
5. Relay validates the request Origin, consumes the ticket, rechecks the account session, and resolves the endpoint from the database.
6. Relay opens the upstream connection with transport-specific limits.
7. Relay periodically revalidates the session and closes immediately on logout/revocation.

### Network protections

- Allow only endpoints that passed server-side validation.
- Resolve DNS on the server, reject loopback/private/link-local/multicast/reserved/cloud-metadata ranges, and defend against DNS rebinding by validating and dialing a pinned resolved address.
- Restrict destination ports by policy; exceptions require review.
- Apply per-account and per-IP connection, byte, message-size, and rate limits.
- Validate WebSocket `Origin` against an exact configured allowlist.
- Disable WebSocket compression unless explicitly needed and reviewed.
- Bound all pre-negotiation GMCP queues, login buffers, prompt matching, and reconnect loops.
- Do not log game commands, passwords, session IDs, play tickets, or full output.
- Preserve the current telnet/GMCP parsing behavior with transport-level tests.

These controls follow the relevant OWASP guidance for WebSocket security and SSRF prevention:

- https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

## Authentication and secret security

- Hash Darkflow account passwords with Argon2id; never encrypt or log them.
- Use long opaque session IDs generated with a cryptographically secure RNG and store only their hashes server-side.
- Send session IDs only in `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Do not store JWTs, session IDs, or refresh tokens in browser storage.
- Require HTTPS for every authenticated page and WSS for the Darkflow relay in production.
- Use CSRF tokens plus strict Origin checks for state-changing API routes.
- Rate-limit registration, login, verification, reset, credential changes, and play-session creation.
- Use generic login/reset responses to reduce account enumeration.
- Reauthenticate before displaying session lists, changing email/password, changing stored MUD credentials, exporting account data, or deleting the account.
- Revoke relevant sessions on password reset and close their active game relays.
- Encrypt MUD secrets with authenticated encryption and an independently managed/versioned key. Define rotation and emergency-revocation procedures before launch.
- Return only `credentialConfigured`, timestamps, and masked non-secret metadata to clients.
- Exclude secrets from backups exported to users, application logs, analytics, crash reports, database query logs, and profile revision history.
- Add a Content Security Policy and remove/avoid runtime third-party script execution on authenticated pages wherever possible. The current runtime-loaded editor dependencies need explicit review because XSS becomes credential-impacting after accounts exist.
- Add email verification and secure password reset before public registration. Add MFA/passkeys as a follow-up, not as a prerequisite for the first account release.

Reference guidance:

- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

## Legacy migration

Migration must be explicit, reversible, and profile-aware.

### Discovery

- Detect the current Darkflow export-compatible keys and IndexedDB cache.
- Build the same normalized payload used by the existing settings export.
- Enumerate unique endpoint scope keys across aliases, highlights, triggers, timers, and functions.
- Show the user what was found before uploading anything.

### Wizard

For each legacy endpoint scope:

1. Match it to a verified directory endpoint or create a private custom MUD record.
2. Ask whether to create one or several character profiles for that endpoint.
3. Let the user choose which profile receives the existing endpoint-scoped automations.
4. Let the user duplicate global settings/layout/sound to all new profiles or choose a subset.
5. Show a dry-run summary with item counts.
6. Create profiles and documents in one server transaction where practical.
7. Fetch the result back and verify checksums before marking migration complete.

### Safety rules

- Download a pre-migration JSON backup automatically or prominently offer it.
- Do not delete local data after upload.
- Mark local migration with the account ID and migration version only after server verification.
- If a different Darkflow account signs into the same browser, never auto-import another user's local data without explicit confirmation.
- Preserve stable automation IDs so cross-references among aliases, triggers, timers, and functions survive.
- Keep the existing export format importable indefinitely. A future format may add per-profile metadata, but old exports remain valid.

## Phased implementation checklist

### Phase 0 - Architecture contracts and threat model

- [ ] Record architectural decisions for PostgreSQL, server-side sessions, profile-document sync, and relay scope.
- [ ] Define profile document JSON schemas and maximum sizes.
- [ ] Define which state is profile, account, device-local, runtime, and rebuildable cache.
- [ ] Define supported login modes and explicitly exclude arbitrary login JavaScript.
- [ ] Threat-model account takeover, XSS, CSRF, CSWSH, SSRF, DNS rebinding, credential leakage, cross-profile data bleed, malicious imports, and relay abuse.
- [ ] Decide whether credential-free direct WS/WSS connections remain temporarily available after login or whether all play traffic moves to the relay at once.
- [ ] Define privacy policy, data retention, account deletion, backup retention, and acceptable-use rules for the relay.

Exit criteria: approved schemas, threat model, ownership matrix, and relay decision.

### Phase 1 - Backend foundation

- [ ] Split the current `server.js` into testable app, route, service, and relay modules without changing current behavior.
- [ ] Add validated environment configuration.
- [ ] Add PostgreSQL connection management and SQL migrations.
- [ ] Add request IDs, structured redacted logs, centralized errors, body limits, security headers, and health/readiness endpoints.
- [ ] Update Docker/Coolify configuration for `DATABASE_URL`, application origin, mail delivery, encryption key/KMS configuration, and migration execution.
- [ ] Add backup and restore verification for PostgreSQL before storing user data.

Exit criteria: production can deploy the database-backed skeleton with no user-facing behavior change.

### Phase 2 - Darkflow account system and auth gate

- [ ] Implement users, email tokens, and server-side sessions.
- [ ] Implement register, verify, login, logout, forgot/reset password, password change, and session revocation.
- [ ] Add auth, rate-limit, CSRF, validation, and authorization middleware.
- [ ] Add the account gate and session bootstrap to the frontend.
- [ ] Prevent game connection initialization until authenticated.
- [ ] Add account/security UI with accessible keyboard and error behavior.
- [ ] Close active play connections when their session is revoked.

Exit criteria: an unauthenticated user cannot reach a playable client or authorized API, and session/security tests pass.

### Phase 3 - MUD directory and profile hub

- [ ] Create MUD, endpoint, and game-profile tables and APIs.
- [ ] Seed Darkwind and a small reviewed catalog.
- [ ] Implement local directory search with pagination and filters.
- [ ] Add a background importer interface; implement Grapevine import only after source terms and update behavior are reviewed.
- [ ] Implement private custom MUD entries and endpoint verification.
- [ ] Build profile create/edit/duplicate/delete and recent/favorite UI.
- [ ] Replace toolbar host/port as the normal starting flow with the profile hub.
- [ ] Retain an advanced custom-connection path through a profile, not an anonymous raw target field.

Exit criteria: users can register, search/select a MUD, create multiple character profiles on one MUD, and choose a profile to play.

### Phase 4 - Authenticated play sessions and relay

- [ ] Replace the open host/port proxy contract with profile-authorized play sessions.
- [ ] Add WS/WSS upstream support alongside current telnet/TLS telnet support.
- [ ] Add exact Origin validation, session revalidation, logout closure, single-use tickets, and endpoint pinning.
- [ ] Add SSRF and DNS-rebinding defenses.
- [ ] Add connection/message/byte/rate limits and safe diagnostics.
- [ ] Preserve binary GMCP and text framing for all four transports.
- [ ] Update `connection.js` to obtain and consume play sessions.
- [ ] Add relay load, failure, reconnect, and security tests.

Exit criteria: every supported transport can connect through an authenticated profile without accepting an arbitrary target from the browser.

### Phase 5 - Server-side profile customization sync

- [ ] Implement profile documents, revisions, schemas, normalization, and size limits.
- [ ] Add `profile-store` and `sync-manager` with revisions, checksums, mutation IDs, outbox, and status UI.
- [ ] Refactor settings, alias, highlight, trigger, timer, function, sound, and panel managers away from direct localStorage persistence.
- [ ] Make profile switching flush, tear down, hydrate, and reinitialize in the required order.
- [ ] Key command history locally by profile and keep it out of server sync by default.
- [ ] Keep maps as a shared local MUD/world cache.
- [ ] Add multi-device conflict behavior and recovery revisions.
- [ ] Retain import/export for the active profile.

Exit criteria: changes made on one device appear on another after profile load, and no customization crosses profile boundaries.

### Phase 6 - Legacy browser-data migration

- [ ] Implement legacy data discovery and dry-run counts.
- [ ] Map endpoint scopes to directory MUDs and per-character profiles.
- [ ] Preserve automation IDs and references.
- [ ] Upload transactionally, fetch back, and verify checksums.
- [ ] Preserve a local/exported backup and support retry.
- [ ] Test empty, corrupt, partial, multi-endpoint, large, and repeated migrations.

Exit criteria: an existing Darkflow user can sign up and move all supported customizations without data loss or accidental duplication.

### Phase 7 - Encrypted MUD credentials and automatic login

- [ ] Implement the credential vault with key versioning and rotation procedures.
- [ ] Add reauthentication for adding, replacing, and deleting MUD credentials.
- [ ] Implement credential metadata-only APIs.
- [ ] Implement manual and username-assist modes first.
- [ ] Add bounded generic text-login steps.
- [ ] Add a purpose-built Darkwind structured-login adapter.
- [ ] Ensure credentials are decrypted only for an authorized live play session and cleared from references immediately after use.
- [ ] Add secret-leak scanning tests for API responses, logs, exports, errors, revisions, and browser storage.
- [ ] Add failed-login disable/backoff behavior so bad saved credentials do not loop against a MUD.

Exit criteria: supported profiles can log in with one click while the browser never receives the stored password.

### Phase 8 - Operational hardening and staged rollout

- [ ] Add metrics for auth outcomes, sync latency/conflicts, relay concurrency/bytes, endpoint failures, migration outcomes, and credential-adapter failures without sensitive payloads.
- [ ] Add admin tools for directory moderation, endpoint verification, user lockout review, and abuse response.
- [ ] Add account export/deletion and retention jobs.
- [ ] Run security review and dependency review.
- [ ] Load-test API sync and concurrent relay sessions.
- [ ] Run backup restore, encryption-key rotation, session invalidation, and rollback drills.
- [ ] Launch to staff accounts, then invited existing users, then public registration.
- [ ] Keep legacy read/recovery support through a published deprecation window.
- [ ] Remove or permanently disable the anonymous open proxy.

Exit criteria: public launch criteria, rollback thresholds, support playbook, and incident procedures are approved.

## Test plan

### Unit tests

- Normalization and size limits for every profile document kind.
- Password hashing/verification and token hashing.
- Session creation, rotation, expiry, revocation, and account deletion behavior.
- Endpoint/IP classification including IPv4, IPv6, redirects, DNS changes, and reserved ranges.
- Credential encryption/decryption, tamper rejection, and key-version rotation.
- Login-step parsing, bounds, timeouts, and secret placeholder handling.
- Three-way profile document merge behavior.
- Legacy scope-to-profile mapping and stable automation IDs.

### API integration tests

- Every profile route rejects unauthenticated, wrong-user, deleted-profile, and malformed requests.
- Profile ownership is enforced in database predicates.
- CSRF and Origin checks cover every state-changing route.
- Revision mismatch produces deterministic `409` responses.
- Duplicate mutation IDs are idempotent.
- Exports contain expected state and never contain secrets.
- Password reset and account deletion revoke the required sessions.

### Relay tests

- WS, WSS, telnet, and TLS telnet framing.
- Text and binary GMCP forwarding.
- Unauthorized/missing/expired/reused tickets.
- Wrong Origin and revoked session.
- Private/reserved destination rejection and DNS rebinding.
- Oversized frames, floods, connection limits, idle timeouts, and upstream failure.
- Logout and session expiration close the relay.
- Logs and errors remain free of game commands and secrets.

### Browser end-to-end tests

- Register, verify, login, reset, and logout.
- Search directory, create profiles, duplicate a profile, and play.
- Create two profiles on the same MUD with visibly different settings, layout, and automations.
- Edit on device A and hydrate on device B.
- Produce and resolve a same-document conflict.
- Switch profiles while timers and pending writes exist.
- Migrate a real legacy export with multiple endpoint scopes.
- Manual, username-assist, and supported automatic login.
- Keyboard, screen-reader, mobile, reconnect, and failure-state behavior.

## Deployment and rollback

### Required production configuration

- `DATABASE_URL`
- `APP_ORIGIN`
- session lifetime and cookie configuration
- outbound email provider configuration
- credential encryption/KMS configuration and key version
- endpoint allow/deny policy and connection limits
- log redaction and retention configuration
- optional directory importer credentials

### Rollout controls

- Feature flags for account gate, directory, profile sync, relay-only play, legacy migration, and credential automation.
- A read-only maintenance mode that preserves account login and export access.
- A kill switch for credential automation independent of manual play.
- A kill switch for custom/unlisted endpoints independent of curated directory play.
- Database migrations that are backward compatible until the new version is stable.
- No rollback may require deleting synchronized profile data.

## Acceptance criteria

- [ ] A user must authenticate to Darkflow before starting a MUD connection.
- [ ] A user can search the directory and create a saved game profile.
- [ ] A user can create at least two profiles for one MUD and play either one.
- [ ] Each profile has independent settings, themes, custom themes, key mappings, aliases, variables, highlights, triggers, timers, functions, sound settings, and layouts.
- [ ] A profile loaded on a second device receives the last acknowledged server state.
- [ ] Pending/offline/conflicting writes are visible and never silently discarded.
- [ ] Switching profiles cannot leak automations, variables, command history, timers, layout, or credentials.
- [ ] Existing local customizations can be migrated with a dry run, backup, verification, and retry.
- [ ] Manual play works without storing a MUD password.
- [ ] Supported automatic login never sends the stored MUD password to browser JavaScript.
- [ ] Account passwords are securely hashed; MUD secrets are separately encrypted.
- [ ] Session/auth tokens and MUD secrets never enter localStorage, IndexedDB, logs, exports, analytics, or profile revision history.
- [ ] The relay cannot connect to an arbitrary caller-supplied or private-network endpoint.
- [ ] Logout/session revocation closes associated live play connections.
- [ ] Users can export profile data, revoke sessions, remove saved credentials, and delete their account.

## Recommended implementation order

Do not begin by replacing localStorage calls one at a time. First establish the account/profile identity model and asynchronous boot sequence. The dependency order is:

1. Architecture contracts and threat model.
2. Database and auth foundation.
3. Directory and profile hub.
4. Authorized play sessions and relay.
5. Profile store and manager adapters.
6. Legacy migration.
7. Credential vault and automatic login.
8. Operational hardening and public rollout.

This order produces usable checkpoints, keeps credentials out of the earliest release, and avoids binding synchronized data to the current endpoint-only scope that cannot distinguish two characters on one MUD.
