import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChallengeId,
  DataSource,
  DynoSession,
  PowerDataProvider,
  GhostChoice,
  Lap,
  SessionSample,
  Settings,
  VehicleProfile,
} from "./types";
import { DemoPowerProvider } from "./services/demoProvider";
import { AssiomaBluetoothProvider } from "./services/assiomaBluetooth";
import { advanceVirtualSpeed } from "./logic/speed";
import { cornerLimitKmh, sampleTrack } from "./logic/tracks";
import { calculateMetrics, formatLapTime, rankFor } from "./logic/metrics";
import { bestLap, lapRank, lapSecondsAt, rankLabel, summariseLap } from "./logic/laps";
import { sessionRepo, download } from "./storage/repository";
import { Gauge } from "./components/Gauge";
import { PowerChart } from "./components/PowerChart";
import { TrackMap } from "./components/TrackMap";
import { ElevationProfile } from "./components/ElevationProfile";
import { VehicleIcon } from "./components/VehicleIcon";
import { challenges, challengeTrack, totalMassKg, vehicles } from "./logic/challenges";
import { bestOnTrack, ghostLabel, isVehicleGhost, recordMetersAt, recordSecondsAt } from "./logic/ghost";
const defaults: Settings = {
  eventName: "HPV POWER CHALLENGE",
  defaultDuration: 60,
  thresholds: [200, 300, 400, 500, 600, 700, 800, 1000],
  referenceWatts: 250,
  referenceKmh: 36,
  audio: true,
};
type View =
  | "home"
  | "countdown"
  | "dyno"
  | "result"
  | "leaderboard"
  | "settings"
  | "debug"
  | "display";
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type ScreenLock = { release: () => Promise<void>; released: boolean };
const fmt = (n: number | null, u = "W") =>
  n === null ? "--" : `${Math.round(n)} ${u}`;
const powerLevel = (w: number) =>
  w > 750
    ? "power-extra"
    : w >= 500
    ? "power-red"
    : w >= 300
      ? "power-orange"
      : w >= 180
        ? "power-yellow"
        : "power-green";
