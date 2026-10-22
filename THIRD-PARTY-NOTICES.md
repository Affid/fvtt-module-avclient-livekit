# Third-Party Notices

This module bundles the following third-party components for the client-side
noise cancellation and camera background features. The open-source ones are
used under permissive licenses; their copyright and license notices are
reproduced below.

## @sapphi-red/web-noise-suppressor

- License: MIT
- Copyright (c) 2022 翠 / green
- https://github.com/sapphi-red/web-noise-suppressor

Provides the Web Audio `AudioWorklet` nodes and WebAssembly builds used to run
the noise suppression models in the browser. It bundles the following models:

### RNNoise

- License: BSD-3-Clause
- Copyright (c) 2017, Mozilla; Copyright (c) 2007-2017, Jean-Marc Valin et al.
- https://github.com/xiph/rnnoise (WASM build via https://github.com/shiguredo/rnnoise-wasm)

### Speex (SpeexDSP preprocess)

- License: BSD-3-Clause
- Copyright 2002-2008 Xiph.org Foundation, Jean-Marc Valin et al.
- https://github.com/xiph/speexdsp (WASM build via https://github.com/sapphi-red/speex-preprocess-wasm)

### GTCRN

- License: MIT
- Copyright (c) Xiaobin Rong
- https://github.com/Xiaobin-Rong/gtcrn (WASM build via https://github.com/sapphi-red/gtcrn-wasm)
- The GTCRN WASM build embeds the `pffft` FFT library (FFTPACK / UCAR
  BSD-style license); its notice is included in the bundled worklet assets.

The vendored assets are served locally from this module under
`public/rnnoise/`, `public/speex/`, and `public/gtcrn/`; nothing is fetched from
a third-party CDN at runtime.

## @livekit/track-processors

- License: Apache-2.0
- Copyright LiveKit, Inc.
- https://github.com/livekit/track-processors-js

Blurs or replaces the background of your camera video. It is bundled as a
separate, lazily loaded chunk (`video-background-*.js`), and uses:

### MediaPipe Tasks Vision

- License: Apache-2.0
- Copyright Google LLC
- https://github.com/google-ai-edge/mediapipe (npm: `@mediapipe/tasks-vision`)

Its WebAssembly runtime is served from this module under `mediapipe/`.

### MediaPipe Selfie Segmentation model

- License: Apache-2.0
- Copyright Google LLC
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf

Finds the person in each camera frame. Vendored as
`public/mediapipe/selfie_segmenter.tflite` (float16, version 1); nothing is
fetched from a third-party CDN at runtime.

## @livekit/krisp-noise-filter

- License: proprietary, see https://livekit.io/legal/terms-of-service
- Copyright LiveKit, Inc.
- https://www.npmjs.com/package/@livekit/krisp-noise-filter

Provides the optional Krisp noise filter, which is only used when connected to
a LiveKit Cloud server. It is bundled as a separate, lazily loaded chunk
(`krisp-noise-filter-*.js`), and downloads its models from
`integrations.livekit.io` when used.
