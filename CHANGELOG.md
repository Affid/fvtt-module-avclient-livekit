# LiveKit A/V Client for FoundryVTT: Changelog

## 0.6.8-krisp.5

- Input sensitivity like Discord. In Voice Activity mode your microphone is only sent while you speak:
  - "Automatically determine input sensitivity" (on by default) learns the level of your background noise within a moment and sends audio that is clearly louder. It keeps up with a noisier or quieter room, without rising while you talk.
  - Turn it off to set the threshold yourself on the level meter.
  - The level meter shows what is being judged and turns green while your voice is being sent. It also works while you are muted.
  - It works after noise cancellation (including Krisp), so it judges your voice rather than the noise.
  - The speaking ring around your avatar now shows exactly when you are being sent.
  - Changes in the A/V Settings window are heard right away and undone if you close the window without saving.
  - The Input Sensitivity settings only show in Voice Activity mode; with push to talk, the key decides.
- The push to talk release delay is a slider from 0 to 2000 ms.
- Auto gain control can now be used with Krisp.
- Fix Krisp turning itself off, and sending your microphone unfiltered, after the microphone restarted (for example when changing the input device).
- Fix the level meter staying empty while muted or using push to talk.
- If input sensitivity can't start, noise cancellation keeps running without it.
- The old "Silence sounds below the threshold" switch is gone; your threshold is kept for manual sensitivity.

## 0.6.8-krisp.4

- The Discord-style interface now looks and behaves as one app: the voice panel, voice settings, noise suppression menu, user volume menu, camera views and the A/V Settings window share the same colors, buttons, switches, sliders, menus and tooltips.
- Menus work with the keyboard: arrow keys, Home and End move between items, Escape closes the menu and returns to the button that opened it. Every control has a visible focus ring and a label for screen readers.
- Voice settings: choose Voice Activity or Push to Talk with a two-way switch.
- The A/V Settings window keeps its dark look with Foundry's light theme; its section list is aligned and no longer outlined in orange.
- Fixes for Foundry v13 and v14:
  - The camera dock's connect/disconnect toggle shows the right state (it showed "Connect" while connected).
  - With the Discord-style interface, a camera view shows the user's round avatar whenever their video is hidden, and the speaking ring and mute/deafen badges replace Foundry's border and red icons.
  - Turning your camera back on shows it in your camera view again.

## 0.6.8-krisp.3

- Fix all of the module's text showing as raw keys (e.g. `LIVEKITAVCLIENT.voiceSettings`): the English language file failed to load.
- Fix the A/V Settings window not opening.
- Radio buttons in the voice settings now match the rest of the interface.

## 0.6.8-krisp.2

- Add a Discord-style interface (on by default; turn it off with the "Discord-style interface" setting):
  - A voice panel above the player list with connection status and ping, disconnect, mute, deafen, noise suppression, and voice settings. Drag it by its status row to move it.
  - Deafen mutes everyone else and your microphone; other users see that you are deafened.
  - Camera views show a green ring around whoever is speaking, the user's avatar while their camera is off, and mute/deafen badges.
  - Right-click another user's camera view to set their volume from 0% to 200%, or mute them just for yourself.
  - Voice settings: input and output devices, voice activity or push to talk (with the shortcut), input sensitivity with a live level meter, and noise suppression.
- The noise gate is now set as the input sensitivity in the voice settings.
- New A/V Settings window in the same style, for players and the GM, replacing Foundry's A/V configuration: a sidebar with the player's own settings (voice, noise & quality, video, appearance, advanced) and the GM's world settings (server, player options, troubleshooting), saved from an "unsaved changes" bar. The module's settings no longer clutter Foundry's module settings list, which links to this window instead.
- GM player options: allow the Discord-style interface, allow Krisp, and choose the default noise cancellation model for players who haven't picked one.

## 0.6.8-krisp.1

