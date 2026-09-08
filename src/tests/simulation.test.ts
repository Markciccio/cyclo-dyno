import { describe, expect, it } from "vitest"
import { advanceVirtualSpeed, powerForSpeed, steadyStateKmh } from "../logic/speed"
import { cornerLimitKmh, getTrack, sampleTrack } from "../logic/tracks"
import { challenges, monzaGhost, totalMassKg, vehicles } from "../logic/challenges"
import { rankFor } from "../logic/metrics"
import type { DynoSession } from "../types"
import { bestOnTrack, ghostLabel, isVehicleGhost, recordMetersAt } from "../logic/ghost"

const rider = 70
const mass = (id: keyof typeof vehicles) => totalMassKg(rider, id)

describe("geometria dei tracciati", () => {
  it("ricostruisce l'anello di Monza alla lunghezza ufficiale", () => {
    const monza = getTrack("monza")
    expect(monza.closed).toBe(true)
    // 5793 m dichiarati dall'autodromo, 1 m di scarto sulla centerline OSM.
    expect(monza.lengthMeters).toBeGreaterThan(5780)
    expect(monza.lengthMeters).toBeLessThan(5810)
    expect(challenges.monza.distanceKm).toBeCloseTo(5.794, 2)
  })

  it("riproduce la salita del Mottarone come da profilo ufficiale", () => {
    const climb = getTrack("mottarone")
    expect(climb.closed).toBe(false)
    expect(climb.lengthMeters).toBeCloseTo(11700, -2)
    // climbfinder: 538 -> 1437 m, media 7,7%.
    expect(climb.minElevation).toBeCloseTo(538, -1)
    expect(climb.maxElevation).toBeCloseTo(1437, -1)
    const average = (climb.maxElevation - climb.minElevation) / climb.lengthMeters
    expect(average).toBeGreaterThan(0.074)
    expect(average).toBeLessThan(0.08)
  })

  it("chiude il velodromo sui 400 m regolamentari", () => {
    expect(getTrack("velodrome").lengthMeters).toBeCloseTo(400, -1)
  })

  it("interpola la rotta senza girare su se stessa a cavallo del nord", () => {
    const monza = getTrack("monza")
    let previous = sampleTrack(monza, 0).bearing
    for (let s = 5; s < monza.lengthMeters; s += 5) {
      const bearing = sampleTrack(monza, s).bearing
      const turn = Math.abs(((bearing - previous + 540) % 360) - 180)
      // Il bug da intercettare è il salto di ~350° a cavallo del nord: all'apice
      // di una chicane 5 m valgono legittimamente qualche decina di gradi.
      expect(turn).toBeLessThan(60)
      previous = bearing
    }
  })

  it("torna al punto di partenza dopo un giro esatto", () => {
    const monza = getTrack("monza")
    const start = sampleTrack(monza, 0)
    const lap = sampleTrack(monza, monza.lengthMeters)
    expect(lap.lat).toBeCloseTo(start.lat, 4)
    expect(lap.lon).toBeCloseTo(start.lon, 4)
  })
})

describe("fisica del mezzo", () => {
  it("mette i mezzi nell'ordine aerodinamico giusto a parità di potenza", () => {
    const at = (id: keyof typeof vehicles) => steadyStateKmh(250, mass(id), 0, vehicles[id])
    expect(at("velomobile")).toBeGreaterThan(at("recumbent"))
    expect(at("recumbent")).toBeGreaterThan(at("road"))
    expect(at("road")).toBeGreaterThan(at("trike"))
  })

  it("è coerente fra potenza richiesta e velocità di regime", () => {
    const kmh = steadyStateKmh(250, mass("recumbent"), 0.05, vehicles.recumbent)
    expect(powerForSpeed(kmh, mass("recumbent"), 0.05, vehicles.recumbent)).toBeCloseTo(250, 0)
  })

  it("fa accelerare più lentamente il mezzo più pesante, a parità di watt e CdA", () => {
    const step = (totalKg: number) =>
      advanceVirtualSpeed({ powerWatts: 400, previousKmh: 20, dtSeconds: 1, totalKg, physics: vehicles.road })
    // Era il difetto del modello a costante di tempo fissa: la massa non contava.
    expect(step(150)).toBeLessThan(step(80))
  })

  it("in salita penalizza la massa più dell'aerodinamica", () => {
    const light = steadyStateKmh(250, totalMassKg(rider, "road"), 0.077, vehicles.road)
    const heavy = steadyStateKmh(250, totalMassKg(rider, "velomobile"), 0.077, vehicles.velomobile)
    // Il velomobile è il più veloce in piano ma paga i suoi 15 kg in più sul Mottarone.
    expect(heavy).toBeLessThan(light)
  })

  it("rallenta a potenza zero invece di restare lanciato", () => {
    const coasting = advanceVirtualSpeed({
      powerWatts: 0,
      previousKmh: 50,
      dtSeconds: 1,
      totalKg: mass("velomobile"),
      physics: vehicles.velomobile,
    })
    expect(coasting).toBeLessThan(50)
    expect(coasting).toBeGreaterThan(45)
  })

  it("non supera mai il limite imposto dalla curva", () => {
    let speed = 60
    for (let i = 0; i < 40; i++) {
      speed = advanceVirtualSpeed({
        powerWatts: 400,
        previousKmh: speed,
        dtSeconds: 0.25,
        totalKg: mass("velomobile"),
        physics: vehicles.velomobile,
        speedLimitKmh: 38,
      })
    }
    expect(speed).toBeCloseTo(38, 1)
  })
})

