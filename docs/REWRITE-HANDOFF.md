# Handoff: a new Foundry VTT voice & video module

This is for a new Claude Code session that will build a new module **in a new
repository**, run locally (WSL) with its own Foundry VTT and communication
servers. It sums up what we learnt building the Discord-style fork of the
LiveKit AVClient module (this repository, `Affid/fvtt-module-avclient-livekit`,
up to release `0.6.8-krisp.14`), what to keep, what to avoid, and a proposed
architecture. Read it fully before writing code.

## 1. Goal

A Foundry VTT (v14+) voice and video module that:

- **Lets the GM choose the communication service per world**, so the table
  isn't tied to LiveKit Cloud: self-hosted LiveKit, LiveKit Cloud, Foundry's
  own peer-to-peer WebRTC (no server, small tables), Jitsi (self-hosted or
  hosted), and possibly embedded tools (a Jitsi Meet / Whereby / similar
  iframe) as a shallow fallback.
- **Gives the same Discord-like experience on every service**: a camera dock,
  a voice panel (mute, deafen, connection status, settings), speaking rings,
  per-player volume, push to talk / voice activity with input sensitivity.
- **Adds quality-of-life processing where the service allows it**: noise
  cancellation, a voice gate, camera background blur/replacement — on the
  local tracks before they are handed to the service, so it works for any
  service that accepts tracks; service-specific extras (Krisp on LiveKit
  Cloud, Jitsi's built-in effects) when available.
- **Is light and robust**: recovers from lost connections by itself, never
  shows a state it isn't in (muted, blurred), and costs little CPU/GPU when
  features are off.

## 2. Licensing — read before copying anything from this repository

This repository is a fork of `bekriebel/fvtt-module-avclient-livekit`, licensed
under the **Hippocratic License 2.1** (`LICENSE`, © 2021 Brint E. Kriebel /
bekit, LLC). It is not an OSI open-source licence. In short:

- It permits everything copyright would otherwise forbid (use, copy, modify,
  distribute, also commercially), on conditions:
  - **Notice**: anyone receiving any part of the software must receive the
    licence and the copyright notice; modified versions must carry prominent
    notices that they were changed. The licensee's _own_ modifications may be
    distributed under different terms, but **unmodified upstream portions stay
    under HL 2.1**.
  - **Human rights**: use must be consistent with the UN Universal Declaration
    of Human Rights / Global Compact principles and must not violate human
    rights laws; disputes go to arbitration (Hague Rules); indemnity for
    violations.
  - Breaching it ends the licence (with a 30-day cure period for the notice
    condition).

What that means for the new repository (this is not legal advice):

| Code in this repository                                                                                                                                                                                                                                             | Author                                                                | Reuse in the new repository                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Files that existed upstream at commit `258d14a` (`src/LiveKitClient.ts`, `LiveKitAVClient.ts`, `LiveKitAVConfig.ts`, `LiveKitBreakout.ts`, `utils/*`, `avclient-livekit.ts`, parts of the CSS, settings, types, vite config)                                        | Brint E. Kriebel and contributors (wyrmisis, Jakub), plus our changes | Only with the HL 2.1 licence and notices. **Prefer writing these parts fresh** (clean design, see below); use them only to understand behaviour. |
| `src/utils/auth.ts`, and code mirrored from LiveKit libraries (`LICENSE-livekit-react`, `LICENSE-livekit-server-sdk-js`)                                                                                                                                            | upstream, derived from Apache-2.0 LiveKit code                        | Apache-2.0 notices if reused.                                                                                                                    |
| `src/NoiseSuppressorFilter.ts`, the noise model menu's first version, `THIRD-PARTY-NOTICES.md`                                                                                                                                                                      | devnagui (upstream PR #107), later changed by us                      | Contributed under HL 2.1; reuse with the notice, or rewrite, or ask devnagui.                                                                    |
| Every other file under `src/` that didn't exist upstream (`src/ui/**`, `src/ui/dock/**`, `VoiceActivityGate.ts`, `public/worklets/voice-activity-gate.js`, `KrispNoiseFilter.ts`, `UserAudioMixer.ts`, `VoiceControls.ts`, `VideoBackground.ts`, `MaskSmoother.ts`) | written in Affid's sessions (git author "Claude")                     | Affid's own work: can be reused and relicensed.                                                                                                  |
| Vendored `public/rnnoise`, `public/speex`, `public/gtcrn`, `public/noise-suppressor` (from `@sapphi-red/web-noise-suppressor` 0.4.0)                                                                                                                                | third parties                                                         | MIT / BSD-3-Clause, notices in `THIRD-PARTY-NOTICES.md`. Better: depend on the npm package and copy at build time.                               |
| MediaPipe runtime and selfie models                                                                                                                                                                                                                                 | Google                                                                | Apache-2.0 (model cards confirm).                                                                                                                |
| `@livekit/track-processors`, `livekit-client`                                                                                                                                                                                                                       | LiveKit                                                               | Apache-2.0. `@livekit/krisp-noise-filter` is proprietary (LiveKit Cloud terms).                                                                  |

Pick a licence for the new repository deliberately (e.g. MIT or Apache-2.0
for broad reuse), keep a `THIRD-PARTY-NOTICES.md` from day one, and keep any
HL 2.1 code (if any is reused) clearly separated and attributed.

## 3. Local environment (WSL)

- **Foundry VTT** (Node.js build) running in WSL2, a test world with a GM and
  several passwordless players (e.g. `Player1`–`Player4`). Install the module
  under development by symlinking its `dist/` into `Data/modules/<id>`.
- **Browsers**: a GPU-accelerated Chrome matters (camera effects, Document
  Picture-in-Picture, real frame rates). Driving **Windows Chrome over its
  remote debugging port** (`chrome.exe --remote-debugging-port=9222
--user-data-dir=...`) from Playwright in WSL is usually easier than GPU
  Chrome inside WSL. Use one browser profile per test user. Chrome's fake
  media flags help automation: `--use-fake-ui-for-media-stream
--use-fake-device-for-media-stream --use-file-for-fake-video-capture=x.y4m
--use-file-for-fake-audio-capture=x.wav`. A still photo gives an identical
  mask every frame; add noise and slight motion (ffmpeg `noise=alls=10:allf=t`
  and an oscillating `crop`) to test segmentation stability.
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
  `game.ready`, drive the UI, take screenshots, read state from
  `game.webrtc.client`, and measure (CDP `Performance.getMetrics`, process
  memory via `/proc/<pid>/smaps_rollup` PSS, long tasks via
  `PerformanceObserver('longtask')`). Keep it in the repository (`tests/`),
  not in a scratchpad.

## 4. Proposed architecture

Three layers, with the service behind an interface:

```
┌──────────────────────────────────────────────────────────────┐
│ Foundry integration + UI                                      │
│  AVClient subclass (Foundry's plug-in point: game.webrtc)     │
│  Camera dock (replaces CameraViews), voice panel, popovers,   │
│  player list decorations, settings window, keybindings        │
├──────────────────────────────────────────────────────────────┤
│ Session core (service-independent)                             │
│  Connection state machine (connect, lost, retrying, left),    │
│  participants ↔ Foundry users, mute/deafen/volume, speaking,  │
│  stats, events; reconnect policy                              │
├──────────────────────────────────────────────────────────────┤
│ Local media pipeline (service-independent)                     │
│  capture → noise model → voice gate → (service)               │
│  camera → background effect → (service)                        │
├──────────────────────────────────────────────────────────────┤
│ Providers: LiveKit (self-hosted / Cloud) · Foundry P2P ·      │
│  Jitsi (lib-jitsi-meet) · Embedded (iframe, shallow)          │
└──────────────────────────────────────────────────────────────┘
```

Provider interface (sketch):

```ts
interface VoiceProvider {
  readonly id: string;
  readonly capabilities: {
    video: boolean;
    screenShare: boolean;
    breakoutRooms: boolean;
    serverNoiseCancellation?: "krisp" | "jitsi";
    serverStats: boolean;
    acceptsProcessedTracks: boolean; // false for embedded iframes
  };
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
  setMuted(published: PublishedTrack, muted: boolean): Promise<void>; // works in any state
  on(event: ProviderEvent, handler): () => void; // participant joined/left, track
  // subscribed, speaking, quality,
  // state: connected/lost/failed(reason)
  getStats(): Promise<ConnectionStats>;
}
```

Principles:

- **The session core owns the truth.** UI shows the core's state (including
  "reconnecting", "blur starting", "open mic"), never assumes it.
