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
  private rumbleGain?: GainNode;
  private rumbleFilter?: BiquadFilterNode;
  private riserGain?: GainNode;
  private buffers = new Map<SampleId, AudioBuffer>();
  private loading?: Promise<void>;
  private activeImpact?: ActiveImpact;
  private duckUntil = 0;
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

  start() { this.controller.reset(); this.activeImpact = undefined; this.duckUntil = 0; }

  update(input: DynoAudioInput): DynoAudioState {
    const state = this.controller.update(input);
    if (!this.enabled || !this.context || !this.master) return state;
    this.updateLayers(state);
    if (state.event) this.trigger(state.event);
    return state;
  }

  stop() {
    if (!this.context) return;
    const at = this.context.currentTime;
    this.rumbleGain?.gain.setTargetAtTime(.0001, at, .16);
    this.riserGain?.gain.setTargetAtTime(.0001, at, .08);
    this.fadeImpact(.18);
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

    const rumbleGain = context.createGain();
    const rumbleFilter = context.createBiquadFilter();
    const rumbleA = context.createOscillator();
    const rumbleB = context.createOscillator();
    rumbleA.type = "sawtooth";
    rumbleB.type = "sine";
    rumbleA.frequency.value = 72;
    rumbleB.frequency.value = 38;
    rumbleGain.gain.value = .0001;
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 420;
    rumbleA.connect(rumbleFilter);
    rumbleB.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain).connect(master);
    rumbleA.start();
    rumbleB.start();
    this.rumbleGain = rumbleGain;
    this.rumbleFilter = rumbleFilter;

    const riser = context.createOscillator();
    const riserGain = context.createGain();
    riser.type = "triangle";
    riser.frequency.value = 260;
    riserGain.gain.value = .0001;
    riser.connect(riserGain).connect(master);
    riser.start();
    this.riserGain = riserGain;
  }

  private updateLayers(state: DynoAudioState) {
    const context = this.context!;
    const at = context.currentTime;
    const powerBlend = Math.max(0, Math.min(1, (state.filteredPower - 270) / 620));
    const duck = at < this.duckUntil ? .68 : 1;
    this.rumbleGain?.gain.setTargetAtTime(.0001 + Math.pow(powerBlend, 1.6) * .12 * duck, at, .1);
    this.rumbleFilter?.frequency.setTargetAtTime(380 + powerBlend * 3200, at, .12);
    const riseBlend = Math.max(0, Math.min(1, (state.riseWattsPerSecond - 35) / 260));
    const riserAllowed = state.filteredPower > 250 ? riseBlend : 0;
    this.riserGain?.gain.setTargetAtTime(.0001 + riserAllowed * .055 * duck, at, .07);
    this.log(`rumble ${Math.round(powerBlend * 100)}% · riser ${Math.round(riserAllowed * 100)}%`);
  }

  private trigger(event: DynoAudioEvent) {
    const context = this.context;
    if (!context || !this.master) return;
    this.log(`${event.kind}${event.threshold ? ` ${event.threshold}W` : ""}`);
    this.duckUntil = context.currentTime + (event.priority >= 80 ? .6 : .34);
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
    if (threshold < 200) this.playSample("applause", .18, .85, event.priority);
    else if (threshold < 300) this.playSample("applauseStadium", .42, 1.25, event.priority);
    else if (threshold < 400) this.playSample("explosion", .42, .85, event.priority);
    else if (threshold < 500) this.playSample("explosionDeep", .7, 1.2, event.priority);
    else if (threshold < 600) this.playSample("explosionImpact", .88, 1.55, event.priority);
    else if (threshold < 700) this.playSample("explosionImpact", 1, 1.8, event.priority);
    else if (threshold < 800) this.playSample("explosionDeep", 1, 2.1, event.priority);
    else if (threshold < 900) this.playSample("explosionImpact", 1, 2.5, event.priority);
    else this.playSample("cheer", .68, 2.7, event.priority);
  }

  private playSample(id: SampleId, volume: number, duration: number, priority: number) {
    const context = this.context!;
    const buffer = this.buffers.get(id);
    if (!buffer || !this.master) return;
    if (this.activeImpact && this.activeImpact.priority > priority) return;
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
    source.stop(context.currentTime + Math.min(duration, buffer.duration));
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
