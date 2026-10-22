# Handoff: Modular AV

This is for a new Claude Code session that will build **Modular AV**, a new
family of Foundry VTT voice and video modules, **in a new repository**, run
locally (WSL) with its own Foundry VTT and communication servers. It sums up
what we learnt building the Discord-style fork of the LiveKit AVClient module
(this repository, `Affid/fvtt-module-avclient-livekit`, up to release
`0.6.8-krisp.14`), the licensing rules for the new code, the module family
and plugin API, a proposed architecture, what to avoid, and milestones. Read
it fully before writing code.

## 1. Goal

A Foundry VTT (v14+) voice and video system made of modules:

- **`modular-av`** ("Modular AV"), the core: lean and well tested. It owns
  the Foundry integration and the whole user experience — a Discord-like
  camera dock, a voice panel (mute, deafen, connection status, settings),
  speaking rings, per-player volume, push to talk / voice activity with input
  sensitivity, the settings window — and the session logic (connecting,
  recovering from lost connections, who is who, mute/deafen state).
- **Service modules**, one per communication service, each installed only if
  wanted and tested on its own: `modular-av-livekit` (self-hosted LiveKit and
  LiveKit Cloud), `modular-av-jitsi`, a peer-to-peer one using plain WebRTC
  with no server (small tables), embedded tools (a Jitsi Meet / Whereby /
  similar iframe) as a shallow option. The GM picks the service per world, so
  the table isn't tied to LiveKit Cloud and can use what suits its players.