- **The media pipeline produces plain `MediaStreamTrack`s.** Use
  insertable streams (`MediaStreamTrackProcessor` / `Generator`) or
  AudioWorklets so any provider can publish the result; for LiveKit, either
  publish the processed track directly or wrap it as a `TrackProcessor`.
  Keep **one** `AudioContext` for local processing; suspend it when unused.
- **Fail closed for privacy.** If the background effect isn't running yet or
  failed, don't publish raw video (keep the camera muted and say so). If the
  voice gate can't run in Voice Activity mode, show "open mic" plainly.
- **Swap processors atomically** (start the new one, then replace), never
  stop-then-start with raw media in between.
- **Reconnect like Discord**: the core retries forever with backoff (e.g. 1,
  3, 5, 10, 20, then 30 s) and on the browser's `online` event, unless the
  reason is final (left on purpose, joined elsewhere, removed, room closed).
  Mute state is re-applied after every (re)connect.
- **Everything heavy is lazy and opt-in**: load Krisp, MediaPipe, models only
  when chosen; keep their state across camera restarts.

## 5. Lessons learnt

### Foundry VTT v14

- `CONFIG.ui.webrtc` is read in `initializeUI` after `init`: replace the
  camera dock class there. Foundry's `CameraViews._onRender` moves the dock
  element next to `#interface` on **every render** and sets
  `element.hidden`; a custom dock must live with that (or keep its content in
  a child it can move, e.g. to a Picture-in-Picture window).
