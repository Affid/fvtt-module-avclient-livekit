# Handoff: Modular A/V

This is for a new Claude Code session that will build **Modular A/V**, a new
family of Foundry VTT voice and video modules, **in a new repository**, run
locally (WSL) with its own Foundry VTT and communication servers. It sums up
what we learnt building the Discord-style fork of the LiveKit AVClient module
(this repository, `Affid/fvtt-module-avclient-livekit`, up to release
`0.6.8-krisp.14`), the licensing rules for the new code, the module family,
naming rules, the credentials model, the contract with Foundry's own A/V
code, the plugin API, a proposed architecture, what to avoid, and milestones.
It already includes the findings of an independent design review. Read it
fully before writing code.

## 1. Goal

A Foundry VTT (v14+) voice and video system made of modules:

- **`modular-av`** ("Modular A/V — voice & video"), the core: a **headless
  foundation**, as small as it can be while doing everything that more than
  one module would otherwise have to write. It owns the Foundry integration
  (including the camera dock host, see §3), credentials and identity, the
  session (connecting, recovering from lost connections, who is who, the
  true mute/deafen state), the local media pipeline, audio playback, and the
  **extension points** every other module plugs into: a state store,
  commands, media attachment, and declared contributions. It has **no
  styled UI of its own**: with only the core and a service module
  installed, Foundry's own camera dock and settings work, plus a minimal
  plain status (notifications, a player-list badge) so the guarantees below
  still hold.