- **Effect modules** for the players' microphone and camera, added or removed
  as wanted: audio effects (noise cancellation models, voice effects) and
  video effects (background blur and replacement, filters). They run on the
  local tracks before they are handed to the service, so they work with any
  service that accepts tracks. Service-specific extras (Krisp on LiveKit
  Cloud, Jitsi's built-in effects) come with their service module.
- **Theme modules** that change how the dock and voice panel look, e.g.
  `modular-av-ui-scifi`, `modular-av-ui-fantasy`, a Discord-like one
  (`modular-av-ui-dis` or similar). Beyond restyling the dock, a theme can
  bring the call into the game: e.g. each camera in its own ornate frame
  (vine leaves, carved wood, a scrying mirror) in a different corner of the
  screen rather than in a dock. The core ships one clean default theme;
  each player picks a theme, with a default set by the GM.

And everything is **light and robust**: it recovers from lost connections by
itself, never shows a state it isn't in (muted, blurred), and costs little
CPU/GPU when features are off.

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
4. **New ids and names**: `modular-av`, `modular-av-livekit`, … — never
   `avclient-livekit` or "LiveKit AVClient" — and new README text and images.
5. **Third-party code keeps its notices** in a `THIRD-PARTY-NOTICES.md` per
   module, from day one. These licences only ask for attribution:
   `@sapphi-red/web-noise-suppressor` and its RNNoise/Speex/GTCRN builds
   (MIT, BSD-3-Clause; depend on the npm package and copy its files at build
   time rather than vendoring them), MediaPipe runtime and selfie models
   (Apache-2.0, per the model cards), `livekit-client` and
   `@livekit/track-processors` (Apache-2.0). `@livekit/krisp-noise-filter` is
   proprietary (LiveKit Cloud terms): keep it an optional part of
   `modular-av-livekit`, loaded only when chosen.
6. Foundry's own licence for module developers applies to every module, as
   usual.

## 3. The module family and plugin API

### Repository layout

One repository, **`modular-av`**, as a pnpm workspace (monorepo) with one
package per Foundry module, released independently:

```
modular-av/
  packages/
    core/            → Foundry module "modular-av"
    livekit/         → "modular-av-livekit"
    p2p/             → "modular-av-p2p"   (plain WebRTC, no server)
    jitsi/           → "modular-av-jitsi"
    embed/           → "modular-av-embed" (iframe services)
    fx-noise/        → "modular-av-fx-noise" (RNNoise/Speex/GTCRN, gate stays in core)
    fx-background/   → "modular-av-fx-background" (blur/replace, MediaPipe)
    ui-scifi/        → "modular-av-ui-scifi" (theme)
    ui-fantasy/      → "modular-av-ui-fantasy" (theme)
    api/             → types only: the plugin API, shared by all packages
    testing/         → mock provider, contract tests, Playwright harness
  docs/
```

One repository keeps the API, its types and every module in step (a change to
the API and all its users in one commit), shares tooling, and still lets each
module be built, tested and released on its own (version tags per package,
e.g. `livekit-v1.2.0`; each module has its own `module.json` and release
zip). Separate repositories per module are possible later if others maintain
them.

### How modules plug in

- Each plugin module declares the core in its `module.json`:
  `"relationships": { "requires": [{ "id": "modular-av", "compatibility": { "minimum": "1.0.0" } }] }`.
- The core exposes its API on its module object:
  `game.modules.get("modular-av").api`, with an `api.version` (semver). It
  fires one registration hook at a fixed point (e.g. during `setup`), so the
  load order of modules doesn't matter:
  `Hooks.callAll("modularAV.register", api)`. Plugins register there:
  `api.registerProvider(...)`, `api.registerAudioEffect(...)`,
  `api.registerVideoEffect(...)`, `api.registerTheme(...)`. A plugin checks `api.version` and declines
  (with a clear message) if it is incompatible.
- Foundry allows one A/V client class: the core sets it and delegates to the
  provider the GM chose. With no provider module installed, the core says so
  in its settings window.
- **Plugins describe their settings; the core renders them** with its UI kit,
  so every module looks and behaves the same (server address and keys for a
  provider, strength for an effect). Plugins may get small custom sections,
  built with the core's exported UI kit (`api.ui`), when a schema isn't
  enough.
- **Heavy code is loaded lazily inside each plugin** (dynamic `import()`):
  installing an effect module costs nothing until a player turns it on.
- A provider's own bundled library (e.g. `livekit-client`) lives only in its
  module; the core bundles no service library.

### Plugin interfaces (sketch)

```ts
interface ProviderPlugin {
  id: string; // "livekit"
  label: string;
  settings: SettingsSchema; // world settings (GM): server, keys…
  capabilities: ProviderCapabilities; // video, screen share, breakout rooms…
  create(context: ProviderContext): Promise<Provider>;
}

interface Provider {
  connect(
    room: RoomSpec,
    identity: Identity,
    signal: AbortSignal,
  ): Promise<void>;
  disconnect(reason: "user" | "switching" | "unload"): Promise<void>;
  publish(
    track: MediaStreamTrack,
    kind: "audio" | "video",
  ): Promise<PublishedTrack>;
  replaceTrack(
    published: PublishedTrack,
    track: MediaStreamTrack,
  ): Promise<void>;
  setMuted(published: PublishedTrack, muted: boolean): Promise<void>; // in any state
  on<E extends keyof ProviderEvents>(
    event: E,
    handler: ProviderEvents[E],
  ): () => void;
  // events: state (connected / lost / failed with a reason), participant
  // joined/left, track subscribed/unsubscribed, speaking, quality
  getStats(): Promise<ConnectionStats>;
}

interface AudioEffectPlugin {
  id: string; // "rnnoise"
  label: string;
  settings?: SettingsSchema; // client settings
  cost: "light" | "medium" | "heavy"; // shown to players
  isSupported(): boolean;
  create(context: AudioEffectContext): Promise<AudioEffect>;
}

interface AudioEffect {
  // An AudioNode chain in the core's single AudioContext
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(options: unknown): void;
  dispose(): void;
}

interface VideoEffectPlugin {
  id: string; // "background"
  label: string;
  settings?: SettingsSchema;
  cost: "light" | "medium" | "heavy";
  isSupported(): boolean;
  create(context: VideoEffectContext): Promise<VideoEffect>;
}

interface VideoEffect {
  // MediaStreamTrack in, MediaStreamTrack out (insertable streams/worker)
  start(input: MediaStreamTrack): Promise<MediaStreamTrack>;
  replaceInput(input: MediaStreamTrack): Promise<void>; // camera restart: keep state
  update(options: unknown): void;
  dispose(): void;
}
```

### Themes and layouts

Themes restyle and rearrange the core's UI; they don't replace its
behaviour, so every theme stays accessible, shows the true state, and keeps
working when the core changes. Two things are kept apart, because players
will want to mix them (a fantasy look in a plain dock, or the default look
in free-floating frames):

- **Layouts** decide where the cameras are. The core ships the dock layouts
  (left, right, top, bottom, floating, own window) and a **scattered**
  layout: every camera is its own element, anchored to a corner or edge of
  the screen (or dragged anywhere), with its position and size saved per
  player, and per scene when the GM wants (a portrait by each side of a
  tavern table). More layouts can be registered with `api.registerLayout`,
  but tile fitting, drag, resize and keeping tiles on screen stay in the
  core.
- **Themes** decide how everything looks: the dock, tiles, voice panel and
  popovers, in any layout.

What a theme can use, all part of the core's **public, versioned API**:

- **Design tokens**: every colour, radius, spacing, font, shadow, the
  speaking ring and tile frame are CSS custom properties on the dock and
  panel roots (as the fork's `--lk-*` tokens, renamed e.g. `--mav-*`). A
  simple theme only sets tokens.
- **Stable hooks for structure**: documented class names and data
  attributes for each part (`.mav-dock`, `.mav-tile`, `.mav-tile-video`,
  `.mav-tile-frame`, `.mav-panel`, `[data-state="speaking"]`,
  `[data-muted]`, `[data-layout="scattered"]`, `[data-anchor="top-left"]`,
  …), so a theme can add decoration with its own CSS without depending on
  internal markup. Changing these is a breaking API change (major
  `api.version`).
- **Tile frames**: a theme can give each tile a frame that is bigger than
  the video, e.g. vine leaves overflowing its edges. It declares the frame
  rather than drawing it with scripts: artwork (SVG or a 9-slice image for
  `border-image`, so it scales to any tile size), how far it reaches past
  the video on each side (so the core's fitting and on-screen clamping
  allow for it), an optional shape for the video (oval, arch, shield, via
  `mask-image`/`clip-path`), and variants per anchor (leaves growing from
  the corner the tile sits in) or per state (leaves glowing while speaking,
  greying while muted). Frames never take clicks (`pointer-events: none`)
  except where the core puts its controls.
- **Optional slots** for anything more: extra elements per tile or in the
  panel that the core creates on request, rather than themes reaching into
  the DOM.
- A theme registers with `api.registerTheme({ id, label, stylesheet,
frames, preview, suggestedLayout })`; the core loads only the selected
  theme's stylesheet and assets, and scopes them to its UI (not the rest
  of Foundry). The Picture-in-Picture dock window gets them too.

Rules the core enforces or documents for theme authors:

- The core always shows **mute, deafen, speaking and connection state**,
  and the player's name on hover, in every theme; a theme may restyle these
  indicators but not hide them.
- Faces stay visible: a frame may cover at most a set margin of the video,
  and video shapes keep the centre of the picture.
- Text contrast (WCAG AA) and visible focus rings; controls stay reachable
  by keyboard in the scattered layout too.
- Cheap to run: static artwork, animations only on `transform` and
  `opacity`, no per-frame scripts, everything off under
  `prefers-reduced-motion`.
- Scattered tiles must not cover Foundry's own controls (sidebar, scene
  controls, hotbar, chat); the core keeps them clear of those.

