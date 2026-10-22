/**
 * Discord-style voice activity gate.
 *
 * Passes the microphone through while the level is above a threshold and
 * silences it otherwise. The threshold is either fixed (manual mode) or
 * follows the background noise (auto mode), sitting a fixed distance above
 * the noise floor. The floor is learned quickly when the gate starts, then
 * falls quickly to quieter levels and rises slowly towards the quietest level
 * of the last moments: speech has pauses, steady noise doesn't.
 *
 * Messages to the processor: { auto?: boolean, threshold?: number } (dBFS).
 * Messages from the processor, about every 16 ms and whenever the gate opens
 * or closes: { db, open, threshold } (dBFS).
 */

// The level is the mean square of the signal, smoothed with a faster time
// constant when it rises than when it falls
const LEVEL_ATTACK_S = 0.01;
const LEVEL_RELEASE_S = 0.06;
// Mean squares below this (about -100 dBFS) are digital silence, e.g. a muted
// microphone, and don't move the noise floor
const SILENCE = 1e-10;

// Auto mode: the threshold is this far above the noise floor, within limits
const AUTO_MARGIN_DB = 12;
const AUTO_MIN_THRESHOLD_DB = -60;
const AUTO_MAX_THRESHOLD_DB = -25;
const INITIAL_FLOOR_DB = -55;
// When the gate starts, the floor follows the level closely for a moment
const CALIBRATION_S = 0.5;
const CALIBRATION_TIME_S = 0.05;
// Then it falls to quieter levels with this time constant...
const FLOOR_FALL_S = 0.25;
// ...and rises at most this fast (dB per second) towards the quietest level
// of the last few segments
const FLOOR_RISE_CLOSED_DB_S = 6;
const FLOOR_RISE_OPEN_DB_S = 3;
const QUIET_SEGMENT_S = 0.5;
const QUIET_SEGMENTS = 3;

// The gate closes once the level has been this far below the threshold for
// the hold time
const HYSTERESIS_DB = 3;
const HOLD_S = 0.3;
// Gain ramps when opening and closing
const ATTACK_S = 0.005;
const RELEASE_S = 0.05;

const REPORT_INTERVAL_S = 0.016;

class VoiceActivityGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.auto = true;
    this.manualThreshold = -50;
    this.configure(options.processorOptions ?? {});

    this.level = SILENCE;
    this.floorDb = INITIAL_FLOOR_DB;
    this.calibrationRemaining = CALIBRATION_S;
    // The quietest level of each recent segment, and of the current one
    this.quietSegments = [];
    this.segmentQuietest = Infinity;
    this.segmentRemaining = QUIET_SEGMENT_S;
    this.open = false;
    this.holdRemaining = 0;
    this.gain = 0;
    this.untilReport = 0;
    this.gains = new Float32Array(128);

    this.port.onmessage = (event) => {
      this.configure(event.data ?? {});
    };
  }

  configure({ auto, threshold }) {
    if (typeof auto === "boolean") {
      this.auto = auto;
    }
    if (typeof threshold === "number" && Number.isFinite(threshold)) {
      this.manualThreshold = threshold;
    }
  }

  get threshold() {
    if (!this.auto) {
      return this.manualThreshold;
    }
    return Math.min(
      Math.max(this.floorDb + AUTO_MARGIN_DB, AUTO_MIN_THRESHOLD_DB),
      AUTO_MAX_THRESHOLD_DB,
    );
  }

  updateFloor(db, seconds) {
    this.segmentQuietest = Math.min(this.segmentQuietest, db);
    this.segmentRemaining -= seconds;
    if (this.segmentRemaining <= 0) {
      this.quietSegments.push(this.segmentQuietest);
      if (this.quietSegments.length > QUIET_SEGMENTS) {
        this.quietSegments.shift();
      }
      this.segmentQuietest = Infinity;
      this.segmentRemaining = QUIET_SEGMENT_S;
    }

    if (this.calibrationRemaining > 0) {
      this.calibrationRemaining -= seconds;
      this.floorDb +=
        (db - this.floorDb) * (1 - Math.exp(-seconds / CALIBRATION_TIME_S));
    } else if (db < this.floorDb) {
      this.floorDb +=
        (db - this.floorDb) * (1 - Math.exp(-seconds / FLOOR_FALL_S));
    } else {
      const quietest = Math.min(
        db,
        this.segmentQuietest,
        ...this.quietSegments,
      );
      const rise = this.open ? FLOOR_RISE_OPEN_DB_S : FLOOR_RISE_CLOSED_DB_S;
      if (quietest > this.floorDb) {
        this.floorDb = Math.min(this.floorDb + rise * seconds, quietest);
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const samples = input[0];
    const length = samples?.length ?? output[0]?.length ?? 128;
    const seconds = length / sampleRate;

    // Level
    let sum = 0;
    if (samples) {
      for (let i = 0; i < length; i++) {
        sum += samples[i] * samples[i];
      }
    }
    const meanSquare = samples ? sum / length : 0;
    const levelTime =
      meanSquare > this.level ? LEVEL_ATTACK_S : LEVEL_RELEASE_S;
    this.level +=
      (meanSquare - this.level) * (1 - Math.exp(-seconds / levelTime));
    const db = 10 * Math.log10(Math.max(this.level, SILENCE));

    // Noise floor
    if (this.auto && meanSquare >= SILENCE) {
      this.updateFloor(db, seconds);
    }

    // Open or close
    const threshold = this.threshold;
    const wasOpen = this.open;
    if (db >= threshold) {
      this.open = true;
      this.holdRemaining = HOLD_S;
    } else if (this.open) {
      if (db >= threshold - HYSTERESIS_DB) {
        this.holdRemaining = HOLD_S;
      } else {
        this.holdRemaining -= seconds;
        if (this.holdRemaining <= 0) {
          this.open = false;
        }
      }
    }

    // Apply the gain, ramping towards fully open or closed
    if (this.gains.length !== length) {
      this.gains = new Float32Array(length);
    }
    const target = this.open ? 1 : 0;
    const step = 1 / ((this.open ? ATTACK_S : RELEASE_S) * sampleRate);
    for (let i = 0; i < length; i++) {
      if (this.gain < target) {
        this.gain = Math.min(this.gain + step, target);
      } else if (this.gain > target) {
        this.gain = Math.max(this.gain - step, target);
      }
      this.gains[i] = this.gain;
    }
    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] ?? input[0];
      const destination = output[channel];
      if (!source) {
        destination.fill(0);
        continue;
      }
      for (let i = 0; i < length; i++) {
        destination[i] = source[i] * this.gains[i];
      }
    }

    // Report
    this.untilReport -= seconds;
    if (this.untilReport <= 0 || this.open !== wasOpen) {
      this.untilReport = REPORT_INTERVAL_S;
      this.port.postMessage({
        db: Math.round(db * 10) / 10,
        open: this.open,
        threshold: Math.round(threshold * 10) / 10,
      });
    }
    return true;
  }
}

registerProcessor("livekit-voice-activity-gate", VoiceActivityGateProcessor);
