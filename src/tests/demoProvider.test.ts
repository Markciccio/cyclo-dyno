import { describe, expect, it } from "vitest";
import { demoProfiles, randomDemoProfile } from "../services/demoProvider";

describe("profili demo", () => {
  it("offre dieci ciclisti con intensità realmente differenti", () => {
    expect(demoProfiles).toHaveLength(10);
    expect(new Set(demoProfiles.map((profile) => profile.label)).size).toBe(10);
    expect(new Set(demoProfiles.map((profile) => profile.style)).size).toBe(10);
    expect(new Set(demoProfiles.map((profile) => profile.attackAt)).size).toBeGreaterThan(7);
    expect(Math.max(...demoProfiles.map((profile) => profile.sprint))).toBeGreaterThan(1_000);
    expect(Math.min(...demoProfiles.map((profile) => profile.sprint))).toBeLessThan(300);
  });

  it("estrae anche i limiti della rosa senza uscire dall'elenco", () => {
    expect(randomDemoProfile(() => 0).label).toBe("BAMBINO TURBO");
    expect(randomDemoProfile(() => .999999).label).toBe("SUPERMAN A PEDALI");
  });
});