### Testing per module

- `packages/testing` has a **mock provider** (in-memory participants, fake
  tracks, scripted drops and reconnects) so the core and its UI are tested
  without any server.
- A **provider contract test suite** that every provider module must pass
  against its real server in Docker: connect, publish, subscribe, mute in
  every state, speaking, a 20 s outage and recovery, duplicate identity,
  leaving on purpose.
- Effect modules have their own tests (output track runs, CPU budget, fail
  closed) and are exercised with the mock provider.
- Theme modules get screenshot tests of the dock, scattered tiles and
  panel in each layout, anchor and state with the mock provider, automated
  contrast checks, and a check that frames leave faces and the state
  indicators visible.
- Each package has its own CI job; the core's job runs the mock-provider UI
  tests in Foundry.

## 4. Local environment (WSL)

- **Foundry VTT** (Node.js build) running in WSL2, a test world with a GM and
  several passwordless players (e.g. `Player1`–`Player4`). Install each
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
  main thread (a busy loop in the page), a second tab with the same user.
- **Test harness**: Playwright scripts that log in N users, wait for
  `game.ready`, drive the UI, take screenshots, read state through the core's
  API, and measure (CDP `Performance.getMetrics`, process memory via
  `/proc/<pid>/smaps_rollup` PSS, long tasks via a `longtask`
  `PerformanceObserver`). Keep it in the repository, not in a scratchpad.

## 5. Architecture of the core

```
┌──────────────────────────────────────────────────────────────┐
│ Foundry integration + UI                                     │
│  A/V client class (Foundry's plug-in point: game.webrtc)     │
│  Camera dock (replaces CameraViews), voice panel, popovers,  │
│  player list decorations, settings window, keybindings       │
├──────────────────────────────────────────────────────────────┤
│ Session (service-independent)                                │
│  Connection state machine (connecting, connected, lost,      │
│  retrying, left), participants ↔ Foundry users,              │
│  mute/deafen/volume, speaking, stats, reconnect policy       │
├──────────────────────────────────────────────────────────────┤
│ Local media pipeline (service-independent)                   │
│  mic → audio effects → voice gate → provider                 │
│  camera → video effects → provider                           │
├──────────────────────────────────────────────────────────────┤
│ Plugin registry: providers, audio and video effects,         │
│  layouts, themes                                             │
└──────────────────────────────────────────────────────────────┘
```