- **UI modules** that give it a face, built on the core's API rather than
  inside it: `modular-av-dock`, the Discord-like camera dock, voice panel
  and settings window (the recommended one, what the fork's UI becomes),
  and later others that show cameras in quite different ways, e.g.
  `modular-av-tokens` with cameras on the players' tokens.
- **Service modules**, one per communication service, each installed only if
  wanted and tested on its own: `modular-av-livekit` (self-hosted LiveKit and
  LiveKit Cloud), `modular-av-p2p` (plain WebRTC, no server, small tables),
  `modular-av-jitsi`. The GM picks the service per world, so the table isn't
  tied to LiveKit Cloud and can use what suits its players. Services are
  thin **media transports**; identity, permissions and shared state go over
  Foundry (see "Control plane over Foundry").
- **Effect modules** for the players' microphone and camera, added or removed
  as wanted: `modular-av-mic-denoise` (noise cancellation models),
  `modular-av-cam-background` (background blur and replacement), later
  voice effects and filters. They run on the local tracks before they are
  handed to the service, so they work with any service that accepts tracks.
  Service-specific extras are their own modules extending that service, e.g.
  `modular-av-livekit-krisp` (Krisp on LiveKit Cloud).
- **Theme modules** that change how a UI module looks, named after that UI:
  `modular-av-dock-scifi`, `modular-av-dock-fantasy`, `modular-av-dock-vines`
  (each camera in a frame of vine leaves in a corner of the screen),
  bringing the call into the game. The Discord-like look is the dock's
  default. Each player picks a theme, with a default set by the GM.
- An **external call** mode (`modular-av-embed`: a Jitsi Meet / Whereby /
  similar page in an iframe) is a shallow option for later. It is not a
  service: the core can't mute, process or identify media inside another
  site's iframe, so none of the guarantees apply, and the UI says so.

Table features to plan for (not all in the first release): a "you're
speaking while muted" warning (the core watches the raw mic while muted),
join/leave and mute sounds, showing the character's name or portrait
instead of the player's, a clear "no microphone/camera permission" state,
P2P reusing Foundry's own TURN settings, a one-click import of the old
module's server settings, and a spectator/streamer view.

And everything is **light and robust**: it recovers from lost connections by
itself, never shows a state it isn't in (muted, blurred), never exposes a
service's secret to players, and costs little CPU/GPU when features are off.

**First release, kept small on purpose** until the API settles: `modular-av`,
`modular-av-livekit` (+ `-krisp`), `modular-av-p2p`, `modular-av-dock`,
`modular-av-mic-denoise`, `modular-av-cam-background`. Jitsi, themes, the
scattered layout, `modular-av-tokens` and the external call mode come after.

## 2. Licensing: MIT, written clean

**Decision: the new repository and all its modules are licensed under MIT**,
with Affid as the copyright holder, and must contain **no code under the
Hippocratic License 2.1**.

Background: this repository is a fork of `bekriebel/fvtt-module-avclient-livekit`
(© 2021 Brint E. Kriebel / bekit, LLC), licensed under the Hippocratic License
2.1. That licence requires its notice on every copy of upstream code, keeps
upstream code under its terms (human-rights conditions, arbitration) even
inside modified versions, and isn't an OSI open-source licence. Writing the
new modules clean keeps them entirely free of it. Rules (this is not legal
advice):

1. **Never copy upstream code**, not even parts: every file that existed at
   upstream commit `258d14a` — `src/LiveKitClient.ts`, `LiveKitAVClient.ts`,
   `LiveKitAVConfig.ts`, `LiveKitBreakout.ts`, `avclient-livekit.ts`,
   `src/utils/*`, `types/avclient-livekit.d.ts`, `vite.config.ts`, the
   upstream parts of `public/css/avclient-livekit.css`,
   `templates/`, the README and images. Reading them to understand behaviour
   is fine (ideas and lessons aren't covered by copyright); write the new
   code from the design in this document.
2. **Never copy devnagui's code** (upstream PR #107):
   `src/NoiseSuppressorFilter.ts` and the first noise model menu were
   contributed under the Hippocratic License. Write the noise-model effect
   fresh on top of `@sapphi-red/web-noise-suppressor` (MIT), or ask devnagui
   to relicense.
3. **Code written in Affid's sessions may be carried over** and relicensed
   under MIT: the files that didn't exist upstream and aren't devnagui's —
   `src/ui/**` (including `src/ui/dock/**`), `src/VoiceActivityGate.ts`,
   `public/worklets/voice-activity-gate.js`, `src/KrispNoiseFilter.ts`,
   `src/UserAudioMixer.ts`, `src/VoiceControls.ts`, `src/VideoBackground.ts`,
   `src/MaskSmoother.ts`, and the reconnect logic inside `LiveKitClient.ts`
   (`reconnectLater`, `reconnectNow`, `cancelReconnect` — rewrite it in the
   new structure rather than lifting it out of an upstream file). Before
   carrying a file over, check it has no pasted upstream snippets
   (`LiveKitCameraViews.ts` and `CameraViewDecorator.ts` mirror upstream
   behaviour; rewrite anything doubtful). Carry over the `--lk-*` design
   tokens and our CSS rules, not the upstream CSS around them.
4. **New ids and names** (see "Naming"): never `avclient-livekit` or
   "LiveKit AVClient", and new README text and images.
5. **Third-party code keeps its notices** in a `THIRD-PARTY-NOTICES.md` per
   module, from day one. These licences only ask for attribution:
   `@sapphi-red/web-noise-suppressor` and its RNNoise/Speex/GTCRN builds
   (MIT, BSD-3-Clause; depend on the npm package and copy its files at build
   time rather than vendoring them), MediaPipe runtime and selfie models
   (Apache-2.0, per the model cards), `livekit-client` and
   `@livekit/track-processors` (Apache-2.0). `@livekit/krisp-noise-filter` is
   not open source (`"license": "SEE LICENSE IN
https://livekit.io/legal/terms-of-service"`): keep it in its own module,
   `modular-av-livekit-krisp`, so every other zip holds only MIT/Apache/BSD
   code, and check LiveKit's terms allow redistributing it before
   publishing that module.
6. Foundry's own licence for module developers applies to every module, as
   usual.

## 3. The module family and plugin API

### Naming

Rules:

1. **Family prefix**: every Foundry package id starts with `modular-av`; the
   core is bare `modular-av`. Titles: "Modular A/V — voice & video" for the
   core, "Modular A/V: LiveKit", "Modular A/V: Dock", … for the rest (as of
   this writing, neither `modular-av` on foundryvtt.com nor `modular-av` /
   `@modular-av` on npm is taken; register them early).
2. **An extension takes its parent's id as prefix**: themes of the dock are
   `modular-av-dock-<theme>`, the Krisp add-on of the LiveKit module is
   `modular-av-livekit-krisp`. No `ui-` or `fx-` kind tokens ("FX" reads as
   canvas visual effects to Foundry users).
3. **Player-facing words**: services by the service's name (`livekit`,
   `p2p`, `jitsi`), effects by the device they affect (`mic-…`, `cam-…`),
   UIs by what they show (`dock`, `tokens`). The kind is machine-readable in
   `module.json`: `flags["modular-av"].kind` is `service`, `effect`, `ui` or
   `theme`.
4. **No trademarks** in ids or titles (no "Discord"; "Discord-like" only in
   descriptions if at all).
5. **One word per concept**, the same in ids, code, UI and docs:
   **service** (not provider), **effect**, **surface**, **contribution**,
   **command**, **participant** in code and **player** in the UI.
6. **Packages**: workspace directory = module id without `modular-av-`
   (`core/` for the core); npm name `@modular-av/<dir>`. Libraries
   (`api`, `kit`, `testing`) have no Foundry id.
7. **Releases**: tag `<module-id>-v<semver>` (e.g.
   `modular-av-livekit-v1.2.0`; no `/` or `@`), asset `<module-id>.zip`,
   a stable manifest URL per module (see "Releases").
8. **JavaScript-facing names** use `modularAV`: hooks
   `modularAV.<lowerCamelEvent>` (`modularAV.register`, `modularAV.ready`);
   each module's API on `game.modules.get("<module-id>").api`.
9. **Foundry-facing namespaces** use the module id: settings
   `<module-id>.<lowerCamelKey>` (registered by that module), flags scope =
   module id, the core's multiplexed socket `module.modular-av`, and the
   language file's root key = the exact module id (`"modular-av-livekit":
{ … }`), which also avoids the string-vs-parent key clash that makes
   Foundry drop a whole language file.
10. **CSS**: semantic tokens shared by every UI (defined by the core's UI
    contract) are `--mav-<token>` (`--mav-speaking`, `--mav-muted`); a UI's
    own tokens and classes carry its short name (`--mav-dock-radius`,
    `.mav-dock`, `.mav-dock-tile`, `.mav-dock-panel`). States are boolean
    attributes (`data-speaking`, `data-muted`, `data-deafened`), so a tile
    can be speaking and muted at once; enums only for real enums
    (`data-video="on|off|blocked"`, `data-layout`, `data-anchor`).

| Old name (fork or earlier draft)              | Name                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| core                                          | `modular-av`, dir `core/`, `@modular-av/core`                                                 |
| `api/`, `kit/`, `testing/`                    | `@modular-av/api`, `@modular-av/kit`, `@modular-av/testing`                                   |
| `modular-av-ui-dock`                          | `modular-av-dock`                                                                             |
| `modular-av-ui-scifi` / `-ui-fantasy`         | `modular-av-dock-scifi` / `modular-av-dock-fantasy`                                           |
| `modular-av-ui-dis`                           | none: the dock's default look                                                                 |
| vine-leaf frames                              | `modular-av-dock-vines`                                                                       |
| cameras on tokens                             | `modular-av-tokens` (themes `modular-av-tokens-<theme>`)                                      |
| Krisp inside the LiveKit module               | `modular-av-livekit-krisp`                                                                    |
| `modular-av-fx-noise`                         | `modular-av-mic-denoise`                                                                      |
| `modular-av-fx-background`                    | `modular-av-cam-background`                                                                   |
| `modular-av-embed` (as a service)             | `modular-av-embed`, kind `ui` (external call)                                                 |
| tag `livekit-v1.2.0`                          | `modular-av-livekit-v1.2.0`                                                                   |
| provider, `registerProvider`                  | service, `api.services.register`                                                              |
| `registerAudioEffect` / `registerVideoEffect` | `api.effects.register({ kind: "audio" \| "video", … })`                                       |
| `registerSurface`, `contribute`               | `api.surfaces.register`, `api.contributions.add`                                              |
| `api.actions`                                 | `api.commands`                                                                                |
| `ProviderPlugin` / `Provider`                 | `ServiceDefinition` / `ServiceConnection`                                                     |
| `--lk-*`, `.livekit-*`                        | `--mav-*` (shared), `--mav-dock-*`, `.mav-dock-*`                                             |
| `[data-state="speaking"]`                     | `[data-speaking]`                                                                             |
| dock's `registerTheme` / `registerLayout`     | `dock.themes.register` / `dock.layouts.register` on `game.modules.get("modular-av-dock").api` |

### Repository layout

One repository, **`modular-av`**, as a pnpm workspace (monorepo):

```
modular-av/
  packages/
    api/              → @modular-av/api: types only, shared by all packages
    core/             → "modular-av" (headless, no styled UI)
    kit/              → @modular-av/kit: pure UI helpers UI modules bundle
    testing/          → @modular-av/testing: fake Foundry, mock service,
                        contract suites, Playwright harness
    livekit/          → "modular-av-livekit"
    livekit-krisp/    → "modular-av-livekit-krisp"
    p2p/              → "modular-av-p2p"
    dock/             → "modular-av-dock"
    mic-denoise/      → "modular-av-mic-denoise" (RNNoise/Speex/GTCRN; the gate stays in core)
    cam-background/   → "modular-av-cam-background" (blur/replace, MediaPipe)
    later: jitsi/, dock-scifi/, dock-fantasy/, dock-vines/, tokens/, embed/
  tools/              → token server template (see "Credentials")
  docs/
```

One repository keeps the API, its types and every module in step (a change to
the API and all its users in one commit) and shares tooling; each module
still has its own `module.json`, zip and manifest URL. Separate repositories
per module are possible later if others maintain them.

### Releases and versions

- **Stable manifest URL per module.** GitHub's `releases/latest/download/…`
  doesn't work in a monorepo (the "latest" release is whichever module
  released last). Publish each module's current `module.json` to a fixed
  URL, e.g. GitHub Pages `https://<owner>.github.io/modular-av/<module-id>/module.json`,
  updated by the release workflow; `download` points at that release's
  `<module-id>.zip`.
- **The API version is the core's module version** (no separate number), so
  Foundry's own dependency check (`relationships.requires[].compatibility`)
  is meaningful; an API break is a new major of the core. The same holds
  for the dock and its themes.
- **Release in lockstep until 1.0** (changesets "fixed" group: every module
  gets the same version), then independently.
- The core's `module.json` **recommends** `modular-av-dock` and
  `modular-av-livekit`, and **conflicts** with `avclient-livekit` and other
  A/V client modules. At `setup`, the core also checks that
  `CONFIG.WebRTC.clientClass` is still its own (Foundry doesn't stop another
  module from replacing it) and warns the GM if not.

### What goes where

The rule that keeps the core lean without anyone rewriting anything:

- **If it has a look, it goes in a UI module** (markup, styles, layout, UI
  wording). The one exception is the core's minimal plain status, needed so
  its guarantees hold with no UI module.
- **If two modules would need it and it has no look, it goes in the core**
  (state, rules, media, Foundry plumbing, and anything that must exist only
  once per page: the Picture-in-Picture window, the popover layer, the
  style mirror for the Picture-in-Picture document) **or in `kit`** (pure
  helpers with no shared state: `el()`, tile fitting, drag and resize,
  keeping things on screen, popover positioning, level meter drawing). UI
  modules bundle `kit` (only what they use), so it costs the core nothing
  and nobody writes the same helper twice.
- **If it is heavy, optional or service-specific, it is a plugin.**
- **Guarantees live in the core, not in a UI**: mute in every state,
  fail-closed camera effects, "open mic" when the gate can't run, the GM's
  blocks, reconnecting. UI modules can't get them wrong, because none of
  them implements them.

**Trust model**: every installed module is same-origin JavaScript with full
access to Foundry and the browser; the core can't defend against a hostile
module. The guarantees protect against bugs, races and misbehaving
services, not against malicious add-ons. The core freezes its API object
and records which module issued each command (for diagnostics).

So the core contains: the Foundry A/V client class (Foundry's single
plug-in point) and the camera dock host, credentials and identity, the
session state machine and reconnect policy, the local media pipeline
(devices, effect chain, voice gate, push to talk), **audio playback**
(per-player volume, deafen, output device — calls must be heard even with
no UI module), the control plane over Foundry's socket, settings, the plugin
registries and the extension points below. It contains no dock, panel or
settings window and no styles beyond its plain status.

### Credentials and identity

The fork (like upstream) keeps the LiveKit API key and secret in a **world
setting** (`liveKitConnectionSettings`), and every player's browser signs
its own access token with them (`src/utils/auth.ts`). Foundry sends world
settings to every client, so **any player can read the secret** from the
console and mint tokens for any room or identity in that LiveKit project
(admin rights, recording, impersonation, a LiveKit Cloud bill). The fork
also logs the signed token at debug level. Never repeat this.

The core provides one `auth` facility that services use:

1. **GM relay (default)**: the secret is stored only on the GM's device (a
   `client`-scope setting, i.e. that browser's local storage, entered in
   the GM's settings). A player's core asks for a join token over the
   core's socket; the GM's core checks who is asking (Foundry's server
   authenticates the sender's user id on socket messages), and the service
   module signs a short-lived token **for that user id only**, bound to the
   world's room, with publish rights from Foundry's `BROADCAST_AUDIO` /
   `BROADCAST_VIDEO` permissions and no admin rights. Tokens are refreshed
   before they expire and on every reconnect. Cost: a GM must be online for
   players to join or reconnect (normal for a session; with several GMs, any
   one may answer). Show "waiting for the GM" plainly.
2. **Token server**: for tables that want to join without a GM online, the
   service calls a URL that returns tokens after checking a per-world shared
   key or Foundry identity; `tools/` has a tiny template (Node, Cloudflare
   Worker).
3. **Insecure dev mode**: the secret in a world setting, labelled as
   insecure, only for local servers (`livekit-server --dev`).

Identity is always the Foundry **user id** (from the token, not
self-asserted metadata). "The same user in two tabs" is a core policy (the
newer tab wins; the older one shows "joined elsewhere" and stops
reconnecting). Display names shown in the UI come from Foundry's user (and
character), never from what a service reports, and are always set as text
(Foundry renders `data-tooltip` as HTML).

**GM authority**: "block audio/video" is Foundry's own
`permissions.BROADCAST_AUDIO/BROADCAST_VIDEO` on the user (server-stored,
only GMs can change it; Foundry's own dock writes it). The core enforces it
in three layers: the token grants no publish right, a service with a
`moderation` capability is told to mute/remove server-side (LiveKit's
server API, with the GM-held secret), and every receiving core refuses to
play or attach media from a blocked player (which is how P2P enforces it).

### Control plane over Foundry

Everything that isn't media goes over Foundry, the same for every service:
tokens, blocks, deafened, effect badges ("blur on"), "speaking while
muted", and later breakout membership — via the core's socket, User
documents and `user.broadcastActivity` (Foundry already broadcasts
`av.muted/hidden` this way). Services stay thin media transports, which
keeps LiveKit, P2P and Jitsi alike and their contract tests small. P2P
signalling also uses the core's socket. Deafened stays self-reported
(nothing else is possible); the UI must not present it as enforced.

### Contract with Foundry's own A/V code

Foundry already has an A/V system the core must fit into rather than
duplicate (checked against the v14 client source):

- **Lifecycle**: `init` → `setup` → `initializeRTC()` (creates `AVMaster`,
  which constructs the client class and calls its `connect()` without
  awaiting) → `initializeUI()` (instantiates `CONFIG.ui.webrtc`) → socket
  listeners → `ready`. So the client's `initialize()`/`connect()` run before
  socket listeners exist and before `ready`: a GM-relay token can't be
  fetched inside them.
- **`AVMaster`** runs voice-activity detection (through
  `client.getLevelsStreamForUser`), `broadcast()`, push to talk (the
  `core.pushToTalk` keybinding calls `game.webrtc._onPTTStart`, which does
  nothing unless `connect()` resolved `true`), its own reconnect loop
  (`reestablish()`, every 3 s), and honours `world.mode` (disabled, audio
  only, video only).
- **`AVSettings`** stores `users.<id>.muted/hidden/blocked/volume/popout`,
  `muteAll`, `voice.mode`, push-to-talk settings, `audioSrc`, `videoSrc`,
  `audioSink`, dock position; Foundry's dock buttons write it, and
  `AVMaster.onSettingsChanged` turns changes into `toggleAudio`/`toggleVideo`
  calls on the client.

The contract:

| Concern                                           | Rule                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store of record                                   | `AVSettings` for everything Foundry already models (mute, hide, block, volume up to 100%, devices, voice mode, push-to-talk key and delay, `muteAll`). The core's store derives from it and writes back through it. Only what Foundry lacks lives in core settings: deafen, gate sensitivity, effects, volume above 100%. |
| `connect()`                                       | Starts the session state machine and **resolves `true` at once**, so push to talk works and `reestablish()` never runs; the real join waits for `ready` and a token, then follows the core's own reconnect policy.                                                                                                        |
| `toggleAudio` / `toggleBroadcast` / `toggleVideo` | Become session commands (applied in every connection state).                                                                                                                                                                                                                                                              |
| `world.mode`                                      | The master switch: disabled → the core stays idle; audio-only / video-only → the matching tracks only. A `world.turn` change → reconnect.                                                                                                                                                                                 |
| Voice activity                                    | One detector only. Preferred: the core's gate owns "voice activity" (and the client reports no levels stream for the local user so `AVMaster`'s detector stays idle); verify in milestone 2 that `AVMaster` then never toggles broadcasting by itself.                                                                    |
| Push to talk                                      | Reuse Foundry's `core.pushToTalk` keybinding; never register a second one.                                                                                                                                                                                                                                                |
| Foundry's dock                                    | It plays audio through its own `<video>` elements: give it **video-only** streams, since the core plays audio (otherwise everyone is heard twice), and apply its volume slider through the core.                                                                                                                          |

### Extension points ("plug-holes")

What UI modules build on and other modules plug into; all of it is the
core's public API (versioned with the core), tested with the fake Foundry
and the mock service:

- **Registries** (`api.services`, `api.effects`, `api.surfaces`,
  `api.contributions`): each has `register`/`add`, `list`, `get` and
  `onChange`. Registration is **synchronous inside the `modularAV.register`
  hook** (fired once during `setup`) and closed after it, with a clear error
  for late registration (a plugin that `await`s before registering would
  otherwise silently miss it). Definitions are small; heavy code loads in
  `create()`.
- **State**: one observable store with everything a UI shows — the session
  (status, "waiting for the GM", reconnect attempt and next try, final
  reason), participants (Foundry user, display name, avatar, colour, audio
  and video present, speaking, muted, deafened, blocked, volume, connection
  quality), the local player (input mode, gate open, permissions, each
  effect's state: off, starting, running, failed), devices, and the
  connected service's capabilities. Subscribe with a selector; changes are
  **batched in a microtask** (not per animation frame: hidden tabs pause
  those, and a mute must apply at once); UIs throttle their own rendering.
- **Meters**: mic and remote levels are **not** in the store:
  `api.meters.subscribe(participantId, listener)` runs only while someone
  listens, at a capped rate.
- **Commands** (`api.commands`): everything a UI can do — mute, deafen,
  set a player's volume, input mode and sensitivity, choose devices, turn
  effects on and off, leave, rejoin, reconnect now, GM actions. They return
  when done or throw `{ code, params }` with a default message (UIs may word
  it their own way). A UI never touches the service or tracks.
- **Media attachment**: `api.media.attach(participantId, "camera" |
"screen", element)` puts a participant's video in any element, in
  Foundry's window or the Picture-in-Picture window. The core watches
  visibility (one observer per document) and calls the service's
  `setSubscription`, so hidden videos stop downloading whatever the UI does.
  It returns a detach function but also **cleans up by itself** when the
  element leaves the document (Foundry's dock re-attaches on every render
  and never detaches). UIs never attach audio: the core plays it.
- **Windows and layers**: `api.windows.pip` (request, current owner,
  release, an event when the document changes) and a shared popover layer,
  because a page gets one Picture-in-Picture window at a time and two UI
  modules must not fight over it.
- **Surfaces**, of two kinds:
  - **Exclusive**: `cameras` (where videos are shown, including the
    controls Foundry puts on each camera) and `settings` (the settings
    window). The GM picks the module per world; a player may override
    `cameras` only. Chosen at `setup`, so changing it needs a reload. The
    core always installs **its own thin camera dock host** as
    `CONFIG.ui.webrtc` (a subclass of Foundry's `CameraViews`, because
    `AVMaster` calls `ui.webrtc.render()` and `setUserIsSpeaking()`): with
    no `cameras` surface it behaves like Foundry's dock; with one, it hides
    itself and the surface mounts its own element. So UI modules never
    subclass Foundry classes, and only the core tracks Foundry's UI changes.
    A cameras-on-tokens module therefore never shows cameras twice.
  - **Additive**: player-list badges and menu items, the voice panel and
    other controls; any number of modules may add them.
- **Contributions**: small declared items any module adds and every UI
  renders in its own style: settings sections, **quick controls** (e.g.
  cam-background's "Blur" toggle with a strength slider, mic-denoise's
  model picker), **participant actions** ("Mute for me", GM "Block
  video"), **indicators** (badges, e.g. "blur on", "Krisp"), **status
  rows** (e.g. the service's codec and server region). Each declares an id,
  a label (an i18n key or plain text, never HTML), an icon, where it
  applies, a state selector and a command. A custom render function is
  allowed for the rare case a declaration can't express, and discouraged.
- **Settings**: schemas are Foundry `DataField`s (which
  `game.settings.register` accepts and Foundry renders natively), registered
  by each module **under its own id**. Use `scope: "user"` (new in v14,
  follows the player across devices) for per-player choices such as theme,
  layout and surfaces; `client` for device ids and the GM's secret; `world`
  for the GM's table choices. UI modules render the same schemas in their
  own settings window.
- **Socket**: one multiplexed core socket, `api.socket(channel)`, so plugins
  don't each need `"socket": true`.
- **Assets**: `api.assetUrl(moduleId, path)` resolves worklets, WASM and
  models through Foundry's route prefix.
- **Plain status**: with no UI module filling them, the core shows
  reconnecting, "waiting for the GM", open mic, an effect that failed (camera
  kept off) and deafened through `ui.notifications` and a plain player-list
  badge. Foundry's dock can't show these itself.
- **A UI contract**: what every UI module must show (mute, deafen,
  speaking, blocked, connection state, "open mic", an effect that failed),
  checked by a shared suite in `@modular-av/testing` that every UI module
  runs.

```ts
interface ModularAV {
  version: string; // = the core's module version
  state: Store<AVState>; // get(), subscribe(selector, listener)
  meters: Meters; // subscribe(participantId, listener) while shown
  commands: AVCommands; // setMuted, setDeafened, setVolume, setEffect…
  media: {
    attach(
      id: ParticipantId,
      source: "camera" | "screen",
      el: HTMLVideoElement,
    ): () => void;
  };
  windows: { pip: PipWindowManager };
  services: Registry<ServiceDefinition>;
  effects: Registry<EffectDefinition>;
  surfaces: Registry<SurfaceDefinition>;
  contributions: Registry<Contribution>;
  socket(channel: string): Channel;
  assetUrl(moduleId: string, path: string): string;
}
```

### Plugin interfaces (sketch)

```ts
interface ServiceDefinition {
  id: string; // "livekit"
  label: string;
  settings: SettingsSchema; // world settings (GM) — never secrets
  secrets?: SettingsSchema; // GM-device only (client scope)
  signToken?(request: TokenRequest, secrets: unknown): Promise<string>; // runs on the GM's client
  mediaOwnership: "core" | "service"; // "service": the service makes its own tracks
  create(context: ServiceContext): Promise<ServiceConnection>; // lazy: import() the SDK here
}

interface ServiceConnection {
  readonly capabilities: Observable<ServiceCapabilities>; // reported once connected (e.g. Krisp only on Cloud)
  connect(room: RoomSpec, token: string, signal: AbortSignal): Promise<void>;
  disconnect(reason: "user" | "switching" | "unload"): Promise<void>;
  publish(
    track: MediaStreamTrack,
    source: TrackSource,
  ): Promise<PublishedTrack>;
  replaceTrack(
    published: PublishedTrack,
    track: MediaStreamTrack,
  ): Promise<void>;
  setMuted(published: PublishedTrack, muted: boolean): Promise<void>; // signalling/bandwidth only
  setSubscription(
    participant: ParticipantId,
    source: TrackSource,
    options: { enabled: boolean; maxQuality?: "low" | "medium" | "high" },
  ): void;
  moderation?: {
    forceMute(p: ParticipantId, source: TrackSource): Promise<void>;
    remove(p: ParticipantId): Promise<void>;
  };
  on<E extends keyof ServiceEvents>(
    event: E,
    handler: ServiceEvents[E],
  ): () => void;
  getStats(): Promise<ConnectionStats>;
}

type TrackSource = "microphone" | "camera" | "screen" | "screen-audio";

interface RemoteTrack {
  participant: ParticipantId; // the Foundry user id from the token
  source: TrackSource;
  track: MediaStreamTrack;
}

// ServiceEvents: state ("connected" | "resuming" | "lost" | "failed", with a
// ServiceError), participant joined/left, track added/removed (RemoteTrack),
// speaking (if the service detects it), quality, token expiring.

interface ServiceError {
  code:
    | "auth"
    | "token-expired"
    | "network"
    | "full"
    | "kicked"
    | "duplicate"
    | "room-closed"
    | "unsupported";
  final: boolean; // final reasons stop the core's reconnecting
}

interface EffectDefinition {
  id: string; // "rnnoise", "background"
  kind: "audio" | "video";
  label: string;
  stage?: "denoise" | "voice" | "post"; // audio order: denoise → voice → post → gate
  exclusiveGroup?: string; // e.g. "noise-suppression": one active per group
  settings?: SettingsSchema;
  cost: "light" | "medium" | "heavy"; // shown to players
  isSupported(): boolean;
  create(context: EffectContext): Promise<AudioEffect | VideoEffect>; // lazy
}

interface AudioEffect {
  // An AudioNode chain in the core's capture AudioContext (48 kHz)
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(options: unknown): void;
  dispose(): void;
}

interface VideoEffect {
  // Resolves only after the first processed frame
  start(input: MediaStreamTrack): Promise<MediaStreamTrack>;
  replaceInput(input: MediaStreamTrack): Promise<void>; // camera restart: keep state
  update(options: unknown): void;
  dispose(): void;
}
```

Rules that come with these interfaces:

- **The core owns local tracks.** It acquires devices, runs the effects and
  hands the final track to the service; services must **never stop, clone or
  re-acquire** core tracks. Mute is `track.enabled = false` on the core's
  final track (WebRTC sends silence/black), applied in every connection
  state; `setMuted` only tells the service (signalling, bandwidth).
- **`mediaOwnership: "service"`** (e.g. if lib-jitsi-meet can't take
  outside tracks — check first) shows "this service controls your
  microphone" and disables the gate and effects for it.
- **Reconnect once**: a service reports `resuming` while its own transport
  recovers (LiveKit does for about a minute); the core starts its backoff
  only on `lost`, with a fresh token each attempt.
- **Fail closed, defined**: the camera is published only after
  `VideoEffect.start()` resolved; a core watchdog on frame timestamps
  unpublishes the camera if the effect stalls or throws, never falling back
  to raw video. (Output that runs but is wrong, e.g. a broken mask, can't be
  detected.)
- **Effect chain**: one active effect per `exclusiveGroup` (Krisp, RNNoise
  and the browser's own noise suppression fight each other: the core turns
  the browser's off while one runs). Service-specific effects (Krisp)
  register as normal effects in the core's chain, not on the published
  track after the gate. Video: one active video effect in the first
  release.
- **Speaking**: from the service when it reports it, otherwise computed by
  the core at a low rate.
- **Screen share and a second camera**: `source` covers them; UIs that show
  one video per player show the camera.
- **Breakout rooms** (the fork's `LiveKitBreakout.ts`): out of scope for the
  first release; later a core concept (rooms in state, GM `moveTo(user,
room)`, capability-gated).
- **Lazy services**: Foundry loads every enabled module's code at startup,
  so a service module registers only a small definition and imports its SDK
  in `create()`. A CI bundle-size check enforces this for every plugin.

### `modular-av-dock`: themes and layouts

The dock is the Discord-like UI: it fills the `cameras` and `settings`
surfaces and adds the voice panel and player-list decorations, built with
`kit`. Its themes and layouts are the dock's own API
(`game.modules.get("modular-av-dock").api`, versioned with the dock), not
the core's; another UI module may offer theming differently, or not at all.

Two things are kept apart, because players will want to mix them (a fantasy
look in a plain dock, or the default look in free-floating frames):

- **Layouts** decide where the cameras are: the dock layouts (left, right,
  top, bottom, floating, own window) and a **scattered** layout: every
  camera is its own element, anchored to a corner or edge of the screen (or
  dragged anywhere), with its position and size saved per player (`user`
  scope), and per scene when the GM wants (a portrait by each side of a
  tavern table). More via `dock.layouts.register`; fitting, drag, resize and
  keeping tiles on screen stay in the dock and `kit`.
- **Themes** decide how everything looks: the dock, tiles, voice panel and
  popovers, in any layout. Themes restyle; they don't change behaviour.

What a theme can use, all part of the dock's public API:

- **Design tokens**: every colour, radius, spacing, font, shadow, the
  speaking ring and tile frame as CSS custom properties (`--mav-*` shared,
  `--mav-dock-*` the dock's own). A simple theme only sets tokens.
- **Stable hooks for structure**: documented classes and attributes
  (`.mav-dock`, `.mav-dock-tile`, `.mav-dock-tile-video`,
  `.mav-dock-tile-frame`, `.mav-dock-panel`, `[data-speaking]`,
  `[data-muted]`, `[data-layout="scattered"]`, `[data-anchor="top-left"]`,
  …). Changing these is a breaking change (a major version of the dock).
- **Tile frames**: a frame bigger than the video, e.g. vine leaves
  overflowing its edges, declared rather than scripted: artwork (SVG or a
  9-slice image for `border-image`, so it scales to any tile size), how far
  it reaches past the video on each side (so fitting and on-screen clamping
  allow for it), an optional video shape (oval, arch, shield, via
  `mask-image`/`clip-path`), and variants per anchor (leaves growing from
  the corner the tile sits in) or per state (glowing while speaking,
  greying while muted). Frames never take clicks (`pointer-events: none`)
  except where the dock puts its controls.
- **Optional slots** for anything more: extra elements per tile or in the
  panel that the dock creates on request, rather than themes reaching into
  the DOM.
- A theme registers with `dock.themes.register({ id, label, stylesheet,
frames, preview, suggestedLayout })`; the dock loads only the selected
  theme's stylesheet and assets, scopes them to its UI, and mirrors them
  into the Picture-in-Picture window through the core's style mirror.

Rules for themes (from the UI contract and the dock):

- **Mute, deafen, speaking, blocked and connection state**, and the
  player's name on hover, are always shown; a theme may restyle these
  indicators but not hide them.
- Faces stay visible: a frame may cover at most a set margin of the video,
  and video shapes keep the centre of the picture.
- Text contrast (WCAG AA) and visible focus rings; controls stay reachable
  by keyboard in the scattered layout too.
- Cheap to run: static artwork, animations only on `transform` and
  `opacity`, no per-frame scripts, everything off under
  `prefers-reduced-motion`.
- Scattered tiles never cover Foundry's own controls (sidebar, scene
  controls, hotbar, chat); the dock keeps them clear.

### Testing per module

Three tiers, because Foundry itself is licensed per user and can't be
downloaded in public CI:

1. **Unit tests** (Vitest) with a small **fake Foundry** (`game`, `Hooks`,
   `CONFIG`, settings, socket, users) and the **mock service** (in-memory
   participants, fake tracks, scripted drops, `resuming`/`lost`, token
   expiry) from `@modular-av/testing`. The core's tests need no UI: they
   drive commands and assert on the store.
2. **Browser tests** (Playwright, Chrome's fake devices) on a harness page
   with stubbed Foundry globals: the media pipeline, effects, the dock.
3. **Full Foundry end-to-end** in the local WSL world (or a self-hosted CI
   runner): the `AVMaster` contract, Foundry's dock fallback, real services.

Contract suites in `@modular-av/testing`:

- **Service contract**, against each real server in Docker: connect with a
  relayed token, publish, subscribe, mute in every state, `setSubscription`,
  speaking, a 20 s outage and recovery (one reconnect, not two), token
  expiry, duplicate identity, blocked publisher, leaving on purpose.
- **UI contract**, with the mock service: every required state visible,
  every command reachable by mouse and keyboard, a sample plugin's
  contributions rendered, the Picture-in-Picture window working.
- **Effects**: output runs, CPU budget, fail closed, exclusive groups.
- **Themes**: screenshot baselines for the dock's default theme only; other
  themes get automated checks (indicators visible, contrast, faces not
  covered), since per-theme baselines for every layout × anchor × state
  churn too much.
- Browsers: GPU Chrome first, but also Firefox, Safari and Foundry's
  desktop app (Electron) for what they support (insertable streams, Document
  Picture-in-Picture and screen share differ or are missing there; degrade
  plainly).

## 4. Local environment (WSL)

- **Foundry VTT** (Node.js build) running in WSL2, a test world with a GM
  (and a second GM, to test the token relay with either) and several
  passwordless players (e.g. `Player1`–`Player4`). Install each
  module under development by symlinking its `dist/` into
  `Data/modules/<id>`.
- **Browsers**: a GPU-accelerated Chrome matters (camera effects, Document
  Picture-in-Picture, real frame rates). Driving Windows Chrome over its
  remote debugging port from Playwright in WSL is usually easier than GPU
  Chrome inside WSL:

  ```
  chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\chrome-test\player1
  ```

  Use one browser profile per test user. Chrome's fake media flags help
  automation:

  ```
  --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
  --use-file-for-fake-video-capture=person.y4m
  --use-file-for-fake-audio-capture=speech.wav
  ```

  A still photo gives an identical mask every frame; add noise and slight
  motion (ffmpeg `noise=alls=10:allf=t` and an oscillating `crop`) to test
  segmentation stability.

- **Servers** (Docker):
  - LiveKit: `livekit-server --dev` (keys `devkey` / `secret`) or the Docker
    image; add `--bind 0.0.0.0` for other machines.
  - Jitsi: the official `docker-jitsi-meet` compose setup.
  - TURN: `coturn`, to test restrictive networks.
- **Network impairment** to test reconnecting: Linux `tc netem` (loss, delay,
  outages) in WSL or Docker networks, or Chrome DevTools' network
  conditions/offline via CDP. Test: a 20 s outage, flapping Wi-Fi, a frozen
  main thread (a busy loop in the page), a second tab with the same user,
  the GM going offline (no token relay) and coming back.
- **Test harness**: Playwright scripts that log in N users, wait for
  `game.ready`, drive the UI, take screenshots, read state through the core's
  API, and measure (CDP `Performance.getMetrics`, process memory via
  `/proc/<pid>/smaps_rollup` PSS, long tasks via a `longtask`
  `PerformanceObserver`). Keep it in the repository, not in a scratchpad.

## 5. Architecture of the core

```
  UI modules (dock, tokens…) · themes · plugin contributions
        │ state (subscribe)   ▲ commands   ▲ media.attach
┌───────▼─────────────────────┴────────────┴───────────────────┐
│ Extension points: registries, state store, meters, commands, │
│  media attachment, PiP window manager, surfaces, settings,   │
│  socket, plain status (when no UI module)                    │
├──────────────────────────────────────────────────────────────┤
│ Foundry integration                                          │
│  A/V client class + camera dock host (CONFIG.ui.webrtc),     │
│  AVSettings/AVMaster contract, keybindings,                  │
│  control plane (socket, User permissions, activity)          │
├──────────────────────────────────────────────────────────────┤
│ Credentials and identity                                     │
│  GM token relay / token server / dev mode; user id identity; │
│  GM blocks (token rights, moderation, receiver refusal)      │
├──────────────────────────────────────────────────────────────┤
│ Session (service-independent)                                │
│  Connection state machine (waiting for token, connecting,    │
│  connected, resuming, lost, retrying, left), participants ↔  │
│  Foundry users, mute/deafen/volume, speaking, stats,         │
│  reconnect policy                                            │
├──────────────────────────────────────────────────────────────┤
│ Local media pipeline + audio playback (service-independent)  │
│  mic → denoise → voice → post → gate → final track → service │
│  camera → video effect (watchdog) → final track → service    │
│  remote audio → elements (Web Audio only above 100%) → sink  │
└──────────────────────────────────────────────────────────────┘
```

Principles:

- **The session owns the truth.** UI modules show the state store
  (including "reconnecting", "blur starting", "open mic") and change it
  only through commands; they never assume a state or reach the service.
- **Small and stable API over features**: add to the core only what a
  second module would otherwise duplicate; everything else starts in a
  plugin and moves down only when that is proven.
- **The media pipeline produces plain `MediaStreamTrack`s** (insertable
  streams, AudioWorklets), so any service can publish the result. Keep
  **one capture `AudioContext`** at 48 kHz (RNNoise needs it) for local
  processing, suspended when unused. Play remote audio through media
  elements (Chrome needs remote WebRTC audio attached to an element); a
  separate playback context only while someone is boosted above 100%.
- **Fail closed for privacy.** If a video effect isn't running yet, stalls
  or failed, don't publish raw video (keep the camera off and say so). If
  the voice gate can't run in voice activity mode, show "open mic" plainly.
  Mute is applied to the core's own final track, in every connection state.
- **Never expose secrets to players**: a service's secret lives only on the
  GM's device or a token server.
- **Swap effects atomically** (start the new one, then replace), never
  stop-then-start with raw media in between.
- **Reconnect like Discord**: retry forever with backoff (1, 3, 5, 10, 20,
  then every 30 s) and at once on the browser's `online` event, unless the
  reason is final (left on purpose, joined elsewhere, removed, room closed).
  Start only when the service reports `lost`, not while it is `resuming`.
  Fetch a fresh token and re-apply mute state on every (re)connect.
- **Everything heavy is lazy and opt-in**, and keeps its state across camera
  restarts.

## 6. Lessons learnt

### Foundry VTT v14

- `CONFIG.ui.webrtc` is read in `initializeUI` after `init`: replace the
  camera dock class there. Foundry's `CameraViews._onRender` moves the dock
  element next to `#interface` on **every render** and sets `element.hidden`;
  a custom dock must live with that (or keep its content in a child it can
  move, e.g. to a Picture-in-Picture window).
- ApplicationV2: `window: { positioned: false }` stops Foundry's positioning;
  don't name members `position`/`setPosition` (they collide). Hook names come
  from constructor names, which the bundle minifies.
- Foundry's CSS uses cascade layers: unlayered module CSS wins; use `:where()`
  for zero-specificity resets of Foundry's button styles; Foundry styles
  `.active` buttons, so use your own state classes.
- Tooltips: `data-tooltip` (Foundry renders it as HTML — only put trusted,
  localized text there); `data-tooltip-class` styles them. They only work in
  Foundry's own window.
- AVMaster quirks: `broadcast()` calls `setUserIsSpeaking` on the dock with
  the _intent_ to broadcast, not actual speech; AVMaster toggles audio/video
  when `client.users.<self>.hidden/muted` change; `AVSettings.set` updates
  memory at once and saves with a debounce; a change of `world.turn` makes
  every client reconnect.
- Foundry has a deprecated global `Module` (alias of `foundry.packages.Module`)
  with a setter that stores overrides. Libraries built with Emscripten that
  read a global `Module` (MediaPipe!) break; hide it while they start and
  restore it afterwards.
- The language file must not have a key that is both a string and a parent
  (`a.b` and `a.b.c`): Foundry drops the whole file. Validate at build time.
- Settings scopes: `world` (stored on the server, readable by **every**
  client — never put secrets there; only GMs can write), `user` (new in v14:
  per player, follows them across devices), `client` (this browser only:
  device ids, the GM's secret). A setting's `onChange` already re-renders:
  don't render twice.
- Foundry's server authenticates the sender of socket messages (the user id
  arrives with each message); a GM's client can trust it when deciding who
  gets a token.
- Foundry's `CameraViews` buttons write `AVSettings` and set the `<video>`
  element's volume directly; "block" writes the user's
  `BROADCAST_AUDIO/BROADCAST_VIDEO` permissions. See §3 "Contract with
  Foundry's own A/V code".

### LiveKit (livekit-client 2.19)

- `TrackProcessor`: `init/restart/destroy/processedTrack`. When a processor is
  attached, `LocalTrack.mediaStreamTrack` returns the processed track; the raw
  one is `track.mediaStream.getAudioTracks()[0]`. `setProcessor` initializes
  the new processor before stopping the old (atomic); `stopProcessor()` hands
  the sender the raw track.
- Muting a camera stops the device; unmuting restarts it and calls
  `processor.restart` (destroy + init) — expensive for MediaPipe unless you
  keep its state.
- Code that skips muting unless the room is `Connected` leaves the mic live
  during reconnects. Mute the track in any state and re-apply after
  reconnecting.
- Adaptive stream pauses videos it thinks are hidden; it knows about video
  elements in a **Document Picture-in-Picture** window (keeps them), but not
  about elements in a plain `window.open` pop-up (would pause them).
- LiveKit's own reconnect gives up after about a minute; then
  `RoomEvent.Disconnected(reason)` — nothing reconnects unless you do it. The
  server's `CONNECTION_TIMEOUT` means it stopped hearing the client: a network
  drop, or a main thread frozen for longer than the ping timeout. A player
  with the heavy background model kept timing out like this and had to reload.
- Krisp: only on LiveKit Cloud; it fires `enable-lk-krisp-noise-filter` on its
  processed track and comes back disabled after a restart (re-enable it). Its
  package is 6 MB: import it only when chosen.
- Defaults that work: VP8, simulcast layers h180/h360 with a 4:3 h720 capture,
  the `speech` audio preset, DTX on (a gate that sends digital silence lets
  DTX save bandwidth).

### Audio

- Noise models via `@sapphi-red/web-noise-suppressor` (RNNoise, Speex, GTCRN)
  as AudioWorklets with WASM. GTCRN runs the whole model once per 768-sample
  hop inside one render quantum: bursty, may glitch on weak CPUs; RNNoise is
  the safer default for low-end tables. Turn off the browser's own noise
  suppression while a model runs (they fight each other).
- The voice gate (`public/worklets/voice-activity-gate.js`): automatic floor
  with calibration and quietest-segment tracking, manual threshold, 300 ms
  hold, ramps. Post only open/close transitions to the main thread, and
  periodic levels only while a meter is shown (the fork posts 62.5/s always).
- Measure the meter from the raw mic, not the processed (possibly muted)
  track. Per-user volume above 100% needs Web Audio (a playback context
  separate from the capture one): suspend it when no one is boosted.
- `HTMLMediaElement.setSinkId("")` selects the default output ("default" maps
  to "").

### Camera background (MediaPipe via @livekit/track-processors 0.8.1)

- Segmentation (`segmentForVideo`) and drawing are **synchronous on the main
  thread**, every frame, with no frame cap on Chrome: tens of ms per frame on
  weak GPUs. The 16 MB float32 multiclass model ("High") is much cleaner
  (hair, around the head) but several times heavier; the selfie model
  ("Standard", 250 KB) is the sane default.
- Do better than the fork: segment in a worker (OffscreenCanvas) or at about
  15 fps reusing the last mask; capture at 640×480 when an effect is on; keep
  the segmenter across camera restarts; ask for one confidence mask; scale a
  background image to the frame once (the library re-uploads it every frame).
- Steady the mask: use confidence masks (not the yes/no category mask) and
  blend over time (exponential moving average, about 100 ms time constant, so
  it is frame-rate independent). See `src/MaskSmoother.ts` (it saves and
  restores the shared WebGL state it touches).
- Publish the camera only once the effect runs (privacy); on failure keep it
  off and tell the user.
- Bundle the WASM and models with the module (no CDN at runtime); pin model
  versions (`float16/1/selfie_segmenter.tflite`,
  `float32/1/selfie_multiclass_256x256.tflite`).

### UI/UX

- Build DOM with a tiny `el()` helper (textContent/setAttribute only, no
  innerHTML) — this kept the fork free of XSS.
- Popovers and menus must open in the **document of the element they belong
  to** (the dock may be in a Picture-in-Picture window) and size to that
  window.
- Document Picture-in-Picture (Chrome/Edge, secure contexts only): copy
  Foundry's style sheets (link the same hrefs, copy inline rules, copy the
  `<html>`/`<body>` classes), move the content (videos keep playing), forward
  only the push-to-talk key to Foundry, use native tooltips there.
- Grid tiles: choose the column count that maximizes 16:9 tile size for the
  count and space; only scroll below a minimum tile size. Focus layout: the
  focused tile is the largest 16:9 that fits, shown with `object-fit:
contain`.
- Consistency rules the owner asked for: one name per thing ("Voice & Video
  Settings" window, "Voice & video settings" popover, "Noise cancellation",
  "players" not "users"), sentence case, the same control for the same
  setting everywhere, positive wording ("Show other players' video").
- Keep the voice panel in the dock optional; a horizontal dock's panel is a
  column using the height.

## 7. Review findings to carry over (don't repeat these)

From the security and performance reviews of the fork, and the design review
of this document (a correctness review of the fork's code is pending):

- **Credentials**: the LiveKit key and secret sit in a world setting every
  player can read, and each player signs their own token, so players can
  mint any token for that project; the signed token is logged at debug level
  (`src/utils/auth.ts`). See §3 "Credentials and identity".
- **Privacy**: mute ignored while reconnecting (UI says muted, mic live);
  camera published raw before the blur starts, and raw on failure; Voice
  Activity without a running gate (music mode, no WASM, gate failure) is an
  open mic while the meter pretends to gate; processor swaps
  (stop-then-start) send raw audio briefly; "Block audio/video" by the GM
  isn't enforced on receivers; "deafened" is self-reported.
- **Performance**: per-frame MediaPipe on the main thread; MediaPipe rebuilt
  on every camera restart; background image re-uploaded every frame; Krisp
  loaded on every Cloud connect (fixed in krisp.14); gate reports 62.5/s;
  every voice-state change re-syncs the whole dock and forces layout; the
  voice panel polls `getStats` every 2 s even when hidden (the connection
  popover twice per tick); AudioContexts never suspended; meters animate
  `width`.
- Sound already: no XSS (no innerHTML), GM checks on socket commands, no
  runtime CDN loads, tiles reused across renders, hidden tiles let adaptive
  stream pause video, asset URLs resolved through Foundry's route prefix.

## 8. What to carry over

Only Affid's own code (see §2), as starting points to adapt to the new
structure:

- Pure UI helpers → `kit`: `src/ui/dom.ts`, popover/menu positioning from
  `Popover.ts` and `Menu.ts`, `LevelMeter.ts` drawing, the grid fitting,
  drag/resize and on-screen clamping from `src/ui/dock/*`.
- Page-wide services → `core`: `src/ui/dock/DockWindow.ts` (the
  Picture-in-Picture window and style copying) becomes `api.windows.pip`;
  the popover layer.
- Look → `dock`: `src/ui/buttons.ts`, `controls.ts`, `Avatar.ts`, the
  dock (`src/ui/dock/*`: focus/compact layouts,
  docked/floating/collapsed/Picture-in-Picture, tile windows), voice panel,
  connection details, user menu, player list decorations
  (`src/ui/VoicePanel.ts`, `ConnectionPopover.ts`, `UserMenu.ts`,
  `PlayersListDecorator.ts`), our design tokens and CSS rules.
- Voice gate → `core`: `public/worklets/voice-activity-gate.js`,
  `src/VoiceActivityGate.ts`.
- Per-user volume and mute/deafen → `core`: `src/UserAudioMixer.ts`,
  `src/VoiceControls.ts`.
- Krisp → `livekit-krisp`: `src/KrispNoiseFilter.ts`, as an effect in the
  core's chain (`exclusiveGroup: "noise-suppression"`).
- Background effect → `cam-background`: `src/VideoBackground.ts`,
  `src/MaskSmoother.ts`; its controls (`src/ui/videoBackgroundControl.ts`)
  become declared contributions that the dock renders.
- The settings window's design (sections, groups, wording) — rebuilt in
  the dock from scratch, since `src/LiveKitAVConfig.ts` is
  upstream-derived.
- Not the token signing (`src/utils/auth.ts` is upstream code and the
  wrong model): write the GM relay fresh.

Not worth carrying: the classic-UI paths (Foundry's own dock decorated), the
`useExternalAV` web client, Tavern Patreon server support (unless wanted).

## 9. Milestones

Real constraints first (Foundry's A/V code, a real service, tokens, real
tracks), then a second, very different service to prove the abstraction,
and only then the UI on top, so the API isn't reshaped under a finished UI.

1. Repository: pnpm workspace, MIT `LICENSE`, `THIRD-PARTY-NOTICES.md`,
   Vite + TypeScript strict + ESLint + Prettier per package, language-file
   validation, the fake Foundry and mock service, CI (unit and browser
   tiers), per-module manifest publishing, the local Foundry world.
2. **Vertical slice** with Foundry's own dock: `api` + `core` (the
   `AVSettings`/`AVMaster` contract, session, store and commands, camera
   dock host, plain status, registries) + a minimal `modular-av-livekit`:
   join with a **GM-relayed token**, hear and see each other, mute in every
   state, reconnect (once), duplicate identity, GM block, against
   `livekit-server --dev` and then LiveKit Cloud. Settle the voice-activity
   question (§3 contract) here.
3. Media pipeline in `core`: devices, capture context, gate, stages and
   exclusive groups, atomic swaps, the camera watchdog, fail-closed rules,
   "speaking while muted".
4. `modular-av-p2p` (plain WebRTC over the core's socket, Foundry's TURN
   settings) — proves the service API with a very different service before
   it is frozen.
5. `kit` + `modular-av-dock` (dock, voice panel, settings window, player
   list, Picture-in-Picture via `api.windows.pip`) on the public API only,
   and the UI contract suite. If the dock needs something the API lacks,
   add it to the API rather than working around it.
6. `modular-av-mic-denoise` (RNNoise default, Speex, GTCRN) and
   `modular-av-livekit-krisp`, lazy, with their controls as contributions.
7. `modular-av-cam-background`: segmentation in a worker or at capped fps,
   lazy, fail-closed, with measured budgets. **First release** (lockstep
   versions), with a migration note and settings import for players of the
   old module.
8. `modular-av-jitsi` (check first whether lib-jitsi-meet accepts outside
   tracks; otherwise `mediaOwnership: "service"`).
9. The scattered layout, then `modular-av-dock-vines` (tile frames) as the
   first theme, to prove the layout and theming API; then
   `modular-av-tokens` and the external call mode if still wanted.

Performance budgets to hold (measure in the harness, GPU Chrome): no long task
over 50 ms from the modules with effects off; service SDKs and effect code
not loaded until used (bundle-size check per module); a camera effect at its default
quality ≤ 15% of the main thread; no memory growth over a 2-hour session; an
idle connected session runs no timers more often than once a second while the
tab is hidden.
