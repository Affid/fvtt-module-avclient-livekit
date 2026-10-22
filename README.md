# LiveKit AVClient

[![Join our Discord](https://img.shields.io/discord/909201876740890694?color=5865F2&logo=discord&logoColor=white)](https://discord.gg/Tcp9JtbpC5)
[![Become a Patron](https://img.shields.io/badge/support-patreon-orange.svg?logo=patreon)](https://tavern.at/patreon)
[![Donate via Ko-Fi](https://img.shields.io/badge/donate-ko--fi-red.svg?logo=ko-fi)](https://ko-fi.com/bekit)
[![Latest Version](https://img.shields.io/github/v/release/Affid/fvtt-module-avclient-livekit?label=version)](https://github.com/Affid/fvtt-module-avclient-livekit/releases)
[![Download Count](https://img.shields.io/github/downloads/Affid/fvtt-module-avclient-livekit/latest/module.zip)](https://github.com/Affid/fvtt-module-avclient-livekit/releases)

## About

A replacement for the native SimplePeer / EasyRTC A/V client in FoundryVTT. The module uses [LiveKit](https://livekit.io/) platform to provide Audio & Video communication between players.

> :warning: **SSL is still required**
>
> The LiveKit AVClient does not remove the need for SSL (https) on your Foundry server. Even if you use one of the hosted solutions below, all modern browsers require that the page that A/V is viewed on be secured. You can follow the following guide to set up SSL on your Foundry server: [Foundry VTT - SSL & HTTPS](https://foundryvtt.com/article/ssl/)

**Note:** _At the moment, there are no free public LiveKit servers. You must configure a custom signaling server under Audio/Video communication or use one of the following options:_

[At the Tavern](https://tavern.at) is providing access to a multi-region LiveKit server cluster that we maintain to anyone who subscribes to our [Patreon](https://www.patreon.com/tavern_at) at at least a $5 USD per month level. The fee is used to cover the cost of the server cluster and contribute toward further development of this module.

[Forge](https://forge-vtt.com/) users can make use of the Forge's LiveKit servers with no additional configuration required.

[LiveKit Cloud](https://livekit.io/) provides a free tier, for a limited number of minutes/bandwidth per month. It may not be suitable for larger games or frequent use.

## Installation

You can install this module by using the following manifest URL: <https://github.com/Affid/fvtt-module-avclient-livekit/releases/latest/download/module.json>

This is a fork of [bekriebel/fvtt-module-avclient-livekit](https://github.com/bekriebel/fvtt-module-avclient-livekit) that adds selectable noise cancellation models, including Krisp on LiveKit Cloud. See [RELEASING](/RELEASING.md) for how releases of this fork are published.

## Configuration

Install & enable the module then configure for your LiveKit instance under Audio/Video Configuration:

**LiveKit Server:** Select an available option or _Custom_ for your own server  
**LiveKit Server Address:** `rtc.example.com` \<Your LiveKit server address\>  
**LiveKit API Key:** `ABCDEFGHIJ12345` \<Your LiveKit API Key>  
**LiveKit Secret Key:** `****************` \<Your LiveKit Secret Key\>

## Features

LiveKit AVClient provides a number of features beyond the A/V option built into Foundry:

- Uses a Selective Forwarding Unit (SFU) architecture instead of Mesh. This means each user only has to send their their audio and video once instead of needing to connect to every other user in the game.
- LiveKit server connections work in more network environments.
- [Breakout Rooms](#breakout-rooms) allow you to split the party!
- Adaptive Streaming and Dynamic Broadcasting reduce bandwidth and CPU usage based on video window size and available system resources.
- Opus DTX reduces bandwidth used by audio tracks when a user isn't speaking.
- A Connection Quality Indicator shows if a user's connection is having trouble.
- An optional external web client can be used to open audio and video in a separate tab, or even separate device (including mobile).
- The ability for individual users to disable receiving video in case they are on very limited connections.
- The ability to individually hide or mute users only for yourself.
- Audio Music Mode to tune audio publishing settings for audio streamed by your account.
- Actively maintained and tested against the latest versions of FoundryVTT.
- Additional features planned for future releases!

## How to use

### **Breakout Rooms**

A GM can now split the party!

To start a breakout room, right-click on the player you would like to break out in the player list and select `Start A/V breakout`. You will join a different A/V session with that user. You can now right-click on other users and pull them into the breakout room, or start yet another breakout room with another user.

![start breakout example](https://raw.githubusercontent.com/bekriebel/fvtt-module-avclient-livekit/main/images/example_start-breakout.png)

Though the GM will always join the breakout room on creation, they can leave the breakout room themselves by right-clicking on their own username and selecting `Leave A/V Breakout`. Users can also leave a breakout at any time by right-clicking on their own name, and the GM can end all breakout rooms by selecting `End all A/V breakouts`.

![start breakout example](https://raw.githubusercontent.com/bekriebel/fvtt-module-avclient-livekit/main/images/example_end-breakout.png)

## Running your own LiveKit server

There are several examples available for launching your own livekit server:

- [User created guides for FoundryVTT](https://github.com/bekriebel/fvtt-module-avclient-livekit/wiki)
- [LiveKit Getting Started](https://docs.livekit.io/guides/getting-started)
- [Deploy to a VM (GCP/AWS/Digital Ocean/Linode/Vultr/etc)](https://docs.livekit.io/deploy/vm)
- [Deploy to Kubernetes](https://docs.livekit.io/deploy/kubernetes)

Though newer versions may work, the current recommended LiveKit server version is v0.15.6. This has had the most extensive testing done with the module and matches the current client SDK version that the module is using.

> :warning: **Duck DNS and Ad blockers**: Several ad blockers seem to block websocket connections to Duck DNS URLs. If you are using Duck DNS for your LiveKit Server domain name, you and your users may need to whitelist the domain name in ad blocking extensions.

## Debugging

By default, debug logs are disabled. If additional logs are needed for troubleshooting, `Enable debug logging` can be turned on under the module settings. For even more logging of the LiveKit connection, LiveKit trace logging can be enabled after debugging logging is turned on by setting `Enable LiveKit trace logging` under module settings.

## Changelog

See [CHANGELOG](/CHANGELOG.md)

## Discord-style interface

By default, the module adds a Discord-style voice panel above the player list,
the one place for your voice controls: connection status and ping, a
disconnect button, and buttons to mute, deafen, turn your camera on or off,
choose the noise cancellation model, and open the voice settings (devices,
voice activity or push to talk, input sensitivity with a live level meter,
camera, and whether to show other users' video). Click the connection status
for details (ping, quality, server and region, codec, packet loss, noise
cancellation and input sensitivity) and to reconnect. Drag the panel by its
status row to move it.

The player list shows who is speaking with a green ring around their color,
and whether they are muted or deafened.

It also replaces Foundry's camera dock with its own:

- Each user's tile shows their video, or their avatar while their camera is
  off, a green ring while they speak, and badges when they are muted,
  deafened, muted by you, or have their camera off. Hover a tile for its
  connection quality.
- Three layouts: a grid, one user in focus with the others in a strip (click a
  tile to focus it, or let the focus follow whoever speaks), and a compact list
  of avatars like a Discord voice channel.
- Dock it on any side of the screen or let it float (drag it by its header,
  resize it by its corner), and collapse it to a slim bar of avatars. Change
  this from the button in the dock's header.
- Hover your own tile to mute yourself or turn your camera on or off.
  Right-click another user's tile to change their volume (up to 200%), mute
  them or hide their video just for yourself, focus them, pop their tile out
  into a window of its own, or watch them picture-in-picture. The GM can also
  block a user's audio or video, and use the breakout rooms from there.

Foundry's own A/V settings still apply: dock position and width, collapsing
the dock, nameplates, player color borders, and hidden users.

Turn this off under A/V Settings → Appearance (Foundry reloads to switch
camera docks). The GM can turn it off for everyone under A/V Settings → Player
Options.

## Settings

All audio/video settings are in one A/V Settings window, opened from Foundry's
"Configure Audio/Video" button, the voice panel, or the module's entry in
Foundry's module settings list:

- **My settings** (everyone): voice (devices, voice activity or push to talk,
  input sensitivity), noise & quality, video, appearance (Discord-style
  interface, camera dock, nameplates), and advanced options.
- **World** (GM only): the A/V mode and LiveKit server, player options (allow
  the Discord-style interface and Krisp, and the default noise cancellation
  model for players who haven't picked one), and troubleshooting (reset the
  meeting room, logging).

Changes are saved together from the bar at the bottom of the window.

## Noise cancellation

Click the wand button in your camera controls to choose a noise cancellation
model. The open-source models (GTCRN, RNNoise, and Speex) run entirely in your
browser and work with any LiveKit server.

When connected to a [LiveKit Cloud](https://livekit.io/cloud) server, **Krisp**
is also offered. It is LiveKit's noise filter: it requires a supported browser
(older Safari versions are not), and the browser downloads its models from
`integrations.livekit.io`. If Krisp is not available or fails to start, the
default open-source model is used instead.

## Input sensitivity

In Voice Activity mode, your microphone is only sent while you speak, like in
Discord. By default the sensitivity is set automatically: the module learns
the level of your background noise and sends audio that is clearly louder.
Turn off "Automatically determine input sensitivity" in the voice settings to
set the threshold yourself on the level meter, which turns green while your
voice is being sent. The input sensitivity works after noise cancellation, so
it judges your voice rather than the noise, and the speaking ring shows
exactly when you are being heard. With push to talk, the key decides instead.

## Third-party notices

The enhanced noise cancellation feature bundles open-source models
(RNNoise, Speex, and GTCRN) via
[`@sapphi-red/web-noise-suppressor`](https://github.com/sapphi-red/web-noise-suppressor),
and LiveKit's [`@livekit/krisp-noise-filter`](https://www.npmjs.com/package/@livekit/krisp-noise-filter).
See [THIRD-PARTY-NOTICES](/THIRD-PARTY-NOTICES.md) for their licenses and
attributions.