- Add **Krisp** as a noise cancellation model when connected to a LiveKit Cloud server (via `@livekit/krisp-noise-filter`). It is only offered on LiveKit Cloud with a supported browser; otherwise, or if it fails to start, the default open-source model is used instead. Auto gain control and the noise gate are not used while Krisp is active.
- Fix the microphone going silent when changing the input device with noise cancellation enabled.
- Noise cancellation settings now update the microphone in place instead of re-publishing it, and a model that fails to start falls back gracefully with a notification.
- Add selectable noise suppression model for Enhanced Noise Cancellation: **GTCRN** (strongest neural model, default), **RNNoise** (balanced), and **Speex** (lightest on CPU). Selected from the new noise cancellation button in your camera controls or the "Noise Cancellation" setting; all models run entirely in the browser and work with self-hosted LiveKit servers.

## 0.6.8

- Update dependencies, including livekit-client v2.19.2

## 0.6.7

- Update patreon URL

## 0.6.6

- Update dependencies, including livekit-client v2.17.3
- Verify compatibility with FoundryVTT v14

## 0.6.5

- Update dependencies, including livekit-client v2.17.1
- Fix saving of volume slider value on popped out camera views

## 0.6.4

- Update dependencies
- Fix volume slider on standard and popped out camera views

## 0.6.3

- Update dependencies
- Re-add custom hooks for custom service integrations
- Fix nameplate fade issue when using the connection quality indicator

## 0.6.2

- Update dependencies
- Add Polish language translation (Thanks Jakub!)

## 0.6.1

- Mirror the local camera view, fixing a bug in core FoundryVTT v13.
- Improve the initial loading when settings are empty, reducing the number of
  reloads and eliminating the need for manual reloads.

## 0.6.0

- Major refactor for FoundryVTT v13 compatibility

## 0.5.31

- Improve the regex when finding the URL for use with the External A/V page

## 0.5.30

- Validate compatibility with FoundryVTT v12

## 0.5.29

- Improve error handling for At the Tavern Patreon accounts

## 0.5.28

- Revert to livekit-client v1.15.13. There is an echo issue with v2.1.0 that
  needs to be resolved before it can be used

## 0.5.27

- Update dependencies, including livekit-client v2.1.0

## 0.5.26

- Update dependencies, including livekit-client v1.15.13
- Includes a possible workaround for a chrome AV1 encoding issue:
  <https://issues.chromium.org/issues/331565934?pli=1>

## 0.5.25

- Fix the un-hidding of the authentication token input field for the Tavern
  LiveKit cluster

## 0.5.24

- Add a way to paste the authentication token into settings when using the
  Tavern LiveKit cluster on the Electron based FoundryVTT client

## 0.5.23

- Adjust simulcast resolutions to better fit FVTT's default camera view sizes
- Add Patreon authentication for the Tavern LiveKit cluster

## 0.5.22

- Updates to support Foundry v11
- Update dependencies, including livekit-client v1.11.4
- Update dependency handling to Yarn v3

## 0.5.21

- Update dependencies, including livekit-client v1.8.0

## 0.5.20

- Update dependencies, including livekit-client v1.7.1
- Set compatibility to include FoundryVTT v11

## 0.5.19

- Catch errors when trying to get a list of media devices
- Switch to using LiveKit's media device listing method

## 0.5.18

- Update dependencies, including livekit-client v1.6.5
- Update web-client for livekit-client v1.5.0
- Update token signing to a dependency that supports client-side JWT signing
- Minor updates to support Foundry v10.291
- A temporary fix to AVSettings to prevent camera flickering during
  mute/un-mute (will be removed when FoundryVTT integrates this patch)
- Fix to always create the web audio element when a track is provided

## 0.5.17

- Once again fix manifest for v9 compatibility entry

## 0.5.16

- Fix manifest for v9 compatibility entry

## 0.5.15

- Update dependencies
- Switch foundry-vtt-types to github version for v10 compatibility
- Update manifest attributes for current standards to remove FoundryVTT
  warnings

## 0.5.14

- Fix documentation typo (thank, Lektu!)
- Updated Spanish translations (thanks, @lozalojo!)
- Update dependencies, including livekit-client v1.5.0 (now with stereo audio
  support!)