describe("velocità in curva a Monza", () => {
  const monza = getTrack("monza")
  const limit = (meters: number) => cornerLimitKmh(monza, meters, vehicles.velomobile.lateralG)

  /** Velocità minima ammessa in un tratto: e' l'apice della curva, non un metro preciso. */
  const slowestBetween = (from: number, to: number) => {
    let slowest = Infinity
    for (let s = from; s <= to; s += 5) slowest = Math.min(slowest, limit(s))
    return slowest
  }

  it("riproduce i 38 km/h rilevati alla prima variante", () => {
    // Misura del pilota: fuori dalla Variante del Rettifilo non si passa oltre i 38 km/h.
    const apex = slowestBetween(900, 1060)
    expect(apex).toBeGreaterThan(34)
    expect(apex).toBeLessThan(44)
  })

  it("lascia passare Roggia e Ascari sopra i 45 km/h, come in pista", () => {
    expect(slowestBetween(2140, 2215)).toBeGreaterThan(45)
    expect(slowestBetween(3990, 4180)).toBeGreaterThan(45)
  })

  it("frena prima della curva, non all'apice", () => {
    // Avvicinandosi alla variante si è già sotto il limite del rettilineo libero.
    expect(limit(880)).toBeLessThan(limit(300))
  })

  it("tiene la prima variante come punto più lento del giro", () => {
    let slowestAt = 0
    let slowest = Infinity
    for (let s = 0; s < monza.lengthMeters; s += 10) {
      if (limit(s) < slowest) { slowest = limit(s); slowestAt = s }
    }
    expect(slowestAt).toBeGreaterThan(900)
    expect(slowestAt).toBeLessThan(1060)
  })

  it("concede alla bici da corsa più velocità in curva che al velomobile", () => {
    expect(cornerLimitKmh(monza, 985, vehicles.road.lateralG)).toBeGreaterThan(limit(985))
  })

  it("resta nell'ordine di grandezza del record reale sul giro", () => {
    const spec = vehicles.velomobile
    const totalKg = mass("velomobile")
    let speed = 0
    let meters = 0
    let seconds = 0
    while (meters < monza.lengthMeters && seconds < 900) {
      const point = sampleTrack(monza, meters)
      speed = advanceVirtualSpeed({
        powerWatts: monzaGhost.averageWatts,
        previousKmh: speed,
        dtSeconds: 0.2,
        grade: point.grade,
        totalKg,
        physics: spec,
        speedLimitKmh: cornerLimitKmh(monza, meters, spec.lateralG),
      })
      meters += (speed / 3.6) * 0.2
      seconds += 0.2
    }
    // Record reale 355 s: il modello resta conservativo ma nello stesso campo.
    expect(seconds).toBeGreaterThan(330)
    expect(seconds).toBeLessThan(430)
  })
})

