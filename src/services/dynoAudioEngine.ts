import applauseAudioUrl from "../assets/audio/applause.mp3";
import applauseThunderAudioUrl from "../assets/audio/applause-thunder.mp3";
import applauseStadiumAudioUrl from "../assets/audio/applause-stadium.mp3";
import crowdCheerAudioUrl from "../assets/audio/crowd-cheer.mp3";
import explosionAudioUrl from "../assets/audio/explosion.mp3";
import explosionDeepAudioUrl from "../assets/audio/explosion-deep.mp3";
import explosionImpactAudioUrl from "../assets/audio/explosion-impact.mp3";
import raceCountdownAudioUrl from "../assets/audio/race-countdown.mp3";
import whistleAudioUrl from "../assets/audio/whistle.mp3";
import { DynoAudioController, type DynoAudioEvent, type DynoAudioInput, type DynoAudioState } from "./dynoAudioController";

type SampleId = "applause" | "applauseThunder" | "applauseStadium" | "cheer" | "explosion" | "explosionDeep" | "explosionImpact" | "whistle";
const sampleUrls: Record<SampleId, string> = {
  applause: applauseAudioUrl,
  applauseThunder: applauseThunderAudioUrl,
  applauseStadium: applauseStadiumAudioUrl,
  cheer: crowdCheerAudioUrl,
  explosion: explosionAudioUrl,
  explosionDeep: explosionDeepAudioUrl,
  explosionImpact: explosionImpactAudioUrl,
  whistle: whistleAudioUrl,
};

type ActiveImpact = { source: AudioBufferSourceNode; gain: GainNode; priority: number };

/** Motore Web Audio centralizzato: layer continui + un solo evento importante alla volta. */
export class DynoAudioEngine {
  private controller = new DynoAudioController();
  private context?: AudioContext;
  private master?: GainNode;
  private buffers = new Map<SampleId, AudioBuffer>();
  private loading?: Promise<void>;
  private activeImpact?: ActiveImpact;
  private enabled = true;
  private debug = false;
  private countdown?: HTMLAudioElement;

  setDebug(enabled: boolean) { this.debug = enabled; }
  private log(message: string) { if (this.debug) console.info(`[AUDIO] ${message}`); }

  async prepare(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) return false;
    try {
      const context = this.context ?? new AudioContext();
      this.context = context;
      if (context.state !== "running") await context.resume();
      this.ensureLayers(context);
      if (!this.countdown) {
        this.countdown = new Audio(raceCountdownAudioUrl);
        this.countdown.preload = "auto";
        this.countdown.volume = .88;
        this.countdown.load();
      }
      if (!this.loading) {
        this.loading = Promise.all(Object.entries(sampleUrls).map(async ([id, url]) => {
          const response = await fetch(url);
          const bytes = await response.arrayBuffer();
          this.buffers.set(id as SampleId, await context.decodeAudioData(bytes));
        })).then(() => undefined).catch(() => undefined);
      }
      void this.loading;
      return true;
    } catch { return false; }
  }

  start() { this.controller.reset(); this.activeImpact = undefined; }

  update(input: DynoAudioInput): DynoAudioState {
    const state = this.controller.update(input);
    if (!this.enabled || !this.context || !this.master) return state;
    this.updateLayers(state);
    if (state.event) this.trigger(state.event);
    return state;
  }

  stop() {
    // L'esplosione oltre 500 W non deve sparire entrando nei risultati: la
    // lasciamo terminare naturalmente, al massimo dopo i suoi 3 secondi.
  }

  playCountdown() {
    if (!this.enabled || !this.countdown || this.countdown.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
    try {
      this.countdown.pause();
      this.countdown.currentTime = 0;
      void this.countdown.play();
      return true;
    } catch { return false; }
  }

  playCountdownStep(step: number) {
    if (!this.context || !this.enabled) return;
    this.playTone(step === 3 ? 620 : step === 2 ? 760 : 920, .1, .08, "square");
  }

  test() { this.trigger({ kind: "threshold", threshold: 800, priority: 80 }); }

  dispose() {
    this.stop();
    this.fadeImpact(.08);
    this.countdown?.pause();
    this.countdown = undefined;
    this.buffers.clear();
  }

  private ensureLayers(context: AudioContext) {
    if (this.master) return;
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = 7;
    master.gain.value = .96;
    master.connect(compressor).connect(context.destination);
    this.master = master;

  }

  private updateLayers(state: DynoAudioState) {
    // Niente tappeto sonoro: torna il feeling immediato da gioco arcade.
    // Conserviamo il valore filtrato nel controller per le soglie, ma ogni
    // reazione udibile è una breve ricompensa netta e leggibile.
    void state;
  }

  private trigger(event: DynoAudioEvent) {
    const context = this.context;
    if (!context || !this.master) return;
    this.log(`${event.kind}${event.threshold ? ` ${event.threshold}W` : ""}`);
    if (event.kind === "record-proximity") {
      this.playTone(event.proximity && event.proximity >= .985 ? 1040 : 760, .12, .055, "sine");
      return;
    }
    if (event.kind === "record") {
      this.playSample("cheer", .7, 2.5, event.priority);
      return;
    }
    if (event.kind === "best5") {
      this.playSample("applauseThunder", .48, 1.8, event.priority);
      return;
    }
    const threshold = event.threshold ?? 100;
    if (threshold < 500) {
      this.playArcadeCue(threshold);
      return;
    }
    // Il premio "grande" parte soltanto in overdrive. Ha la massima priorità
    // e viene lasciato completo: nessun fade quando la potenza ricade.
    this.playSample("explosionImpact", 1, 3.024, 1_000, true);
  }

  private playSample(id: SampleId, volume: number, duration: number, priority: number, complete = false) {
    const context = this.context!;
    const buffer = this.buffers.get(id);
    if (!buffer || !this.master) return;
    // A pari priorità l'effetto già avviato vince: l'esplosione non può essere
    // tagliata da un secondo attraversamento della fascia overdrive.
    if (this.activeImpact && this.activeImpact.priority >= priority) return;
    if (this.activeImpact) this.fadeImpact(.08);
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    const active: ActiveImpact = { source, gain, priority };
    this.activeImpact = active;
    source.onended = () => { if (this.activeImpact === active) this.activeImpact = undefined; };
    source.start();
    source.stop(context.currentTime + (complete ? buffer.duration : Math.min(duration, buffer.duration)));
  }

  private playArcadeCue(threshold: number) {
    // Arpeggi sintetici originali, volutamente "power-up" e non una copia di
    // una musica esistente. Brevi, ascendenti e facili da distinguere pedalando.
    if (this.activeImpact) return;
    const notes = threshold < 200
      ? [523, 659]
      : threshold < 300
        ? [587, 740, 880]
        : threshold < 400
          ? [659, 880, 1047]
          : [784, 988, 1175, 1568];
    notes.forEach((note, index) => {
      window.setTimeout(() => this.playTone(note, .07 + index * .008, .075, "square"), index * 72);
    });
  }

  private fadeImpact(seconds: number) {
    if (!this.activeImpact || !this.context) return;
    const { source, gain } = this.activeImpact;
    const at = this.context.currentTime;
    try {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(.0001, at, Math.max(.025, seconds / 4));
      source.stop(at + seconds);
    } catch { /* Già chiuso. */ }
    this.activeImpact = undefined;
  }

  private playTone(frequency: number, duration: number, volume: number, type: OscillatorType) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const at = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration + .02);
  }
}