Principles:

- **The session owns the truth.** UI shows the session's state (including
  "reconnecting", "blur starting", "open mic"), never assumes it.
- **The media pipeline produces plain `MediaStreamTrack`s** (insertable
  streams, AudioWorklets), so any provider can publish the result. Keep
  **one** `AudioContext` for local processing; suspend it when unused.
- **Fail closed for privacy.** If a video effect isn't running yet or failed,
  don't publish raw video (keep the camera off and say so). If the voice gate
  can't run in Voice Activity mode, show "open mic" plainly.
- **Swap effects atomically** (start the new one, then replace), never
  stop-then-start with raw media in between.
- **Reconnect like Discord**: retry forever with backoff (1, 3, 5, 10, 20,
  then every 30 s) and at once on the browser's `online` event, unless the
  reason is final (left on purpose, joined elsewhere, removed, room closed).
  Re-apply mute state after every (re)connect.
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
- Settings: client settings for per-user UI state; world settings only from
  the GM. A setting's `onChange` already re-renders: don't render twice.

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
  track. Per-user volume above 100% needs Web Audio (an extra context):
  suspend it when no one is boosted.
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

From the security and performance reviews of the fork (correctness review
pending — see the end of this document):

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
- Sound already: no XSS (no innerHTML), GM checks on socket commands,
  credentials not logged, no runtime CDN loads, tiles reused across renders,
  hidden tiles let adaptive stream pause video.

## 8. What to carry over

Only Affid's own code (see §2), as starting points to adapt to the new
structure:

- UI kit → `core`: `src/ui/dom.ts`, `buttons.ts`, `controls.ts`, `Popover.ts`,
  `Menu.ts`, `Avatar.ts`, `LevelMeter.ts`, our design tokens and CSS rules.
- Dock → `core`: `src/ui/dock/*` (grid fitting, focus/compact layouts,
  docked/floating/collapsed/Picture-in-Picture, tile windows, drag/resize).
- Voice panel, connection details, user menu, player list decorations →
  `core`: `src/ui/VoicePanel.ts`, `ConnectionPopover.ts`, `UserMenu.ts`,
  `PlayersListDecorator.ts`.
- Voice gate → `core`: `public/worklets/voice-activity-gate.js`,
  `src/VoiceActivityGate.ts`.
- Per-user volume and mute/deafen → `core`: `src/UserAudioMixer.ts`,
  `src/VoiceControls.ts`.
- Krisp → `livekit`: `src/KrispNoiseFilter.ts`.
- Background effect → `fx-background`: `src/VideoBackground.ts`,
  `src/MaskSmoother.ts`, `src/ui/videoBackgroundControl.ts`.
- The settings window's design (sections, groups, wording) — rebuilt in the
  core from scratch, since `src/LiveKitAVConfig.ts` is upstream-derived.

Not worth carrying: the classic-UI paths (Foundry's own dock decorated), the
`useExternalAV` web client, Tavern Patreon server support (unless wanted).

## 9. Milestones

1. Repository: pnpm workspace, MIT `LICENSE`, `THIRD-PARTY-NOTICES.md`,
   Vite + TypeScript strict + ESLint + Prettier per package, language-file
   validation, CI, the Playwright harness, a local Foundry world.
2. `api` + `core` with the **mock provider**: session state machine, plugin
   registry and registration hook, settings rendering from schemas, dock,
   voice panel, settings window, player list — tested without any server.
3. `modular-av-livekit`: provider contract tests against a local LiveKit
   server (`livekit-server --dev`), then LiveKit Cloud; reconnect and
   network-impairment tests.
4. Media pipeline in `core` (single AudioContext, voice gate, atomic swaps,
   fail-closed rules); `modular-av-fx-noise` (RNNoise default, Speex,
   GTCRN), lazy.
5. `modular-av-fx-background`: segmentation in a worker or at capped fps,
   lazy, fail-closed, with measured budgets.
6. `modular-av-p2p` (plain WebRTC, no server) — proves the provider API with a
   very different service.
7. `modular-av-jitsi` (lib-jitsi-meet), then `modular-av-embed`.
8. The scattered layout, then a first theme module with tile frames (e.g.
   vine leaves), to prove the layout and theming API.
9. Docs, a migration note for players of the old module, releases per module.

Performance budgets to hold (measure in the harness, GPU Chrome): no long task
over 50 ms from the modules with effects off; a camera effect at its default
quality ≤ 15% of the main thread; no memory growth over a 2-hour session; an
idle connected session runs no timers more often than once a second while the
tab is hidden.