describe("classifica per sfida", () => {
  const base = { peakPower: 0, best1s: null, best10s: null, averagePower: 0, maxVirtualSpeed: 0, averageCadence: null, maxCadence: null, powerDrop: null, thresholdTimes: {}, samples: [], sessionDuration: 0, dataSource: "demo" as const, validSession: true, quality: "VALID" as const }
  const session = (id: string, over: Partial<DynoSession>): DynoSession =>
    ({ ...base, id, participantName: id, timestamp: 1, best5s: 0, ...over }) as DynoSession

  it("ordina le prove a percorso per tempo, non per watt", () => {
    const slowButStrong = session("A", { challenge: "monza", elapsedSeconds: 400, completed: true, best5s: 900 })
    const quick = session("B", { challenge: "monza", elapsedSeconds: 360, completed: true, best5s: 300 })
    expect(rankFor([slowButStrong, quick], "monza")[0].id).toBe("B")
  })

  it("manda in fondo chi non ha completato il percorso", () => {
    const dnf = session("A", { challenge: "monza", elapsedSeconds: 100, completed: false })
    const finished = session("B", { challenge: "monza", elapsedSeconds: 600, completed: true })
    expect(rankFor([dnf, finished], "monza")[0].id).toBe("B")
  })

  it("non mescola sfide diverse nella stessa classifica", () => {
    const sprint = session("A", { challenge: "dyno", best5s: 900 })
    const lap = session("B", { challenge: "monza", elapsedSeconds: 360, completed: true })
    expect(rankFor([sprint, lap], "dyno").map((x) => x.id)).toEqual(["A"])
    expect(rankFor([sprint, lap], "monza").map((x) => x.id)).toEqual(["B"])
  })

  it("tratta le vecchie sessioni senza sfida come dyno sprint", () => {
    expect(rankFor([session("A", { best5s: 500 })], "dyno")).toHaveLength(1)
  })
})

describe("sfidante a pari watt", () => {
  it("con gli stessi watt distanzia il mezzo meno efficiente", () => {
    const monza = getTrack("monza")
    const run = (id: keyof typeof vehicles) => {
      let speed = 0
      let meters = 0
      for (let t = 0; t < 300; t += 0.25) {
        speed = advanceVirtualSpeed({
          powerWatts: 250,
          previousKmh: speed,
          dtSeconds: 0.25,
          grade: sampleTrack(monza, meters).grade,
          totalKg: totalMassKg(rider, id),
          physics: vehicles[id],
          speedLimitKmh: cornerLimitKmh(monza, meters, vehicles[id].lateralG),
        })
        meters += (speed / 3.6) * 0.25
      }
      return meters
    }
    // Cinque minuti a 250 W: il divario deve essere visibile, non simbolico.
    expect(run("velomobile") - run("road")).toBeGreaterThan(500)
  })
})

describe("scelta del ghost", () => {
  const sample = (elapsedMs: number, distanceKm: number) => ({ timestamp: elapsedMs, elapsedMs, distanceKm, powerWatts: 250, virtualSpeedKmh: 40 })
  const record = {
    id: "r", participantName: "PB", challenge: "monza" as const, completed: true, elapsedSeconds: 400,
    samples: [sample(0, 0), sample(100000, 2), sample(400000, 5.794)],
  } as unknown as DynoSession

  it("distingue i ghost a pari watt dalle altre scelte", () => {
    expect(isVehicleGhost("none")).toBe(false)
    expect(isVehicleGhost("best")).toBe(false)
    expect(isVehicleGhost("velomobile")).toBe(true)
  })

  it("rigioca il record interpolando fra i campioni", () => {
    expect(recordMetersAt(record, 0)).toBe(0)
    expect(recordMetersAt(record, 50)).toBeCloseTo(1000, 0)
    expect(recordMetersAt(record, 100)).toBeCloseTo(2000, 0)
    // A metà fra 100 s e 400 s si è a metà fra 2 km e 5,794 km.
    expect(recordMetersAt(record, 250)).toBeCloseTo(3897, 0)
  })

  it("non va oltre l'arrivo né prima della partenza", () => {
    expect(recordMetersAt(record, -10)).toBe(0)
    expect(recordMetersAt(record, 9999)).toBeCloseTo(5794, 0)
  })

  it("prende come record solo prove completate sullo stesso tracciato", () => {
    const dnf = { ...record, id: "d", completed: false, elapsedSeconds: 10 } as DynoSession
    const other = { ...record, id: "o", challenge: "mottarone" as const, elapsedSeconds: 5 } as DynoSession
    expect(bestOnTrack([dnf, other, record], "monza")?.id).toBe("r")
    expect(bestOnTrack([dnf], "monza")).toBeUndefined()
  })

  it("etichetta il ghost secondo la scelta", () => {
    expect(ghostLabel("none")).toBe("")
    expect(ghostLabel("road")).toContain("STESSI WATT")
    expect(ghostLabel("best", record)).toContain("PB")
  })
})
