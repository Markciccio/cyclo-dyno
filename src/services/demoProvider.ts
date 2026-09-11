import type { ChallengeId, PowerDataProvider, PowerSample } from "../types";

type DemoProfile = {
  label: string;
  cruise: number;
  sprint: number;
  variation: number;
  cadenceBias: number;
};

// Ogni avvio DEMO estrae uno di questi atleti: la prova sembra così una vera
// persona diversa, non la stessa traccia registrata che si ripete all'infinito.
export const demoProfiles: readonly DemoProfile[] = [
  { label: "BAMBINO TURBO", cruise: 115, sprint: 255, variation: 22, cadenceBias: 10 },
  { label: "VETERANO COSTANTE", cruise: 185, sprint: 360, variation: 26, cadenceBias: -5 },
  { label: "CICLISTA AMATORIALE", cruise: 225, sprint: 460, variation: 34, cadenceBias: 0 },
  { label: "DONNA SPORTIVA", cruise: 245, sprint: 520, variation: 36, cadenceBias: 4 },
  { label: "RANDONNEUR INSTANCABILE", cruise: 265, sprint: 495, variation: 28, cadenceBias: -2 },
  { label: "SCALATORE LEGGERO", cruise: 280, sprint: 545, variation: 38, cadenceBias: 3 },
  { label: "ATLETA", cruise: 315, sprint: 650, variation: 48, cadenceBias: 6 },
  { label: "SPRINTER DA PISTA", cruise: 300, sprint: 790, variation: 58, cadenceBias: 11 },
  { label: "PROFESSIONISTA", cruise: 345, sprint: 890, variation: 46, cadenceBias: 7 },
  { label: "SUPERMAN A PEDALI", cruise: 410, sprint: 1_080, variation: 64, cadenceBias: 14 },
];

export function randomDemoProfile(random = Math.random) {
  return demoProfiles[Math.min(demoProfiles.length - 1, Math.floor(random() * demoProfiles.length))]!;
}

export class DemoPowerProvider implements PowerDataProvider {
  readonly source = "demo" as const;
  private timer?: number;
  private startAt = 0;
  private scenario: ChallengeId;
  private profile?: DemoProfile;

  constructor(scenario: ChallengeId = "dyno") { this.scenario = scenario; }

  setScenario(scenario: ChallengeId) { this.scenario = scenario; }

  status() { return this.profile ? `DEMO · ${this.profile.label}` : "DEMO · PROFILO CASUALE"; }

  private chooseProfile() {
    const drawn = randomDemoProfile();
    // La casualità non deve sembrare un bug: due prove consecutive non usano
    // mai lo stesso atleta, pur lasciando casuale l'ordine del resto della rosa.
    if (drawn !== this.profile) {
      this.profile = drawn;
      return;
    }
    const currentIndex = demoProfiles.indexOf(drawn);
    const offset = 1 + Math.floor(Math.random() * (demoProfiles.length - 1));
    this.profile = demoProfiles[(currentIndex + offset) % demoProfiles.length]!;
  }

  private watts(t: number) {
    const profile = this.profile ?? demoProfiles[2];
    const noise = (Math.random() - .5) * profile.variation;
    if (this.scenario === "dyno") {
      // Riscaldamento, attacco, cedimento e rilanci: l'intensità cambia con
      // il profilo estratto, quindi anche due demo consecutive sono differenti.
      const base =
        t < 8 ? profile.cruise * (.27 + t * .032) :
        t < 15 ? profile.cruise * (.65 + (t - 8) * .045) :
        t < 21 ? profile.cruise + (t - 15) * (profile.sprint - profile.cruise) / 18 :
        t < 24.5 ? profile.sprint + Math.sin(t * 5.1) * profile.variation :
        t < 29 ? profile.cruise * 1.45 - (t - 24.5) * profile.cruise * .09 :
        t < 34 ? profile.sprint * .78 + (t - 29) * profile.cruise * .08 :
        t < 40 ? profile.cruise * (1.1 + Math.sin(t * 1.8) * .2) :
        t < 46 ? profile.sprint * .66 + (t - 40) * profile.cruise * .045 :
        Math.max(55, profile.cruise * .65 - (t - 46) * profile.cruise * .035);
      const pedalStroke = Math.sin(t * 2.7) * Math.max(12, profile.variation * .45);
      return Math.max(0, Math.round(base + noise + pedalStroke));
    }

    const phase = t % 60;
    if (this.scenario === "monza") {
      if (t < 10) return Math.round(profile.cruise * 1.35 + noise);
      if (phase > 53) return 0; // brevi tratti in scia senza pedalare
      return Math.round(profile.cruise + Math.sin(t * .6) * profile.variation + noise);
    }
    if (this.scenario === "mottarone") {
      // In salita niente coasting: cala appena con la fatica ma resta continuo.
      const climb = Math.max(profile.cruise * .55, profile.cruise * 1.02 - t * .045);
      return Math.round(climb + Math.sin(t * .42) * profile.variation * .55 + noise);
    }
    if (this.scenario === "velodrome") {
      return Math.round(profile.cruise * 1.05 + Math.sin(t * .9) * profile.variation * 1.4 + noise);
    }
    return Math.round(profile.cruise + Math.sin(t * .8) * profile.variation + noise);
  }

  start(on: (sample: PowerSample) => void) {
    this.stop();
    this.chooseProfile();
    this.startAt = performance.now();
    this.timer = window.setInterval(() => {
      const t = (performance.now() - this.startAt) / 1000;
      const p = this.watts(t);
      const profile = this.profile!;
      on({
        timestamp: performance.now(),
        powerWatts: p,
        cadenceRpm: Math.round(Math.max(0, 66 + profile.cadenceBias + p * .065 + Math.sin(t) * 6)),
      });
    }, 250);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