- ApplicationV2: `window: { positioned: false }` stops Foundry's positioning;
  don't name members `position`/`setPosition` (they collide). Hook names come
  from constructor names, which the bundle minifies.
- Foundry's CSS uses cascade layers: unlayered module CSS wins; use
  `:where()` for zero-specificity resets of Foundry's button styles; Foundry
  styles `.active` buttons, so use your own state classes.
- Tooltips: `data-tooltip` (Foundry renders it as HTML — only put trusted,
  localized text there); `data-tooltip-class` styles them. They only work in
  Foundry's own window.
- AVMaster quirks: `broadcast()` calls `ui.webrtc.setUserIsSpeaking(self,
intent)` with _intent_, not speech; AVMaster toggles audio/video when
  `client.users.<self>.hidden/muted` change; `AVSettings.set` updates memory
  at once and saves with a debounce; a change of `world.turn` makes every
  client reconnect.
- Foundry has a deprecated global `Module` (alias of
  `foundry.packages.Module`) with a setter that stores overrides. Libraries
  built with Emscripten that read a global `Module` (MediaPipe!) break; hide
  it while they start and restore it afterwards.
- The language file must not have a key that is both a string and a parent
  (`a.b` and `a.b.c`): Foundry drops the whole file. Validate at build time.
- Settings: client settings for per-user UI state; world settings only from
  the GM. Settings `onChange` already re-renders: don't render twice.

### LiveKit (livekit-client 2.19)

- `TrackProcessor`: `init/restart/destroy/processedTrack`. When a processor
  is attached, `LocalTrack.mediaStreamTrack` returns the processed track; the
  raw one is `track.mediaStream.getAudioTracks()[0]`. `setProcessor`
  initializes the new processor before stopping the old (atomic);
  `stopProcessor()` hands the sender the raw track.
