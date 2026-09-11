export type DynoAudioEventKind =
  | "threshold"
  | "record-proximity"
  | "best5"
  | "record";

export type DynoAudioEvent = {
  kind: DynoAudioEventKind;
  priority: number;
  threshold?: number;
  proximity?: number;
};

export type DynoAudioInput = {
  powerWatts: number;
  timestamp: number;
  peakPower: number;
  best5s: number | null;
  personalPeak?: number;
  personalBest5s?: number;
};

export const DYNO_AUDIO_CONFIG = {
  smoothingMs: 320,
  eventCooldownMs: 650,
  recordCooldownMs: 2400,
  thresholds: [
    { watts: 100, rearmBelow: 75, priority: 10 },
    { watts: 200, rearmBelow: 165, priority: 20 },
    { watts: 300, rearmBelow: 255, priority: 30 },
    { watts: 400, rearmBelow: 345, priority: 40 },
    { watts: 500, rearmBelow: 455, priority: 50 },
    { watts: 600, rearmBelow: 545, priority: 60 },
    { watts: 700, rearmBelow: 635, priority: 70 },
    { watts: 800, rearmBelow: 725, priority: 80 },
    { watts: 900, rearmBelow: 815, priority: 90 },
  ],
  recordProximity: [0.9, 0.95, 0.985],
  proximityRearmDrop: 0.035,
  significantBest5Gain: 4,
  recordMarginWatts: 1,
} as const;

export type DynoAudioState = {
  filteredPower: number;
  riseWattsPerSecond: number;
  event?: DynoAudioEvent;
};

/**
 * Regole pure e testabili del Dyno: nessuna dipendenza da browser o WebAudio.
 * Il motore audio riceve un solo evento selezionato da qui e decide come suonarlo.
 */
export class DynoAudioController {
  private filteredPower = 0;
  private previousPower = 0;
  private previousTimestamp?: number;
  private lastEventAt = -Infinity;
  private lastRecordAt = -Infinity;
  private thresholdArmed = new Map(DYNO_AUDIO_CONFIG.thresholds.map((item) => [item.watts, true]));
  private proximityStage = -1;
  private recordAnnounced = false;
  private best5Announced = false;

  reset() {
    this.filteredPower = 0;
    this.previousPower = 0;
    this.previousTimestamp = undefined;
    this.lastEventAt = -Infinity;
    this.lastRecordAt = -Infinity;
    this.thresholdArmed = new Map(DYNO_AUDIO_CONFIG.thresholds.map((item) => [item.watts, true]));
    this.proximityStage = -1;
    this.recordAnnounced = false;
    this.best5Announced = false;
  }

  update(input: DynoAudioInput): DynoAudioState {
    const dt = this.previousTimestamp === undefined
      ? 0
      : Math.max(.016, Math.min(1, (input.timestamp - this.previousTimestamp) / 1000));
    const alpha = dt === 0 ? 1 : 1 - Math.exp((-dt * 1000) / DYNO_AUDIO_CONFIG.smoothingMs);
    this.filteredPower += (Math.max(0, input.powerWatts) - this.filteredPower) * alpha;
    const riseWattsPerSecond = dt === 0 ? 0 : (this.filteredPower - this.previousPower) / dt;
    this.previousPower = this.filteredPower;
    this.previousTimestamp = input.timestamp;

    const candidates: DynoAudioEvent[] = [];
    const crossed: number[] = [];
    for (const threshold of DYNO_AUDIO_CONFIG.thresholds) {
      const armed = this.thresholdArmed.get(threshold.watts) ?? true;
      if (!armed && this.filteredPower < threshold.rearmBelow) this.thresholdArmed.set(threshold.watts, true);
      if (armed && this.filteredPower >= threshold.watts) {
        this.thresholdArmed.set(threshold.watts, false);
        crossed.push(threshold.watts);
      }
    }
    // Un'accelerazione che attraversa molte fasce fa sentire soltanto il livello
    // più alto: è più appagante di una raffica di nove suoni.
    const highestThreshold = crossed.at(-1);
    if (highestThreshold) {
      const config = DYNO_AUDIO_CONFIG.thresholds.find((item) => item.watts === highestThreshold)!;
      candidates.push({ kind: "threshold", threshold: highestThreshold, priority: config.priority });
    }

    const personalPeak = input.personalPeak ?? 0;
    if (personalPeak > 0) {
      const ratio = input.peakPower / personalPeak;
      const stage = DYNO_AUDIO_CONFIG.recordProximity.reduce((best, value, index) => ratio >= value ? index : best, -1);
      if (stage > this.proximityStage) {
        this.proximityStage = stage;
        candidates.push({ kind: "record-proximity", proximity: DYNO_AUDIO_CONFIG.recordProximity[stage], priority: 70 + stage * 5 });
      } else if (stage < this.proximityStage && ratio < DYNO_AUDIO_CONFIG.recordProximity[this.proximityStage] - DYNO_AUDIO_CONFIG.proximityRearmDrop) {
        this.proximityStage = stage;
      }
      if (!this.recordAnnounced && input.peakPower >= personalPeak + DYNO_AUDIO_CONFIG.recordMarginWatts) {
        this.recordAnnounced = true;
        candidates.push({ kind: "record", priority: 120 });
      }
    }

    const personalBest5s = input.personalBest5s ?? 0;
    if (!this.best5Announced && input.best5s !== null && personalBest5s > 0 && input.best5s >= personalBest5s + DYNO_AUDIO_CONFIG.significantBest5Gain) {
      this.best5Announced = true;
      candidates.push({ kind: "best5", priority: 110 });
    }

    const best = candidates.sort((a, b) => b.priority - a.priority)[0];
    const important = best?.priority >= 100;
    const eligible = !best
      ? undefined
      : important
        ? input.timestamp - this.lastRecordAt >= DYNO_AUDIO_CONFIG.recordCooldownMs ? best : undefined
        : input.timestamp - this.lastEventAt >= DYNO_AUDIO_CONFIG.eventCooldownMs ? best : undefined;
    if (eligible) {
      this.lastEventAt = input.timestamp;
      if (eligible.priority >= 100) this.lastRecordAt = input.timestamp;
    }
    return { filteredPower: this.filteredPower, riseWattsPerSecond, event: eligible };
  }
}
