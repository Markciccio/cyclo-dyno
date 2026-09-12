import { describe, expect, it } from "vitest";
import { DynoAudioController } from "../services/dynoAudioController";

const sample = (powerWatts: number, timestamp: number, peakPower = powerWatts, best5s: number | null = null) => ({
  powerWatts,
  timestamp,
  peakPower,
  best5s,
});

describe("DynoAudioController", () => {
  it("se salta più soglie emette soltanto la più alta", () => {
    const controller = new DynoAudioController();
    controller.update(sample(0, 0));
    expect(controller.update(sample(620, 1000)).event).toMatchObject({ kind: "threshold", threshold: 500 });
  });

  it("non ripete un'esplosione restando nella stessa fascia", () => {
    const controller = new DynoAudioController();
    controller.update(sample(0, 0));
    expect(controller.update(sample(430, 1000)).event?.threshold).toBe(400);
    expect(controller.update(sample(430, 5000)).event).toBeUndefined();
  });

  it("riarma una fascia solo dopo essere sceso sotto la sua isteresi", () => {
    const controller = new DynoAudioController();
    controller.update(sample(0, 0));
    controller.update(sample(430, 1000));
    controller.update(sample(300, 3000));
    expect(controller.update(sample(430, 5000)).event?.threshold).toBe(400);
  });

  it("dà priorità al record personale rispetto alla soglia", () => {
    const controller = new DynoAudioController();
    controller.update({ ...sample(0, 0), personalPeak: 300 });
    expect(controller.update({ ...sample(360, 1000, 360), personalPeak: 300 }).event).toMatchObject({ kind: "record" });
  });

  it("dà priorità al traguardo overdrive da 400 W", () => {
    const controller = new DynoAudioController();
    controller.update({ ...sample(0, 0), personalPeak: 400 });
    expect(controller.update({ ...sample(460, 1000, 460), personalPeak: 400 }).event).toMatchObject({ kind: "threshold", threshold: 400 });
  });

  it("segnala un miglioramento rilevante sui 5 secondi una sola volta", () => {
    const controller = new DynoAudioController();
    controller.update({ ...sample(0, 0, 0, 0), personalBest5s: 300 });
    expect(controller.update({ ...sample(240, 1000, 240, 305), personalBest5s: 300 }).event).toMatchObject({ kind: "best5" });
    expect(controller.update({ ...sample(240, 5000, 240, 310), personalBest5s: 300 }).event).toBeUndefined();
  });

  it("riproduce un jingle per ogni nuovo picco nella stessa fascia", () => {
    const controller = new DynoAudioController();
    controller.update(sample(0, 0));
    // Il primo 240 W è una soglia (200); il secondo massimo non attraversa
    // soglie e deve quindi diventare un peak-jingle autonomo.
    controller.update(sample(240, 1000, 240));
    expect(controller.update(sample(260, 3000, 260)).event).toMatchObject({ kind: "peak", threshold: 200 });
  });
});