- Muting a camera stops the device; unmuting restarts it and calls
  `processor.restart` (destroy + init) — expensive for MediaPipe unless you
  keep its state.
- `setAudioEnabledState`-style code that skips muting unless the room is
  `Connected` leaves the mic live during reconnects. Mute the track in any
  state and re-apply after reconnecting.
- Adaptive stream pauses videos it thinks are hidden; it knows about video
  elements in a **Document Picture-in-Picture** window (keeps them), but not
  about elements in a plain `window.open` pop-up (would pause them).
- LiveKit's own reconnect gives up after about a minute; then
  `RoomEvent.Disconnected(reason)` — nothing reconnects unless you do it.
  The server's `CONNECTION_TIMEOUT` means it stopped hearing the client: a
  network drop, or a main thread frozen for longer than the ping timeout.
- Krisp: only on LiveKit Cloud; it fires `enable-lk-krisp-noise-filter` on
  its processed track and comes back disabled after a restart (re-enable it).
  Its package is 6 MB: import it only when chosen.
- Defaults that work: VP8, simulcast layers h180/h360 with 4:3 h720 capture,
  `speech` audio preset, DTX on (a gate that sends digital silence lets DTX
  save bandwidth).

### Audio

- Noise models via `@sapphi-red/web-noise-suppressor` (RNNoise, Speex,
  GTCRN) as AudioWorklets with WASM. GTCRN runs the whole model once per
  768-sample hop inside one render quantum: bursty, may glitch on weak CPUs;
  RNNoise is the safer default for low-end tables. Turn off the browser's
  own noise suppression while a model runs (they fight each other).
- The voice gate (`public/worklets/voice-activity-gate.js`): automatic floor
  with calibration and quietest-segment tracking, manual threshold, 300 ms
  hold, ramps. Post only open/close transitions to the main thread, and
  periodic levels only while a meter is shown (the fork posts 62.5/s always).
- Measure the meter from the raw mic, not the processed (possibly muted)
  track. Per-user volume above 100% needs Web Audio (an extra context):
  suspend it when no one is boosted.
- `HTMLMediaElement.setSinkId("")` for the default output ("default" maps to
  "").

### Camera background (MediaPipe via @livekit/track-processors 0.8.1)

- Segmentation (`segmentForVideo`) and drawing are **synchronous on the main
  thread**, every frame, no frame cap on Chrome: tens of ms per frame on
  weak GPUs. The 16 MB float32 multiclass model ("High") is much cleaner
  (hair, around the head) but several times heavier; the selfie model
  ("Standard", 250 KB) is the sane default.
- A player with High on a modest machine kept dropping
  (`CONNECTION_TIMEOUT`); likely the main thread starving during MediaPipe
  start-up (every join and camera restart) plus per-frame work.
- Do better than the fork: run segmentation in a worker (OffscreenCanvas) or
  at ~15 fps reusing the last mask; capture at 640×480 when an effect is on;
  keep the segmenter across camera restarts; ask for one confidence mask;
  scale a background image to the frame once instead of uploading it every
  frame (the library re-uploads it per frame).
- Steady the mask: use confidence masks (not the yes/no category mask) and
  blend over time (exponential moving average, ~100 ms time constant, so it
  is frame-rate independent). See `src/MaskSmoother.ts` (save/restore the
  shared WebGL state it touches).
- Publish the camera only once the effect runs (privacy); on failure keep it
  off and tell the user.
- Bundle the WASM and models with the module (no CDN at runtime); pin model
  versions (`.../float16/1/selfie_segmenter.tflite`,
  `.../float32/1/selfie_multiclass_256x256.tflite`).

### UI/UX

- Build DOM with a tiny `el()` helper (textContent/setAttribute only — no
  innerHTML) — this kept the fork free of XSS.
- Popovers and menus must open in the **document of the element they belong
  to** (the dock may be in a Picture-in-Picture window) and size to that
  window.
- Document Picture-in-Picture (Chrome/Edge, secure contexts only): copy
  Foundry's style sheets (link the same hrefs, copy inline rules, copy
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