- Update web-client for livekit-client v1.5.0
- Set Audio Music Mode and screen sharing to prefer stereo input
- Set max audio bitrate to 224 to prevent browser crashes
- Increase the default audio quality to match new LiveKit defaults
- Re-render the main settings page if it is open when LiveKit settings are
  changed

## 0.5.13

- Update dependencies, including livekit-client v1.3.3
- Update README links to LiveKit server installation guides

## 0.5.12

- Update README to include new informational badges and link to our community
  Discord server
- Add a `LiveKit AVClient` tab under Audio/Video Configuration to easily access
  module settings
- Update dependencies, including livekit-client v1.3.1

## 0.5.11

- Add Dock Position settings in config screen for FoundryVTT v10.283

## 0.5.10

- Add adjustable bitrate for Music Mode

## 0.5.9

- Add an Audio Music Mode to tune settings for streaming audio from your A/V
  session
- Update dependencies, including livekit-client v1.3.0

## 0.5.8

- **Note**: It seems that the latest LiveKit release has adjusted the way the
  Connection Quality is calculated. It seems to be much more sensitive in my
  testing. A lower quality indicator may not mean your connection is unstable
- Update dependencies, including livekit-client v1.2.11
- Update web client for livekit-client v1.2.11
- Display the reason for a disconnect when provided by the server
- Updates to support FVTT v10.278; includes Nameplate settings and rendering on
  new settings changes
- Switch to injecting custom elements into CameraViews instead of making a full
  copy of CameraViews. This allows better compatibility with FVTT v10
- Fix the Connection Quality Indicator for FVTT v10

## 0.5.7

- Update dependencies, including livekit-client v1.2.0

## 0.5.6

- Update dependencies, including livekit-client v1.1.8

## 0.5.5

- Update dependencies, including livekit-client v1.1.2

## 0.5.4

- Spanish translation updates thanks to @lozalojo
- Update dependencies, including livekit-client v1.1.1

## v0.5.3

- Temporarily disable custom CameraViews with FVTT v10 until I can update to
  support the new layout
- Update dependencies, including livekit-client v1.0.4

## v0.5.2

- Set minimum FVTT compatible version to v9.238
- Update dependencies, including livekit-client v1.0.1

## v0.5.1

- Update README to add a features section
- Update README to list The Forge as having hosted servers
- Update dependencies
- Update settings applications to run more reliably
- Add new liveKitClientAvailable hook
- Update liveKitClientInitialized hook to pass the LiveKitClient object
- Take control of the CameraViews UI for customization
- Add the ability to hide or mute individual users from the CameraViews
- Add the ability to include server details to custom LiveKit Server Types

## v0.5.0

- Update dependencies, including LiveKit JS Client SDK v1.0.0
- Fix typo in connection info check (Thanks @kakaroto!)
- Make getAccessToken async (Thanks @kakaroto!)
- Add debugging method to return user track statistics
- Hide debug info in the experimental web client
- Split room creation and connection logic to support newer JS Client SDKs
- Automatically remove the protocol from provided LiveKit Server Addresses
- Add logic for LiveKit Server types
- Add an At the Tavern LiveKit Server type

## v0.4.0

- Update dependencies, including LiveKit JS Client SDK v0.17.5
- Update to support FVTT v10
- Update to support new LiveKit version
- Add warning about using Duck DNS to README
- Update workflow to initially tag new releases as prerelease
- Remove PTT Key from settings to match current FVTT versions
- Enable new Simulcast, Dynacast, and Adaptive Stream settings from LiveKit
- Allow for higher resolution with auto scaling based on camera view sizes
- Fix and update experimental web client

## v0.3.5

- Spanish translation updates thanks to @lozalojo
- Minor adjustment of the PTT Configure Controls string
- Fix volume setting on refresh when volume is set to 0
- Update documentation for LiveKit server recommendations

## v0.3.4

- Remove the PTT key settings from the Audio/Video Configuration page. This is
  now set under the Game Settings - Configure Controls page

## v0.3.3 - Let's do the time warp again

- Allow for a 15 minute variance between the LiveKit server clock and the
  user's clock. This will hopefully reduce the number of cases where a user's
  clock being off by a couple of minutes causes the connection to fail.
