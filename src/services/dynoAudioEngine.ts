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
const OVERDRIVE_RETRIGGER_MS = 6000;
const OVERDRIVE_WATTS = 400;
const OVERDRIVE_RELEASE_WATTS = 320;

/** Motore Web Audio centralizzato: layer continui + un solo evento importante alla volta. */
export class DynoAudioEngine {
  private controller = new DynoAudioController();
  private context?: AudioContext;
  private master?: GainNode;
  private buffers = new Map<SampleId, AudioBuffer>();
  private loading?: Promise<void>;
  private activeImpact?: ActiveImpact;
  private overdriveImpact?: ActiveImpact;
  private overdriveLatched = false;
  private lastOverdriveStartedAt = -Infinity;
  private coachCueUntil = -Infinity;
  private enabled = true;
  private debug = false;
  private countdown?: HTMLAudioElement;
  private mediaStatus = "non ancora testato";

  setDebug(enabled: boolean) { this.debug = enabled; }
  private log(message: string) { if (this.debug) console.info(`[AUDIO] ${message}`); }

  async prepare(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) return false;
    try {
      const context = this.context ?? new AudioContext();
      this.context = context;
      this.ensureLayers(context);
      // Creare anche l'elemento media prima dell'await conserva il gesto su iOS.
      if (!this.countdown) {
        this.countdown = new Audio(raceCountdownAudioUrl);
        this.countdown.preload = "auto";
        this.countdown.volume = .88;
        this.countdown.load();
      }
      // Bluefy/iOS autorizza l'audio soltanto se resume e il primo suono sono
      // avviati direttamente dal tocco dell'utente, prima di qualsiasi await.
      this.primeFromGesture(context);
      if (context.state !== "running") await context.resume();
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

  start() {
    this.controller.reset();
    this.fadeOverdrive();
    this.activeImpact = undefined;
    this.overdriveLatched = false;
    this.lastOverdriveStartedAt = -Infinity;
    this.coachCueUntil = -Infinity;
  }

  update(input: DynoAudioInput): DynoAudioState {
    const state = this.controller.update(input);
    if (!this.enabled || !this.context || !this.master) return state;
    // A 400 W l'overdrive si aggancia; la soglia di uscita è volutamente più
    // bassa per evitare "tagli" quando si oscilla vicini al limite.
    if (input.powerWatts >= OVERDRIVE_WATTS) this.startOverdrive();
    else if (this.overdriveLatched && input.powerWatts < OVERDRIVE_RELEASE_WATTS) this.fadeOverdrive();
    this.updateLayers(state);
    if (state.event) this.trigger(state.event);
    return state;
  }

  stop() {
    this.fadeOverdrive();
  }

  playCountdown() {
    if (!this.enabled || !this.countdown) return false;
    try {
      this.countdown.pause();
      this.countdown.currentTime = 0;
      void this.countdown.play();
      return true;
    } catch { return false; }
  }

  playCountdownStep(step: number) {
    if (!this.context || !this.enabled) return;
    // Tre bip brevi, con intonazione crescente: 3, 2, 1.
    const fundamental = 620 + (3 - step) * 70;
    this.playTone(fundamental, .13, .12, "square");
    this.playTone(fundamental * 1.5, .09, .035, "sine");
  }

  playCountdownStart() {
    if (!this.context || !this.enabled) return;
    // Il via è un segnale separato e più ampio dei tre bip: chiaro anche su
    // altoparlanti piccoli, senza dipendere dal caricamento di un file audio.
    this.playTone(1040, .48, .17, "square");
    this.playTone(1560, .38, .055, "sine");
  }

  /** Segnale per i cartelli di coaching. Non compete mai con un effetto di
   * soglia/overdrive: se c'è già audio, il messaggio resta visivo e tace. */
  playCoachCue(kind: "drop" | "hold" | "redline") {
    if (!this.context || !this.enabled || this.activeImpact) return false;
    const now = this.context.currentTime;
    if (now < this.coachCueUntil) return false;
    const notes = kind === "drop"
      ? [392, 311, 233] // dissonante e discendente: bisogna rilanciare
      : kind === "hold"
        ? [659, 784] // breve spinta in avanti: tieni il ritmo
        : [784, 1047]; // ingresso in zona rossa
    this.coachCueUntil = now + notes.length * .105 + .08;
    notes.forEach((note, index) => {
      window.setTimeout(() => this.playTone(note, .105, .07, kind === "drop" ? "sawtooth" : "square"), index * 105);
    });
    return true;
  }

  test() { this.trigger({ kind: "threshold", threshold: 800, priority: 80 }); }

  audioStatus() {
    const context = this.context?.state ?? "non inizializzato";
    return `Web Audio: ${context}; media: ${this.mediaStatus}`;
  }

  testFromGesture(enabled: boolean) {
    // Non attendere prepare: il browser deve vedere anche il test nello stesso
    // gesto che ha premuto il bottone. Usiamo toni sintetici, disponibili
    // subito: gli effetti campionati potrebbero essere ancora in download.
    void this.prepare(enabled);
    if (!this.enabled) return;
    // Fallback nativo: Bluefy può consentire HTMLMedia anche quando sospende
    // Web Audio. La richiesta play parte nel gesto del bottone.
    if (this.countdown) {
      try {
        this.countdown.pause();
        this.countdown.currentTime = 0;
        this.mediaStatus = "richiesta riproduzione";
        void this.countdown.play()
          .then(() => { this.mediaStatus = "in riproduzione"; })
          .catch((error) => { this.mediaStatus = `bloccato (${error.name || "errore"})`; });
      } catch { this.mediaStatus = "errore media"; }
    }
    this.playTone(784, .16, .12, "square");
    window.setTimeout(() => this.playTone(1047, .2, .14, "square"), 150);
    window.setTimeout(() => this.playTone(1568, .34, .16, "sine"), 330);
  }

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

  private primeFromGesture(context: AudioContext) {
    if (!this.master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = context.currentTime;
    oscillator.frequency.value = 440;
    // Segnale virtualmente inudibile, necessario per sbloccare Web Audio su iOS.
    gain.gain.setValueAtTime(.0001, at);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + .02);
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
    if (event.kind === "peak") {
      if (threshold < OVERDRIVE_WATTS) this.playArcadeCue(threshold);
      return;
    }
    if (threshold < OVERDRIVE_WATTS) {
      this.playArcadeCue(threshold);
      return;
    }
    // Il premio "grande" parte soltanto in overdrive. Ha la massima priorità
    // e viene lasciato completo: nessun fade quando la potenza ricade.
    this.startOverdrive();
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

  private startOverdrive() {
    this.overdriveLatched = true;
    if (this.overdriveImpact || !this.context || !this.master) return;
    const now = this.context.currentTime * 1000;
    // Se l'atleta ondeggia attorno a 400 W non deve innescare una raffica di
    // esplosioni: il loop già avviato resta continuo, e dopo l'uscita ne può
    // partire uno nuovo soltanto dopo una pausa realmente percepibile.
    if (now - this.lastOverdriveStartedAt < OVERDRIVE_RETRIGGER_MS) {
      this.log("overdrive bloccato dal cooldown");
      return;
    }
    const buffer = this.buffers.get("explosionImpact");
    if (!buffer) return;
    // L'effetto resta in loop finché l'atleta conserva almeno 400 W. La sua
    // priorità impedisce a record e arpeggi di mozzarlo a metà.
    if (this.activeImpact) this.fadeImpact(.06);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 1;
    source.connect(gain).connect(this.master);
    const active: ActiveImpact = { source, gain, priority: 1_000 };
    this.activeImpact = active;
    this.overdriveImpact = active;
    this.lastOverdriveStartedAt = now;
    source.onended = () => {
      if (this.activeImpact === active) this.activeImpact = undefined;
      if (this.overdriveImpact === active) this.overdriveImpact = undefined;
    };
    source.start();
    this.log("overdrive ON · 400W raggiunti");
  }

  private fadeOverdrive() {
    this.overdriveLatched = false;
    const active = this.overdriveImpact;
    if (!active || !this.context) return;
    const at = this.context.currentTime;
    try {
      active.gain.gain.cancelScheduledValues(at);
      active.gain.gain.setTargetAtTime(.0001, at, .16);
      active.source.stop(at + .65);
    } catch { /* La sorgente può essere già terminata. */ }
    if (this.activeImpact === active) this.activeImpact = undefined;
    this.overdriveImpact = undefined;
    this.log("overdrive OFF · sotto 320W");
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
    if (this.overdriveImpact === this.activeImpact) this.overdriveImpact = undefined;
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