type SprintBurst = {
  id: number;
  title: string;
  message: string;
  kind: "peak" | "hold";
  hundred: boolean;
};
const POWER_REFRESH_MS = 1000;
const ALERT_COOLDOWN_MS = 2000;
const holdMessages = [
  "TIENI LA POTENZA!",
  "DAI TUTTO!",
  "NON MOLLARE!",
  "SPINGI FINO IN FONDO!",
  "SEI IN ZONA ROSSA!",
  "ANCORA TRE SECONDI!",
  "GAMBE, CUORE, GAS!",
];
const ghostStorageKey = (challenge: ChallengeId) => `hpv-power-dyno:ghost:${challenge}`;
function rememberedGhost(challenge: ChallengeId): GhostChoice {
  if (challenge === "dyno") return "none";
  try {
    const choice = localStorage.getItem(ghostStorageKey(challenge));
    return choice === "none" || choice === "best" || (typeof choice === "string" && choice in vehicles) ? choice as GhostChoice : "none";
  } catch { return "none"; }
}
/** Media ponderata degli ultimi N secondi: non dipende dalla frequenza del sensore. */
function trailingPower(samples: SessionSample[], seconds: number) {
  const end = samples.at(-1)?.elapsedMs;
  if (end === undefined) return 0;
  const start = Math.max(0, end - seconds * 1000);
  let wattMilliseconds = 0;
  let milliseconds = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const from = Math.max(start, samples[i].elapsedMs);
    const to = Math.min(end, samples[i + 1].elapsedMs);
    if (to > from) {
      wattMilliseconds += samples[i].powerWatts * (to - from);
      milliseconds += to - from;
    }
  }
  return milliseconds ? wattMilliseconds / milliseconds : samples.at(-1)?.powerWatts ?? 0;
}
export function App() {
  const [view, setView] = useState<View>(
      location.pathname === "/display" ? "display" : "home",
    ),
    [name, setName] = useState(""),
    [settings, setSettings] = useState(defaults),
    [source, setSource] = useState<DataSource>("demo"),
    [provider, setProvider] = useState<PowerDataProvider>(
      new DemoPowerProvider(),
    ),
    [samples, setSamples] = useState<SessionSample[]>([]),
    [displayPower, setDisplayPower] = useState(0),
    [displaySpeed, setDisplaySpeed] = useState(0),
    [clock, setClock] = useState(0),
    [result, setResult] = useState<DynoSession>(),
    [sessions, setSessions] = useState<DynoSession[]>([]),
    [count, setCount] = useState(3),
    [notice, setNotice] = useState(""),
    [wakeActive, setWakeActive] = useState(false),
    [installPrompt, setInstallPrompt] = useState<InstallPromptEvent>(),
    [riderWeight, setRiderWeight] = useState(""),
    [vehicle, setVehicle] = useState<VehicleProfile>("velomobile"),
    [challenge, setChallenge] = useState<ChallengeId>("dyno"),
    [ghost, setGhost] = useState<GhostChoice>("none"),
    [rivalMeters, setRivalMeters] = useState(0),
    [burst, setBurst] = useState<SprintBurst>(),
    [laps, setLaps] = useState<Lap[]>([]),
    [lapFlash, setLapFlash] = useState<{ lap: Lap; rank: number; total: number }>();
  const pRef = useRef(provider),
    sRef = useRef<SessionSample[]>([]),
    start = useRef(0),
    timer = useRef<number>(),
    ended = useRef(false),
    vehicleRef = useRef<VehicleProfile>("velomobile"),
    riderNameRef = useRef(""),
    riderWeightRef = useRef(70),
    lastPowerPaint = useRef(0),
    lastSpeedPaint = useRef(0),
    lastSamplePaint = useRef(0),
    ghostRef = useRef<GhostChoice>("none"),
    rivalSpeedRef = useRef(0),
    rivalMetersRef = useRef(0),
    peakRef = useRef(0),
    best3Ref = useRef(0),
    lastBurstRef = useRef(0),
    lastCoachRef = useRef(0),
    burstId = useRef(0),
    lapsRef = useRef<Lap[]>([]),
    lapStartMs = useRef(0),
    lapStartKm = useRef(0),
    wakeLockRef = useRef<ScreenLock>(),
    audioContextRef = useRef<AudioContext>(),
    sessionActiveRef = useRef(false);
  pRef.current = provider;
  useEffect(() => {
    sessionRepo.settings(defaults).then(setSettings);
    sessionRepo.getAll().then(setSessions);
  }, []);
  // L'annuncio del giro sparisce da solo: pedalando non si tocca lo schermo.
  useEffect(() => {
    if (!lapFlash) return;
    const hide = window.setTimeout(() => setLapFlash(undefined), 7000);
    return () => clearTimeout(hide);
  }, [lapFlash]);
  useEffect(() => {
    const resume = () => { if (document.visibilityState === "visible" && sessionActiveRef.current) void requestWakeLock(); };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, []);
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const installed = () => { setInstallPrompt(undefined); setNotice("APP INSTALLATA: la trovi nella schermata Home"); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    return () => { window.removeEventListener("beforeinstallprompt", capture); window.removeEventListener("appinstalled", installed); };
  }, []);
  const live = samples.at(-1),
    isA = provider instanceof AssiomaBluetoothProvider,
    activeChallenge = challenges[challenge],
    activeVehicle = vehicles[vehicle];
  const speedPeak = Math.max(0, ...samples.map((x) => x.virtualSpeedKmh));
  // bestWindow scandisce i campioni per ogni campione: va calcolato una volta sola.
  const liveMetrics = useMemo(() => calculateMetrics(samples, settings.thresholds), [samples, settings.thresholds]);
  const liveBest5s = liveMetrics.best5s;
  const newSpeedPeak = !!live && samples.length > 1 && live.virtualSpeedKmh > Math.max(0, ...samples.slice(0, -1).map((x) => x.virtualSpeedKmh));
  const nav = (
    <nav>
      <button onClick={() => setView("home")}>HOME</button>
      <button onClick={() => setView("leaderboard")}>CLASSIFICA</button>
      <button onClick={() => setView("debug")}>DEBUG</button>
      <button onClick={() => setView("settings")}>SETTINGS</button>
      <button className="install" onClick={installApp}>⇩ INSTALLA</button>
    </nav>
  );
  function playCue(kind: "countdown" | "go" | SprintBurst["kind"], countStep?: number) {
    if (!settings.audio) return;
    try {
      const audio = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = audio;
      void audio.resume();
      const at = audio.currentTime + .015;
      const crackle = (when: number, duration: number, volume: number, color: number) => {
        const buffer = audio.createBuffer(1, Math.max(1, Math.floor(audio.sampleRate * duration)), audio.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
        const noise = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const gain = audio.createGain();
        noise.buffer = buffer;
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(color, when);
        gain.gain.setValueAtTime(volume, when);
        gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
        noise.connect(filter).connect(gain).connect(audio.destination);
        noise.start(when);
      };
      const tone = (frequency: number, when: number, duration: number, volume: number, type: OscillatorType = "sine", endFrequency?: number) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, when);
        if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration);
        gain.gain.setValueAtTime(.0001, when);
        gain.gain.exponentialRampToValueAtTime(volume, when + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(when);
        oscillator.stop(when + duration + .02);
      };
      if (kind === "countdown") {
        // Semaforo: tre bip netti e crescenti, senza ruggito di motore.
        const frequency = countStep === 3 ? 620 : countStep === 2 ? 760 : 920;
        tone(frequency, at, .11, .09, "square");
      } else if (kind === "go") {
        // Boost di partenza: botto basso, scia di turbo e piccola scintilla.
        crackle(at, .42, .15, 900);
        tone(74, at, .34, .15, "sawtooth", 38);
        tone(520, at + .05, .32, .075, "square", 1700);
        crackle(at + .12, .12, .055, 3100);
      } else if (kind === "hold") {
        // Motore in tiro, secco e ripetuto: invita a non mollare.
        tone(155, at, .13, .09, "square", 330);
        tone(190, at + .16, .13, .09, "square", 410);
        crackle(at + .06, .08, .035, 1700);
      } else {
        // Picco istantaneo: esplosione brillante, più due scintille alte.
        crackle(at, .3, .13, 2100);
        tone(430, at, .22, .1, "sawtooth", 1220);
        tone(1240, at + .08, .17, .065, "sine", 2080);
      }
    } catch { /* L'audio è un extra: la prova continua anche nei browser che lo bloccano. */ }
  }
  function selectVehicle(next: VehicleProfile) {
    vehicleRef.current = next;
    setVehicle(next);
  }
  function selectGhost(next: GhostChoice) {
    // Scegliendolo a prova iniziata parte da dove sei: un distacco accumulato
    // mentre il ghost non esisteva non significherebbe nulla.
    if (ghostRef.current === "none" && next !== "none") {
      const current = sRef.current.at(-1);
      rivalMetersRef.current = (current?.distanceKm ?? 0) * 1000;
      rivalSpeedRef.current = current?.virtualSpeedKmh ?? 0;
      setRivalMeters(rivalMetersRef.current);
    }
    ghostRef.current = next;
    setGhost(next);
    // Ogni circuito ricorda il suo avversario: Monza non deve alterare il
    // confronto che avevi scelto per il Velodromo o per il Mottarone.
    if (challenge !== "dyno") {
      try { localStorage.setItem(ghostStorageKey(challenge), next); } catch { /* memoria non disponibile */ }
    }
  }
  async function requestWakeLock() {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<ScreenLock> } }).wakeLock;
    if (!api || wakeLockRef.current?.released === false) return;
    try { wakeLockRef.current = await api.request("screen"); setWakeActive(true); }
    catch { setWakeActive(false); }
  }
  async function releaseWakeLock() {
    if (wakeLockRef.current && !wakeLockRef.current.released) await wakeLockRef.current.release();
    wakeLockRef.current = undefined;
    setWakeActive(false);
  }
  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setNotice("Installazione avviata");
      setInstallPrompt(undefined);
      return;
    }
    const isiPhone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    setNotice(isiPhone ? "Su iPhone: tocca Condividi, poi ‘Aggiungi a Home’" : "Apri il menu del browser e scegli ‘Installa app’ o ‘Aggiungi a schermata Home’");
  }
  async function connect() {
    try {
      const a = new AssiomaBluetoothProvider();
      await a.connect();
      setProvider(a);
      setSource("assioma");
      setNotice("ASSIOMA CONNECTED");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Connessione non riuscita");
    }
  }
  function begin() {
    const randomName = `RIDER-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const parsedWeight = Number(riderWeight.replace(",", "."));
    riderNameRef.current = name.trim() || randomName;
    riderWeightRef.current = Number.isFinite(parsedWeight) && parsedWeight >= 35 && parsedWeight <= 180 ? parsedWeight : 70;
    const savedGhost = rememberedGhost(challenge);
    ghostRef.current = savedGhost;
    setGhost(savedGhost);
    setName(riderNameRef.current);
    if (pRef.current instanceof DemoPowerProvider) pRef.current.setScenario(challenge);
    sRef.current = [];
    setSamples([]);
    setDisplayPower(0);
    setDisplaySpeed(0);
    lastPowerPaint.current = 0;
    lastSpeedPaint.current = 0;
    lastSamplePaint.current = 0;
    rivalSpeedRef.current = 0;
    rivalMetersRef.current = 0;
    setRivalMeters(0);
    peakRef.current = 0;
    best3Ref.current = 0;
    lastBurstRef.current = 0;
    lastCoachRef.current = 0;
    setBurst(undefined);
    lapsRef.current = [];
    lapStartMs.current = 0;
    lapStartKm.current = 0;
    setLaps([]);
    setLapFlash(undefined);
    setCount(3);
    setView("countdown");
    playCue("countdown", 3);
    let n = 3;
    const i = window.setInterval(() => {
      n--;
      setCount(n);
      playCue(n ? "countdown" : "go", n);
      if (!n) {
        clearInterval(i);
        startSession();
      }
    }, 1000);
  }
  function startSession() {
    start.current = performance.now();
    ended.current = false;
    sessionActiveRef.current = true;
    void requestWakeLock();
    setView("dyno");
    const course = challenges[challenge];
    const track = challengeTrack(challenge);
    try {
      pRef.current.start((x) => {
        if (ended.current) return;
        const prev = sRef.current.at(-1),
          elapsed = x.timestamp - start.current,
          dt = prev ? x.timestamp - prev.timestamp : 0,
          spec = vehicles[vehicleRef.current],
          metersDone = (prev?.distanceKm ?? 0) * 1000,
          // Pendenza e raggio di curva vengono dal tracciato reale sotto le ruote.
          point = track ? sampleTrack(track, metersDone) : undefined,
          speed = advanceVirtualSpeed({
            powerWatts: x.powerWatts,
            previousKmh: prev?.virtualSpeedKmh ?? 0,
            dtSeconds: dt / 1000,
            grade: point?.grade ?? 0,
            totalKg: totalMassKg(riderWeightRef.current, vehicleRef.current),
            physics: spec,
            speedLimitKmh: track ? cornerLimitKmh(track, metersDone, spec.lateralG) : undefined,
          }),
          distance =
            (prev?.distanceKm ?? 0) +
            ((((prev?.virtualSpeedKmh ?? speed) + speed) / 2) * dt) / 3600000,
          y: SessionSample = {
            ...x,
            elapsedMs: elapsed,
            virtualSpeedKmh: speed,
            distanceKm: distance,
            gradePercent: point ? point.grade * 100 : undefined,
            elevationMeters: point?.elevation,
          };
        let feedback: Omit<SprintBurst, "id"> | undefined;
        if (x.powerWatts > peakRef.current) {
          const hundred = Math.floor(x.powerWatts / 100) > Math.floor(peakRef.current / 100);
          peakRef.current = x.powerWatts;
          // In rampa ogni campione è un nuovo record: si annuncia a intervalli,
          // tranne quando si sfonda un centinaio, che merita sempre il lampo.
          if (hundred || x.timestamp - lastBurstRef.current > 700) {
            lastBurstRef.current = x.timestamp;
            feedback = {
              title: "NUOVO PICCO!",
              message: hundred ? "POTENZA FUORI SCALA!" : "CONTINUA COSÌ!",
              kind: "peak",
              hundred,
            };
          }
        }
        // Nello Sprint l'incoraggiamento guarda una finestra reale di 3 s:
        // sprona a tenere lo sforzo, senza aggiungere avvisi Top 5 affollati.
        if (challenge === "dyno") {
          const nextSamples = [...sRef.current, y];
          const current3 = trailingPower(nextSamples, 3);
          const hasThreeSeconds = elapsed >= 3000;
          if (hasThreeSeconds && current3 > best3Ref.current) best3Ref.current = current3;
          const holdingNearTop = hasThreeSeconds && current3 >= Math.max(450, best3Ref.current * 0.94);
          if (!feedback && holdingNearTop && x.timestamp - lastCoachRef.current > 2400) {
            feedback = {
              title: holdMessages[burstId.current % holdMessages.length],
              message: "TOP 3 SECONDI IN CORSO",
              kind: "hold",
              hundred: current3 > 750,
            };
          }
        }
        // Un solo cartello alla volta: picco o stimolo, massimo uno ogni 2 s.
        if (feedback && x.timestamp - lastCoachRef.current >= ALERT_COOLDOWN_MS) {
          lastCoachRef.current = x.timestamp;
          setBurst({ ...feedback, id: burstId.current++ });
          playCue(feedback.kind);
        }
        sRef.current.push(y);
        if (track && dt > 0 && isVehicleGhost(ghostRef.current)) {
          // Lo sfidante riceve gli stessi watt e li spende con la sua fisica.
          const rivalSpec = vehicles[ghostRef.current];
          const before = rivalSpeedRef.current;
          rivalSpeedRef.current = advanceVirtualSpeed({
            powerWatts: x.powerWatts,
            previousKmh: before,
            dtSeconds: dt / 1000,
            grade: sampleTrack(track, rivalMetersRef.current).grade,
            totalKg: totalMassKg(riderWeightRef.current, ghostRef.current),
            physics: rivalSpec,
            speedLimitKmh: cornerLimitKmh(track, rivalMetersRef.current, rivalSpec.lateralG),
          });
          rivalMetersRef.current += (((before + rivalSpeedRef.current) / 2) * dt) / 3600;
        }
        if (x.timestamp - lastSamplePaint.current >= 250) {
          lastSamplePaint.current = x.timestamp;
          setSamples([...sRef.current]);
          setRivalMeters(rivalMetersRef.current);
        }
        if (x.timestamp - lastSpeedPaint.current >= 1000) {
          lastSpeedPaint.current = x.timestamp;
          setDisplaySpeed(speed);
        }
        if (x.timestamp - lastPowerPaint.current >= POWER_REFRESH_MS) {
          lastPowerPaint.current = x.timestamp;
          setDisplayPower(x.powerWatts);
        }
        // Su un anello si continua a girare: il traguardo chiude un giro, non la prova.
        if (course.lap && course.distanceKm && distance - lapStartKm.current >= course.distanceKm) {
          const lap = summariseLap({
            samples: sRef.current,
            fromMs: lapStartMs.current,
            toMs: elapsed,
            fromKm: lapStartKm.current,
            toKm: distance,
            index: lapsRef.current.length + 1,
          });
          lapsRef.current = [...lapsRef.current, lap];
          setLaps(lapsRef.current);
          setLapFlash({ lap, rank: lapRank(lap.seconds, lapsRef.current), total: lapsRef.current.length });
          lapStartMs.current = elapsed;
          lapStartKm.current = distance;
        }
        if (!course.lap && course.distanceKm && distance >= course.distanceKm) finish(true);
      });
    } catch (e) {
      sessionActiveRef.current = false;
      void releaseWakeLock();
      setNotice(e instanceof Error ? e.message : "Provider error");
      setView("home");
      return;
    }
    timer.current = window.setInterval(() => {
      const elapsed = (performance.now() - start.current) / 1000;
      setClock(
        course.distanceKm
          ? elapsed
          : Math.max(0, settings.defaultDuration - elapsed),
      );
      if (!course.distanceKm && elapsed >= settings.defaultDuration)
        finish(true);
    }, 100);
  }
  function finish(valid: boolean) {
    if (ended.current) return;
    ended.current = true;
    sessionActiveRef.current = false;
    void releaseWakeLock();
    if (timer.current) clearInterval(timer.current);
    pRef.current.stop();
    const data = sRef.current,
      m = calculateMetrics(data, settings.thresholds);
    setSamples([...data]);
    const covered = data.at(-1)?.distanceKm ?? 0;
    const course = challenges[challenge];
    const target = course.distanceKm;
    const sessionLaps = lapsRef.current;
    const fastest = bestLap(sessionLaps);
    const finishTrack = challengeTrack(challenge);
    setResult({
      id: crypto.randomUUID(),
      participantName: riderNameRef.current,
      riderWeightKg: riderWeightRef.current,
      vehicle: vehicleRef.current,
      challenge,
      elapsedSeconds: (performance.now() - start.current) / 1000,
      distanceKm: covered,
      climbedMeters: finishTrack ? sampleTrack(finishTrack, covered * 1000).climb : 0,
      // Su un anello conta aver chiuso almeno un giro, non la distanza totale.
      completed: valid && (course.lap ? sessionLaps.length > 0 : !target || covered >= target - 0.005),
      laps: sessionLaps,
      bestLapSeconds: fastest?.seconds,
      timestamp: Date.now(),
      sessionDuration: (performance.now() - start.current) / 1000,
      samples: data,
      dataSource: source,
      validSession: valid && source === "assioma",
      quality: source === "demo" ? "DEMO" : valid ? "VALID" : "INVALID",
      ...m,
    });
    setView("result");
  }
  async function save() {
    if (result) {
      await sessionRepo.save(result);
      setSessions(await sessionRepo.getAll());
      setNotice("RISULTATO SALVATO");
    }
  }
  function newRider() {
    setName("");
    setSamples([]);
    setResult(undefined);
    setView("home");
  }
  const ranked = useMemo(
      () => rankFor(sessions.filter((x) => x.validSession), challenge),
      [sessions, challenge],
    ),
    demor = useMemo(
      () => rankFor(sessions.filter((x) => x.dataSource === "demo"), challenge),
      [sessions, challenge],
    );
  if (view === "countdown")
    return (
      <main className="countdown">
        <div>{count || "GO!"}</div>
      </main>
    );
  if (view === "dyno") {
    const metersDone = (live?.distanceKm ?? 0) * 1000;
    const liveTrack = challengeTrack(challenge);
    const gradePercent = live?.gradePercent ?? 0;
    const climbed = liveTrack ? sampleTrack(liveTrack, metersDone).climb : 0;
    const record = bestOnTrack(sessions, challenge);
    const isSprint = !liveTrack;
    const peakPower = Math.max(0, ...samples.map((x) => x.powerWatts));
    const sampledSeconds = (samples.at(-1)?.elapsedMs ?? 0) / 1000;
    const averageSpeedKmh = sampledSeconds > 0 ? (metersDone / 1000) / (sampledSeconds / 3600) : 0;
    const ghostMeters =
      ghost === "none"
        ? undefined
        : ghost === "best"
          ? record
            ? recordMetersAt(record, clock)
            : undefined
          : rivalMeters;
    // Distacco in secondi: sul record si inverte la sua traccia, sullo sfidante
    // vivo si converte il distacco in metri al passo che si sta tenendo.
    const recordLap = record?.laps?.length ? bestLap(record.laps) : undefined;
    const bestSeconds = !record
      ? undefined
      : recordLap
        ? // Anello: giro corrente contro il giro record, allo stesso punto della pista.
          clock - lapStartMs.current / 1000 - lapSecondsAt(record.samples, recordLap, metersDone - lapStartKm.current * 1000)
        : metersDone > 5
          ? clock - recordSecondsAt(record, metersDone)
          : undefined;
    const rivalSeconds =
      ghostMeters !== undefined && isVehicleGhost(ghost)
        ? (metersDone - ghostMeters) / Math.max(2, (live?.virtualSpeedKmh ?? 0) / 3.6)
        : undefined;
    return (
      <main className="dyno">
        <header>
          <span className="live">
            ● {source.toUpperCase()} · {activeVehicle.label}
            {/* Schermo tenuto acceso: un glifo, che la scritta faceva andare a capo l'intestazione. */}
            {wakeActive && <b title="Schermo tenuto acceso"> ▣</b>}
          </span>
          {activeChallenge.lap && laps.length > 0 && (
            <span className="lap-count">
              GIRO {laps.length + 1} · BEST {formatLapTime(bestLap(laps)?.seconds ?? 0)}
            </span>
          )}
          <b>
            {clock.toFixed(1)}
            <small>{activeChallenge.distanceKm ? " SEC" : " SEC LEFT"}</small>
          </b>
        </header>
        <TrackMap
          challenge={challenge}
          meters={metersDone}
          vehicle={vehicle}
          onVehicleChange={selectVehicle}
          ghost={ghost}
          ghostMeters={ghostMeters}
          ghostVehicle={ghost === "best" ? (record?.vehicle ?? "velomobile") : ghost === "none" ? vehicle : ghost}
          ghostName={ghostLabel(ghost, record)}
          bestLabel={record ? `${record.participantName} · ${formatLapTime(record.elapsedSeconds ?? 0)}` : undefined}
          gradePercent={gradePercent}
          remainingClimb={liveTrack && liveTrack.totalClimb > 150 ? Math.max(0, liveTrack.totalClimb - climbed) : undefined}
          rivalSeconds={rivalSeconds}
          bestSeconds={bestSeconds}
          onGhostChange={selectGhost}
          running
        />
        {lapFlash && (
          <section key={lapFlash.lap.index} className={`lap-flash ${lapFlash.rank === 1 ? "best" : ""}`}>
            <header>
              <b>GIRO {lapFlash.lap.index}</b>
              <strong>{formatLapTime(lapFlash.lap.seconds)}</strong>
              <span>{rankLabel(lapFlash.rank, lapFlash.total)}</span>
            </header>
            <dl>
              <div><dt>MEDIA</dt><dd>{lapFlash.lap.averageKmh.toFixed(1)} km/h</dd></div>
              <div><dt>MAX</dt><dd>{lapFlash.lap.maxKmh.toFixed(1)} km/h</dd></div>
              <div><dt>W MEDI</dt><dd>{Math.round(lapFlash.lap.averageWatts)} W</dd></div>
              <div><dt>W MAX</dt><dd>{Math.round(lapFlash.lap.maxWatts)} W</dd></div>
            </dl>
          </section>
        )}
        {isSprint && <VehicleControls vehicle={vehicle} onChange={selectVehicle} />}
        {isSprint && (
          <section className="sprint">
            {/* Banda riservata al lampo: così esplode senza coprire i watt che stai leggendo. */}
            <div className="burst-zone">
              {burst && (
                <div key={burst.id} className={`peak-burst burst-${burst.kind} ${burst.hundred ? "hundred" : ""}`} aria-hidden="true">
                  <span>{burst.title}</span>
                  <small>{burst.message}</small>
                </div>
              )}
            </div>
            <div className={`sprint-primary ${powerLevel(displayPower)}`}>
              <label>POTENZA LIVE</label>
              <strong className={`power-readout ${powerLevel(displayPower)}`}>
                {displayPower}<em>W</em>
              </strong>
            </div>
            <Gauge power={displayPower} range={activeChallenge.powerRangeWatts} />
            <div className="sprint-secondary">
              <div className="sprint-best">
                <label>BEST 5 SEC</label>
                <strong className={powerLevel(liveBest5s ?? 0)}>{liveBest5s === null ? "--" : Math.round(liveBest5s)}<em>W</em></strong>
              </div>
              <div className="sprint-speed">
                <label>VELOCITÀ</label>
                <strong className={`speed-readout ${newSpeedPeak ? "speed-peak" : ""}`}>
                  {displaySpeed.toFixed(1)}<em>km/h</em>
                </strong>
              </div>
            </div>
            <PowerChart samples={samples} />
            <section className="metrics">
              <Metric n="PICCO POTENZA" v={`${Math.round(peakPower)} W`} />
              <Metric n="CADENZA" v={`${live?.cadenceRpm ?? "--"} rpm`} />
              <Metric n="PICCO CADENZA" v={fmt(liveMetrics.maxCadence, "rpm")} />
              <Metric n="PICCO VELOCITÀ" v={`${speedPeak.toFixed(1)} km/h`} />
            </section>
          </section>
        )}
        {!isSprint && (
        <section className="hero">
          <div className="hero-reading power-reading">
            <label>POTENZA</label>
            <strong className={`power-readout ${powerLevel(displayPower)}`}>
              {displayPower}<em> W</em>
            </strong>
            <Gauge power={displayPower} range={activeChallenge.powerRangeWatts} />
          </div>
          <div className="hero-reading speed-reading">
            <label>VELOCITÀ</label>
            <SpeedDial speed={displaySpeed} />
            <strong className={`speed-readout ${newSpeedPeak ? "speed-peak" : ""}`}>
              {displaySpeed.toFixed(1)}<em> km/h</em>
            </strong>
            <div className={`speed-scale ${newSpeedPeak ? "speed-extra" : ""}`}><div style={{width:`${Math.min(100,displaySpeed)}%`}}/>{newSpeedPeak&&<i>NUOVO PICCO · {speedPeak.toFixed(1)} km/h</i>}<span>0</span><b>100 km/h</b></div>
          </div>
        </section>
        )}
        {liveTrack && (
          <section className="run-strip">
            {/* Un solo quadro dati: potenza e velocità sono già enormi qui sopra,
                la pendenza e il residuo stanno sulla mappa. */}
            <Bar
              n={challenge === "monza" ? "POTENZA MEDIA" : "PICCO POTENZA"}
              v={`${Math.round(challenge === "monza" ? liveMetrics.averagePower : peakPower)}`}
              u="W"
              fill={(challenge === "monza" ? liveMetrics.averagePower : peakPower) / activeChallenge.powerRangeWatts}
              tone="power"
              emphasis={challenge === "monza"}
            />
            <Bar n="CADENZA" v={`${live?.cadenceRpm ?? "--"}`} u="rpm" fill={(live?.cadenceRpm ?? 0) / 150} tone="cadence" />
            <Bar
              n={challenge === "monza" ? "VELOCITÀ MEDIA" : "PICCO VELOCITÀ"}
              v={(challenge === "monza" ? averageSpeedKmh : speedPeak).toFixed(1)}
              u="km/h"
              fill={(challenge === "monza" ? averageSpeedKmh : speedPeak) / 100}
              tone="speed"
              emphasis={challenge === "monza"}
            />
            <Bar
              n="DISTANZA"
              v={(metersDone / 1000).toFixed(2)}
              u="km"
              fill={metersDone / liveTrack.lengthMeters}
              tone="distance"
            />
            {liveTrack.totalClimb > 150 ? (
              <>
                <Bar n="DISLIVELLO TOTALE" v={`${Math.round(liveTrack.totalClimb)}`} u="m D+" fill={climbed / liveTrack.totalClimb} tone="climb" />
                <Bar n="RIMANENTE" v={`${Math.round(Math.max(0, liveTrack.totalClimb - climbed))}`} u="m D+" fill={1 - climbed / liveTrack.totalClimb} tone="climb" />
              </>
            ) : (
              // Su un anello piatto la mappa non mostra la pendenza: qui serve ancora.
              <Bar
                n="PENDENZA"
                v={`${gradePercent >= 0 ? "+" : ""}${gradePercent.toFixed(1)}`}
                u="%"
                fill={Math.abs(gradePercent) / 15}
                tone={gradeStripTone(gradePercent)}
              />
            )}
          </section>
        )}
        {liveTrack && (
          <ElevationProfile
            track={liveTrack}
            meters={metersDone}
            windowMeters={liveTrack.totalClimb > 150 ? 1000 : undefined}
          />
        )}
        {!isSprint && <PowerChart samples={samples} />}
        <button className="danger" onClick={() => finish(activeChallenge.lap && laps.length > 0)}>
          {activeChallenge.lap && laps.length > 0 ? "TERMINA SESSIONE" : "STOP / INVALIDA"}
        </button>
      </main>
    );
  }
  if (view === "result" && result)
    return (
      <main>
        {nav}
        <section className="result">
          <p className={result.quality === "DEMO" ? "tag demo" : "tag"}>
            {result.quality}
          </p>
          <h1>{result.participantName}</h1>
          <p className="system-weight">
            {challenges[result.challenge ?? "dyno"].label} · {result.riderWeightKg ?? 70} kg atleta +{" "}
            {result.vehicle ? vehicles[result.vehicle].weightKg : 24} kg mezzo + 2 kg accessori
          </p>
          {result.bestLapSeconds ? (
            <>
              <label>MIGLIOR GIRO · {result.laps?.length ?? 0} GIRI</label>
              <strong>{formatLapTime(result.bestLapSeconds)}</strong>
            </>
          ) : result.challenge && result.challenge !== "dyno" ? (
            <>
              <label>{result.completed ? "TEMPO SUL PERCORSO" : "PROVA NON COMPLETATA"}</label>
              <strong>{result.completed ? formatLapTime(result.elapsedSeconds ?? 0) : `${(result.distanceKm ?? 0).toFixed(2)} km`}</strong>
            </>
          ) : (
            <>
              <label>BEST 5 SECONDS</label>
              <strong>{fmt(result.best5s)}</strong>
            </>
          )}
          <div className="result-grid">
            <Metric n="PEAK POWER" v={fmt(result.peakPower)} />
            <Metric n="AVG POWER" v={fmt(result.averagePower)} />
            <Metric n="MAX SPEED" v={fmt(result.maxVirtualSpeed, "km/h")} />
            <Metric n="CADENCE MAX" v={fmt(result.maxCadence, "rpm")} />
            <Metric
              n="POWER DROP"
              v={
                result.powerDrop === null
                  ? "--"
                  : `${result.powerDrop.toFixed(0)}%`
              }
            />
            <Metric
              n="SESSION TIME"
              v={`${result.sessionDuration.toFixed(1)} s`}
            />
            {!!result.distanceKm && <Metric n="DISTANZA" v={`${result.distanceKm.toFixed(2)} km`} />}
            {!!result.climbedMeters && result.climbedMeters > 30 && (
              <Metric n="DISLIVELLO" v={`${Math.round(result.climbedMeters)} m D+`} />
            )}
            {!!result.distanceKm && !!result.elapsedSeconds && (
              <Metric n="MEDIA" v={`${(result.distanceKm / (result.elapsedSeconds / 3600)).toFixed(1)} km/h`} />
            )}
          </div>
          {!!result.laps?.length && <LapTable laps={result.laps} />}
          <PowerChart samples={result.samples} />
          <div className="actions">
            <button className="primary" onClick={save}>
              SAVE RESULT
            </button>
            <button onClick={begin}>RETRY</button>
            <button onClick={newRider}>NEW RIDER</button>
          </div>
          <p>{notice}</p>
        </section>
      </main>
    );
  if (view === "leaderboard")
    return (
      <main>
        {nav}
        <section className="page">
          <h1>LEADERBOARD · {activeChallenge.label}</h1>
          <p className="sub">
            {challenge === "dyno" ? "ORDINATA PER BEST 5 SECONDS" : "ORDINATA PER TEMPO SUL PERCORSO"} · SOLO SESSIONI VALID
          </p>
          <div className="challenge-tabs">
            {(Object.keys(challenges) as ChallengeId[]).map((id) => (
              <button key={id} className={challenge === id ? "chosen" : ""} onClick={() => setChallenge(id)}>
                {challenges[id].label}
              </button>
            ))}
          </div>
          <Table
            challenge={challenge}
            sessions={ranked}
            onDelete={async (id) => {
              if (confirm("Eliminare risultato?")) {
                await sessionRepo.delete(id);
                setSessions(await sessionRepo.getAll());
              }
            }}
          />
          <h2>DEMO</h2>
          <Table challenge={challenge} sessions={demor} />
          <div className="actions">
            <button
              onClick={() =>
                download(
                  `hpv-power-dyno-${challenge}.csv`,
                  "Rank,Name,Date,Challenge,Vehicle,TimeSeconds,DistanceKm,Best5s,Peak,Average,Source,Valid\n" +
                    ranked
                      .map(
                        (s, i) =>
                          `${i + 1},${s.participantName},${new Date(s.timestamp).toISOString()},${s.challenge ?? "dyno"},${s.vehicle ?? ""},${(s.elapsedSeconds ?? 0).toFixed(1)},${(s.distanceKm ?? 0).toFixed(3)},${s.best5s},${s.peakPower},${s.averagePower},${s.dataSource},${s.validSession}`,
                      )
                      .join("\n"),
                  "text/csv",
                )
              }
            >
              EXPORT CSV
            </button>
            <button
              onClick={() =>
                download(
                  "hpv-power-dyno.json",
                  JSON.stringify(sessions),
                  "application/json",
                )
              }
            >
              EXPORT JSON
            </button>
          </div>
        </section>
      </main>
    );
  if (view === "settings")
    return (
      <main>
        {nav}
        <section className="page">
          <h1>SETTINGS</h1>
          <label className="field">
            EVENT NAME
            <input
              value={settings.eventName}
              onChange={(e) =>
                setSettings({ ...settings, eventName: e.target.value })
              }
            />
          </label>
          <label className="field">
            DEFAULT DURATION
            <select
              value={settings.defaultDuration}
              onChange={(e) =>
                setSettings({ ...settings, defaultDuration: +e.target.value })
              }
            >
              {[10, 20, 30, 60].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="audio-setting">
            <input
              type="checkbox"
              checked={settings.audio}
              onChange={(e) => setSettings({ ...settings, audio: e.target.checked })}
            />
            EFFETTI AUDIO E COUNTDOWN
          </label>
          <button
            className="primary"
            onClick={() =>
              sessionRepo
                .setSettings(settings)
                .then(() => setNotice("Impostazioni salvate"))
            }
          >
            SAVE SETTINGS
          </button>
          <button
            className="danger"
            onClick={async () => {
              if (confirm("RESET EVENT DATA?")) {
                await sessionRepo.clear();
                setSessions([]);
              }
            }}
          >
            RESET EVENT DATA
          </button>
          <p>{notice}</p>
        </section>
      </main>
    );
  if (view === "debug")
    return (
      <main>
        {nav}
        <section className="page">
          <h1>DEBUG BLE</h1>
          <dl>
            <dt>DEVICE NAME</dt>
            <dd>{isA ? (provider.device?.name ?? "--") : "--"}</dd>
            <dt>CONNECTED</dt>
            <dd>{isA && provider.connected ? "YES" : "NO"}</dd>
            <dt>BATTERY</dt>
            <dd>
              {isA && provider.battery !== undefined
                ? `${provider.battery}%`
                : "--"}
            </dd>
            <dt>PACKETS RECEIVED</dt>
            <dd>{isA ? provider.logs.length : "0"}</dd>
            <dt>LIVE POWER</dt>
            <dd>{live?.powerWatts ?? 0} W</dd>
          </dl>
          <pre>
            {isA
              ? provider.logs.join("\n")
              : "Connetti Assioma per vedere i log."}
          </pre>
          {isA && (
            <button
              className="danger"
              onClick={() =>
                provider.disconnect?.().then(() => setNotice("Disconnesso"))
              }
            >
              DISCONNECT
            </button>
          )}
        </section>
      </main>
    );
  if (view === "display")
    return (
      <main className="display">
        <header>
          <span>{settings.eventName}</span>
          <b>HPV POWER CHALLENGE</b>
        </header>
        <section>
          <h1>TOP 10</h1>
          <Table sessions={ranked.slice(0, 10)} />
        </section>
      </main>
    );
  return (
    <main>
      {nav}
      <section className="home">
        <p className="eyebrow">LIVE EVENT CONSOLE</p>
        <h1>
          HPV <span>POWER</span> DYNO
        </h1>
        <p className={isA && provider.connected ? "connected" : "disconnected"}>
          ● {provider.status()}
        </p>
        <div className="field-row">
          <label className="field">
            NOME <small>facoltativo</small>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nickname"
            />
          </label>
          <label className="field">
            PESO <small>kg · default 70</small>
            <input value={riderWeight} onChange={(e) => setRiderWeight(e.target.value)} inputMode="decimal" placeholder="70" aria-label="Peso atleta in kg" />
          </label>
        </div>
        <fieldset>
          <legend>MODALITÀ SFIDA</legend>
          <div className="selector">
            {(Object.keys(challenges) as ChallengeId[]).map((id) => (
              <button
                key={id}
                className={challenge === id ? "chosen" : ""}
                onClick={() => setChallenge(id)}
              >
                <b>{challenges[id].label}</b>
                <small>{challenges[id].description}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="actions">
          <button className="primary" onClick={begin}>
            START TEST
          </button>
          <button onClick={connect}>CONNECT ASSIOMA</button>
        </div>
        {notice && <p className="notice">{notice}</p>}
      </section>
    </main>
  );
}
function LapTable({ laps }: { laps: Lap[] }) {
  const fastest = bestLap(laps)?.seconds;
  return (
    <div className="lap-table">
      <div className="tr head">
        <span>GIRO</span><span>TEMPO</span><span>MEDIA</span><span>MAX</span><span>W MEDI</span><span>W MAX</span>
      </div>
      {laps.map((lap) => (
        <div className={`tr ${lap.seconds === fastest ? "best" : ""}`} key={lap.index}>
          <span>{lap.index}</span>
          <span>{formatLapTime(lap.seconds)}</span>
          <span>{lap.averageKmh.toFixed(1)}</span>
          <span>{lap.maxKmh.toFixed(1)}</span>
          <span>{Math.round(lap.averageWatts)}</span>
          <span>{Math.round(lap.maxWatts)}</span>
        </div>
      ))}
    </div>
  );
}
function Metric({ n, v }: { n: string; v: string }) {
  return (
    <div>
      <label>{n}</label>
      <b>{v}</b>
    </div>
  );
}
/** Stesse soglie del riquadro pendenza sulla mappa: due scale diverse confondono. */
const gradeStripTone = (percent: number) =>
  percent < 2 ? "grade-flat" : percent < 5 ? "grade-easy" : percent < 8 ? "grade-mid" : percent < 11 ? "grade-hard" : "grade-wall";
function Bar({ n, v, u, fill, tone, emphasis = false }: { n: string; v: string; u: string; fill: number; tone: string; emphasis?: boolean }) {
  return (
    <div className={`run-cell tone-${tone} ${emphasis ? "emphasis" : ""}`}>
      <label>{n}</label>
      <b>
        {v}
        <em> {u}</em>
      </b>
      <i style={{ width: `${Math.max(0, Math.min(100, fill * 100))}%` }} />
    </div>
  );
}
function SpeedDial({ speed }: { speed: number }) {
  const ratio = Math.min(1, speed / 100);
  return <div className="speed-dial" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <span key={index} className={index / 24 <= ratio ? index >= 21 ? "lit red" : "lit" : ""} style={{ transform: `rotate(${-120 + index * 10}deg)` }} />)}</div>
}
function VehicleControls({ vehicle, onChange }: { vehicle: VehicleProfile; onChange: (vehicle: VehicleProfile) => void }) {
  return <aside className="test-vehicle-switch">{(Object.keys(vehicles) as VehicleProfile[]).map(id=><button onClick={()=>onChange(id)} className={vehicle===id?"active":""} key={id}><VehicleIcon vehicle={id}/><span>{vehicles[id].label}</span><small>CdA <b>{vehicles[id].cda.toFixed(3).replace(".", ",")}</b></small><small>Crr <b>{vehicles[id].crr.toFixed(4).replace(".", ",")}</b></small></button>)}</aside>
}
function Table({
  sessions,
  onDelete,
  challenge = "dyno",
}: {
  sessions: DynoSession[];
  onDelete?: (id: string) => void;
  challenge?: ChallengeId;
}) {
  const timed = challenge !== "dyno";
  return (
    <div className="table">
      <div className="tr head">
        <span>POS</span>
        <span>NAME</span>
        <span>{timed ? "TEMPO" : "BEST 5S"}</span>
        <span>{timed ? "MEZZO" : "PEAK"}</span>
        <span>AVG</span>
      </div>
      {sessions.length ? (
        sessions.map((s, i) => (
          <div className="tr" key={s.id}>
            <span>{i + 1}</span>
            <span>{s.participantName}</span>
            <span>{timed ? (s.completed ? formatLapTime(s.elapsedSeconds ?? 0) : "DNF") : fmt(s.best5s)}</span>
            <span>{timed ? (s.vehicle ? vehicles[s.vehicle].label : "--") : fmt(s.peakPower)}</span>
            <span>{fmt(s.averagePower)}</span>
            {onDelete && <button onClick={() => onDelete(s.id)}>×</button>}
          </div>
        ))
      ) : (
        <p className="empty">Nessun risultato</p>
      )}
    </div>
  );
}