## 6. Review findings to carry over (don't repeat these)

From the security and performance reviews of the fork (correctness review
pending — see the end of this document):

- **Privacy**: mute ignored while reconnecting (UI says muted, mic live);
  camera published raw before the blur starts and raw on failure; Voice
  Activity without a running gate (music mode, no WASM, gate failure) is an
  open mic while the meter pretends to gate; processor swaps
  (stop-then-start) send raw audio briefly; "Block audio/video" by the GM
  isn't enforced on receivers; "deafened" is self-reported.
- **Performance**: per-frame MediaPipe on the main thread; MediaPipe rebuilt
  on every camera restart; background image re-uploaded every frame; Krisp
  loaded on every Cloud connect (fixed in krisp.14); gate reports 62.5/s;
  every voice-state change re-syncs the whole dock and forces layout; the
  voice panel polls `getStats` every 2 s even when hidden (and the popover
  twice per tick); AudioContexts never suspended; meters animate `width`.
- Sound already: no XSS (no innerHTML), GM checks on socket commands,
  credentials not logged, no runtime CDN loads, tiles reused across renders,
  hidden tiles let adaptive stream pause video.

## 7. What to reuse from this repository

As reference or starting points (Affid's own code, see §2):

- UI kit: `src/ui/dom.ts`, `buttons.ts`, `controls.ts`, `Popover.ts`,
  `Menu.ts`, `Avatar.ts`, `LevelMeter.ts`, the `--lk-*` design tokens in
  `public/css/avclient-livekit.css` (that file mixes upstream CSS — extract
  only our parts).
- Dock: `src/ui/dock/*` (grid fitting, focus/compact layouts, docked/floating/
  collapsed/Picture-in-Picture, tile windows, drag/resize).
- Voice panel, connection details, user menu, player list decorator:
  `src/ui/VoicePanel.ts`, `ConnectionPopover.ts`, `UserMenu.ts`,
  `PlayersListDecorator.ts`.
- Media: `public/worklets/voice-activity-gate.js` + `src/VoiceActivityGate.ts`,
  `src/KrispNoiseFilter.ts`, `src/VideoBackground.ts`, `src/MaskSmoother.ts`,
  `src/UserAudioMixer.ts`, `src/VoiceControls.ts`.
- Reconnect logic: `reconnectLater`/`reconnectNow`/`cancelReconnect` in
  `src/LiveKitClient.ts` (our code inside an upstream file).
- Settings window design (`src/LiveKitAVConfig.ts`): the layout and grouping
  are ours, but the file is upstream-derived — rebuild it rather than copy.

Not worth carrying: the classic-UI paths (Foundry's own dock decorated),
upstream's `LiveKitClient` structure (one 2,400-line class), the
`useExternalAV` web client, Tavern Patreon server support (unless wanted).

## 8. Suggested milestones

1. Repository, licence, build (Vite, TypeScript strict, ESLint, Prettier,
   lang validation), Playwright harness with N users, local LiveKit.
2. Session core + LiveKit provider: connect, publish, subscribe, mute/deafen,
   speaking, reconnect state machine; network-impairment tests.
3. UI: dock, voice panel, settings window, player list — on the core's state.
4. Media pipeline: voice gate, noise models (lazy), per-user volume.
5. Camera background in a worker, lazy, fail-closed; measured budgets.
6. Second provider: Foundry P2P (no server) to prove the interface.
7. Jitsi provider (lib-jitsi-meet), then an embedded-iframe mode.
8. Migration: read the old module's client settings where sensible; docs;
   releases (the fork's `RELEASING.md` flow, or GitHub Actions).

Performance budgets to hold (measure in the harness, GPU Chrome): no long
task over 50 ms from the module with effects off; camera effect ≤ 15% of the
main thread at the default quality; no growth in memory over a 2-hour
session; idle module (connected, nobody talking) ≈ 0 timers firing more
often than once a second while the tab is hidden.
