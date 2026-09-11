import type { ChallengeId, PowerDataProvider, PowerSample } from "../types";

type DemoProfile = {
  label: string;
  cruise: number;
  sprint: number;
  variation: number;
  cadenceBias: number;
  style: "playful" | "diesel" | "ramp" | "waves" | "endurance" | "climber" | "double" | "explosive" | "pro" | "super";
  attackAt: number;
};

// Ogni avvio DEMO estrae uno di questi atleti: la prova sembra così una vera
// persona diversa, non la stessa traccia registrata che si ripete all'infinito.
export const demoProfiles: readonly DemoProfile[] = [
  { label: "BAMBINO TURBO", cruise: 115, sprint: 255, variation: 22, cadenceBias: 10, style: "playful", attackAt: 12 },
  { label: "VETERANO COSTANTE", cruise: 185, sprint: 360, variation: 26, cadenceBias: -5, style: "diesel", attackAt: 34 },
  { label: "CICLISTA AMATORIALE", cruise: 225, sprint: 460, variation: 34, cadenceBias: 0, style: "ramp", attackAt: 25 },
  { label: "DONNA SPORTIVA", cruise: 245, sprint: 520, variation: 36, cadenceBias: 4, style: "waves", attackAt: 18 },
  { label: "RANDONNEUR INSTANCABILE", cruise: 265, sprint: 495, variation: 28, cadenceBias: -2, style: "endurance", attackAt: 42 },
  { label: "SCALATORE LEGGERO", cruise: 280, sprint: 545, variation: 38, cadenceBias: 3, style: "climber", attackAt: 28 },
  { label: "ATLETA", cruise: 315, sprint: 650, variation: 48, cadenceBias: 6, style: "double", attackAt: 17 },
  { label: "SPRINTER DA PISTA", cruise: 300, sprint: 790, variation: 58, cadenceBias: 11, style: "explosive", attackAt: 11 },
  { label: "PROFESSIONISTA", cruise: 345, sprint: 890, variation: 46, cadenceBias: 7, style: "pro", attackAt: 31 },
  { label: "SUPERMAN A PEDALI", cruise: 410, sprint: 1_080, variation: 64, cadenceBias: 14, style: "super", attackAt: 20 },
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
      const elapsedFromAttack = t - profile.attackAt;
      const base = (() => {
        switch (profile.style) {
          case "playful":
            return t < 8 ? 70 + t * 8 : 135 + Math.max(0, Math.sin(t * 1.7)) * 110 + Math.sin(t * 4.5) * 18;
          case "diesel":
            return t < 12 ? 110 + t * 6 : t < 35 ? profile.cruise + Math.sin(t * .38) * 14 : 150;
          case "ramp":
            return elapsedFromAttack < 0 ? profile.cruise * (.42 + t * .018) : elapsedFromAttack < 7 ? profile.cruise + elapsedFromAttack * 34 : elapsedFromAttack < 11 ? profile.sprint : Math.max(110, profile.sprint - (elapsedFromAttack - 11) * 29);
          case "waves":
            return t < 8 ? profile.cruise * .45 : profile.cruise + Math.sin(t * .52) * 105 + Math.max(0, Math.sin(t * 1.05)) * 74;
          case "endurance":
            return t < 10 ? profile.cruise * .55 : t < 45 ? profile.cruise * (1 + Math.sin(t * .23) * .08) : profile.cruise * .82;
          case "climber":
            return t < 13 ? profile.cruise * .55 : Math.min(profile.sprint, profile.cruise * .82 + (t - 13) * 10);
          case "double":
            return t < profile.attackAt ? profile.cruise * .62 : elapsedFromAttack < 4 ? profile.sprint : elapsedFromAttack < 12 ? profile.cruise * .92 : elapsedFromAttack < 17 ? profile.sprint * .9 : profile.cruise * .72;
          case "explosive":
            return t < profile.attackAt ? profile.cruise * (.4 + t * .045) : elapsedFromAttack < 2.8 ? profile.sprint : elapsedFromAttack < 10 ? profile.cruise * .72 : profile.cruise * .5;
          case "pro":
            return t < 12 ? profile.cruise * .55 : t < profile.attackAt ? profile.cruise * 1.05 : elapsedFromAttack < 6 ? profile.sprint : elapsedFromAttack < 13 ? profile.cruise * 1.2 : profile.cruise * .78;
          case "super":
            return t < 10 ? profile.cruise * .5 : profile.cruise + Math.max(0, Math.sin((t - profile.attackAt) * .7)) * (profile.sprint - profile.cruise);
        }
      })();
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