- Update dependencies

## v0.3.2

- Spanish translation updates thanks to @lozalojo
- Set FVTT compatibility to v9
- Update README for current settings page text

## v0.3.1

- Add missing method needed for v9
- Update styles to prevent left control bar from getting covered by the bottom
  control bar

## v0.3.0

- Update compatibility for FoundryVTT v9.231
- Handle our own Settings template now that the core version does not provide
  the settings we need
- Force server type to custom since FVTT is not a valid option
- Minor English language updates
- Spanish translation updates thanks to @lozalojo
- Dependency updates

## v0.2.5

- Add a connection quality indicator using LiveKit's connection quality
  metrics. This can be disabled as a client module setting
- Don't stop local tracks when disconnecting from a room. This makes
  reconnecting and switching to a breakout room faster and a bit more stable
- Minor code cleanups
- Update dependencies, including livekit-client v0.14.3
- Updated Spanish translation and configuration strings (thanks to José E.
  Lozano - @lozalojo!)

## v0.2.4

- This release is mostly to test new events available with LiveKit server and
  client versions 0.14
- Update dependencies, including livekit-client v0.14.2
- Small updates to support new version of livekit-client, including some debug
  lines for new RoomEvents
- Add temporary method for printing each user's connection quality. A future
  release can use this data for a proper connection quality indicator in the UI

## v0.2.3

- This release focuses mostly on adding debugging functions
- Add error logging for failed track subscriptions
- Update dependencies
- Add ability to issue command for all other users to connect/disconnect/render
  with socket events. For example: `game.socket.emit("module.avclient-livekit", {
action: "connect" });`
- General code cleanup
- Await tracks publishing during connect
- Add screen sharing option. This is an unsupported feature designed for
  debugging, but can be used with a script command
  `game.webrtc.client._liveKitClient.shareScreen(true)`

## v0.2.2

- Revert workaround for bluetooth issues and update to LiveKit client v0.13.6
  for proper fix
- Add module setting to allow joining A/V using a web client in a separate
  browser window

## v0.2.1

- Don't stop audio tracks when muting to avoid possible issues with bluetooth
  devices
- Set FVTT compatibility to v0.7.2 - v9.224

## v0.2.0

- Add breakout room support. Split the party!
- Clean up disconnection steps
- Update dependencies

## v0.1.0

- Prepare for initial announced release
- Update dependencies, including livekit-client v0.13.1
- Improve error message when a client's clock is set incorrectly

## v0.0.11

- Allow simulcast to be enabled, but default to off. It now works, but savings
  aren't as high as originally thought. It may still be helpful to enable for
  low-resource clients, but it means that they may stop sending or receiving
  video if their CPU or connection cannot handle all of the streams.
- Set a default video encoding that saves some resources but still looks good
  based on configured resolution
- Allow users to disable receiving audio and or video. Not receiving video may
  help for users with limited CPU or bandwidth
- Minor typescript updates
- Minor English language fixes
- Minor logging fixes

## v0.0.10

- Disable simulcast again, due to a server side bug
- Minor dependency updates

## v0.0.9

- Update livekit-client dependency to v0.12.1 with fixes for the mute-loop
  issue

## v0.0.8

- Minor dependency updates

## v0.0.7

- Update dependencies
- Switch to new fix for livekit-client "mute-loop" issue

## v0.0.6

- Update dependencies
- Re-enable simulcast now that LiveKit server no longer crashes when it is used

## v0.0.5

- Update dependencies and supporting code
- Don't run setAudioEnabledState when the server isn't yet connected or the
  state is already set correctly
- Temporarily use a forked version of the livekit-client SDK to resolve the
  "mute-loop" issue
- Add an experimental web-client for testing. This is not yet available in the
  main module UX

## v0.0.4

- Temporarily disable simulcast as it seems to be crashing the livekit server

## v0.0.3

- Add simulcast option with default enabled
- Minor typescript code adjustments
- Minor English language fix

## v0.0.2

- Always return our own user ID as connected so our video window is shown

## v0.0.1

- Initial release
