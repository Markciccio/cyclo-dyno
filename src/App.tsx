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
import { DynoAudioEngine } from "./services/dynoAudioEngine";
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
type StoredLapReference = { session: DynoSession; lap: Lap };

/** Il primato di pista è costruito soltanto dai giri realmente registrati,
 * mai da una demo: il riferimento resta quindi credibile anche tra sessioni. */
function bestRecordedLap(sessions: DynoSession[], challenge: ChallengeId): StoredLapReference | undefined {
  return sessions.reduce<StoredLapReference | undefined>((best, session) => {
    if (
      (session.challenge ?? "dyno") !== challenge ||
      session.dataSource === "demo" ||
      !session.validSession
    ) return best;
    const lap = bestLap(session.laps ?? []);
    if (!lap || (best && best.lap.seconds <= lap.seconds)) return best;
    return { session, lap };
  }, undefined);
}
const deltaLabel = (seconds: number | undefined) => {
  if (seconds === undefined || !Number.isFinite(seconds)) return "--";
  // Il confronto deve essere leggibile al volo: un valore ogni secondo, non
  // una cascata di decimi che lampeggiano mentre si pedala.
  const rounded = Math.round(seconds);
  return `${rounded > 0 ? "+" : ""}${rounded}s`;
};
const powerLevel = (w: number) =>
  w > 500
    ? "power-extra"
    : w >= 400
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
  kind: "peak" | "hold" | "drop" | "redline";
  hundred: boolean;
  extra?: boolean;
};
// Il wattaggio centrale deve restare leggibile ma seguire meglio gli sprint:
// gli altri pannelli mantengono le rispettive frequenze di aggiornamento.
const POWER_REFRESH_MS = 500;
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
const dropMessages = [
  "RILANCIA ORA!",
  "NON MOLLARE ADESSO!",
  "TORNA A SPINGERE!",
  "RIPRENDI IL RITMO!",
  "ANCORA UNA MARCIA!",
  "GAMBE ATTIVE!",
  "RISPONDI COL PEDALE!",
  "IL TRENO RIPARTE!",
  "DAI UN COLPO DI GAS!",
  "QUESTO È IL MOMENTO!",
  "RIMETTI PRESSIONE!",
  "NON LASCIARE WATT!",
];
const riderTitles = [
  "CAPITAN CATENA", "DOTTOR WATT", "TURBO GHIRO", "MISS SCATTO", "IL PEDALATORE",
  "LADY RAPPORTI", "BARONE DEL WATT", "SUPER COPERTONE", "FRECCIA DEL PARCO", "IL CICLOIDE",
  "BICI BOOM", "SIGNOR SELLA", "RE DEL RULLINO", "DUCA DEL PIGNONE", "NINJA DEL PEDALE",
  "COMANDANTE GUARNITURA", "PROFESSOR CAVALLETTO", "ZIO SPRINT", "REGINA DELLA SCIA", "MAESTRO DELLA SALITA",
];
const riderDescriptions = [
  "SCOMODA", "ASSOPITO", "SGONFIO", "TARDIVO", "MASCHERATO", "CORTI", "IMPROBABILE", "RUMOROSO",
  "STORTO", "SILENZIOSO", "TURBOLENTO", "DISTRATTO", "IN FUGA", "SENZA FRENI", "A MOLLA", "DI CARTONE",
  "DEL MERCOLEDÌ", "DA BAR", "SENZA BUSSOLA", "CON IL VENTO CONTRO", "A PEDALI LARGHI", "DAI CALZINI SPREZZANTI",
  "DELLO SPRINTINO", "DEL GIRO LUNGO",
];
const riderAliases = riderTitles.flatMap((title) => riderDescriptions.map((description) => `${title} ${description}`));
const randomRiderAlias = () => riderAliases[Math.floor(Math.random() * riderAliases.length)];
/** Gli alias assegnati dall'app restano univoci fra tutti i risultati salvati.
 * 20 × 24 combinazioni coprono comodamente un evento da 300–400 partecipanti. */
const uniqueRiderAlias = (sessions: DynoSession[]) => {
  const used = new Set(sessions.map((session) => session.participantName.trim().toLocaleUpperCase()));
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = randomRiderAlias();
    if (!used.has(candidate)) return candidate;
  }
  return riderAliases.find((candidate) => !used.has(candidate)) ?? "OSPITE DEL VELODROMO";
};
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
    [suggestedAlias, setSuggestedAlias] = useState(() => randomRiderAlias()),
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
    [count, setCount] = useState<number | "START!">(3),
    [notice, setNotice] = useState(""),
    [bleDiagnostics, setBleDiagnostics] = useState<string[]>([]),
    [bleLastError, setBleLastError] = useState(""),
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
    countdownTimer = useRef<number>(),
    countdownStartTimer = useRef<number>(),
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
    personalPeakRef = useRef(0),
    personalBest5Ref = useRef(0),
    best3Ref = useRef(0),
    lastBurstRef = useRef(0),
    lastCoachRef = useRef(0),
    lastDropRef = useRef(0),
    powerBandRef = useRef<"normal" | "red" | "extra">("normal"),
    burstId = useRef(0),
    lapsRef = useRef<Lap[]>([]),
    lapStartMs = useRef(0),
    lapStartKm = useRef(0),
    wakeLockRef = useRef<ScreenLock>(),
    dynoAudioRef = useRef(new DynoAudioEngine()),
    sessionActiveRef = useRef(false);
  pRef.current = provider;
  useEffect(() => {
    sessionRepo.settings(defaults).then(setSettings);
    sessionRepo.getAll().then((loaded) => {
      setSessions(loaded);
      setSuggestedAlias((current) =>
        loaded.some((session) => session.participantName.trim().toLocaleUpperCase() === current.toLocaleUpperCase())
          ? uniqueRiderAlias(loaded)
          : current,
      );
    });
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
    activeChallenge = challenges[challenge];
  const speedPeak = Math.max(0, ...samples.map((x) => x.virtualSpeedKmh));
  // bestWindow scandisce i campioni per ogni campione: va calcolato una volta sola.
  const liveMetrics = useMemo(() => calculateMetrics(samples, settings.thresholds), [samples, settings.thresholds]);
  const liveBest5s = liveMetrics.best5s;
  const newSpeedPeak = !!live && samples.length > 1 && live.virtualSpeedKmh > Math.max(0, ...samples.slice(0, -1).map((x) => x.virtualSpeedKmh));
  const nav = (
    <nav>
      <button onClick={goHome}>HOME</button>
      <button onClick={() => setView("leaderboard")}>CLASSIFICA</button>
      <button onClick={() => setView("debug")}>DEBUG</button>
      <button onClick={() => setView("settings")}>SETTINGS</button>
      <button className="install" onClick={installApp}>⇩ INSTALLA</button>
    </nav>
  );
  function goHome() {
    // Il ritorno alla Home deve fermare anche una partenza già programmata,
    // altrimenti il test ripartirebbe dopo aver lasciato il countdown.
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    if (countdownStartTimer.current) clearTimeout(countdownStartTimer.current);
    countdownTimer.current = undefined;
    countdownStartTimer.current = undefined;
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined;
    ended.current = true;
    sessionActiveRef.current = false;
    pRef.current.stop();
    dynoAudioRef.current.stop();
    void releaseWakeLock();
    setView("home");
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
    const log = (message: string) => setBleDiagnostics((entries) => [
      `${new Date().toLocaleTimeString()} ${message}`,
      ...entries,
    ].slice(0, 120));
    setBleDiagnostics([]);
    setBleLastError("");
    // Il Debug non deve scambiare l'ultimo campione DEMO per un dato Assioma:
    // un nuovo tentativo parte sempre da valori vuoti.
    sRef.current = [];
    setSamples([]);
    setDisplayPower(0);
    setDisplaySpeed(0);
    log(`CONTROLLO: HTTPS=${window.isSecureContext ? "OK" : "NO"} · Web Bluetooth=${navigator.bluetooth ? "OK" : "MANCANTE"} · Bluefy=${/bluefy/i.test(navigator.userAgent) ? "RILEVATO" : "NON RILEVATO"}`);
    try {
      const a = new AssiomaBluetoothProvider(log);
      await a.connect();
      setProvider(a);
      setSource("assioma");
      setNotice("ASSIOMA CONNECTED");
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e || "Errore senza dettaglio");
      log(`RISULTATO: ${detail}`);
      setBleLastError(detail);
      setNotice("CONNESSIONE ASSIOMA FALLITA — vedi DEBUG BLE");
      setView("debug");
    }
  }
  async function begin() {
    // Tutto l'audio viene sbloccato dal gesto Start: fondamentale su Safari e Android.
    // Non attendere: su Bluefy il resume deve restare nello stesso gesto Start.
    void dynoAudioRef.current.prepare(settings.audio);
    const randomName = uniqueRiderAlias(sessions);
    const parsedWeight = Number(riderWeight.replace(",", "."));
    riderNameRef.current = name.trim() || randomName;
    riderWeightRef.current = Number.isFinite(parsedWeight) && parsedWeight >= 35 && parsedWeight <= 180 ? parsedWeight : 70;
    const previousDyno = sessions.filter((session) =>
      (session.challenge ?? "dyno") === "dyno" &&
      session.participantName.trim().toLocaleUpperCase() === riderNameRef.current.trim().toLocaleUpperCase(),
    );
    personalPeakRef.current = Math.max(0, ...previousDyno.map((session) => session.peakPower ?? 0));
    personalBest5Ref.current = Math.max(0, ...previousDyno.map((session) => session.best5s ?? 0));
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
    lastDropRef.current = 0;
    powerBandRef.current = "normal";
    setBurst(undefined);
    lapsRef.current = [];
    lapStartMs.current = 0;
    lapStartKm.current = 0;
    setLaps([]);
    setLapFlash(undefined);
    setCount(3);
    setView("countdown");
    dynoAudioRef.current.playCountdownStep(3);
    let n = 3;
    countdownTimer.current = window.setInterval(() => {
      n--;
      if (n > 0) {
        setCount(n);
        dynoAudioRef.current.playCountdownStep(n);
      }
      if (!n) {
        clearInterval(countdownTimer.current);
        countdownTimer.current = undefined;
        // Il via deve essere una battuta a sé: sullo schermo resta START!
        // abbastanza a lungo da essere letto e il suo suono è distinto dai bip.
        setCount("START!");
        dynoAudioRef.current.playCountdownStart();
        countdownStartTimer.current = window.setTimeout(() => {
          countdownStartTimer.current = undefined;
          startSession();
        }, 700);
      }
    }, 1000);
  }
  function startSession() {
    start.current = performance.now();
    ended.current = false;
    sessionActiveRef.current = true;
    dynoAudioRef.current.start();
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
        let coachCue: "drop" | "hold" | "redline" | undefined;
        const powerBand = x.powerWatts > 500 ? "extra" : x.powerWatts >= 400 ? "red" : "normal";
        if (x.powerWatts > peakRef.current) {
          const hundred = Math.floor(x.powerWatts / 100) > Math.floor(peakRef.current / 100);
          peakRef.current = x.powerWatts;
          // In rampa ogni campione è un nuovo record: si annuncia a intervalli,
          // tranne quando si sfonda un centinaio, che merita sempre il lampo.
          if (hundred || x.timestamp - lastBurstRef.current > 700) {
            lastBurstRef.current = x.timestamp;
            feedback = {
              title: `NUOVO PICCO: ${Math.round(x.powerWatts)} W!`,
              message: hundred ? "POTENZA FUORI SCALA!" : "CONTINUA COSÌ!",
              kind: "peak",
              hundred,
              extra: x.powerWatts > 500,
            };
          }
        }
        // Nello Sprint l'incoraggiamento guarda una finestra reale di 3 s:
        // sprona a tenere lo sforzo, senza aggiungere avvisi Top 5 affollati.
        if (challenge === "dyno") {
          // Anche senza un nuovo record, l'ingresso nelle fasce calde merita
          // un segnale netto: rosso a 400 W, overdrive oltre 500 W.
          // L'ingresso oltre 400 W ha priorità perfino sul cartello del nuovo
          // picco: così il botto di zona rossa arriva sempre al momento giusto.
          if (powerBand !== "normal" && powerBand !== powerBandRef.current) {
            feedback = {
              title: powerBand === "extra" ? "OVERDRIVE!" : "ZONA ROSSA!",
              message: powerBand === "extra" ? "OLTRE 500 W · OVERDRIVE!" : "400 W RAGGIUNTI · SPINGI ANCORA!",
              kind: "redline",
              hundred: powerBand === "extra",
              extra: powerBand === "extra",
            };
          }
          powerBandRef.current = powerBand;
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
              hundred: current3 > 500,
              extra: current3 > 500,
            };
          }
          // Dopo una fase attiva, il calo va intercettato anche nei demo più
          // morbidi: qui confrontiamo il watt istantaneo col picco raggiunto.
          // Un richiamo ogni 6,5 s lascia tempo di leggerlo e di reagire.
          const hasMeaningfulDrop =
            elapsed >= 4000 &&
            peakRef.current >= 180 &&
            x.powerWatts < Math.max(80, peakRef.current * 0.72);
          if (!feedback && hasMeaningfulDrop && x.timestamp - lastDropRef.current >= 6500) {
            feedback = {
              title: dropMessages[burstId.current % dropMessages.length],
              message: `ORA ${Math.round(x.powerWatts)} W · RILANCIA!`,
              kind: "drop",
              hundred: false,
            };
          }
        }
        // Un solo cartello alla volta: picco o stimolo, massimo uno ogni 2 s.
        if (feedback && x.timestamp - lastCoachRef.current >= ALERT_COOLDOWN_MS) {
          lastCoachRef.current = x.timestamp;
          if (feedback.kind === "drop") lastDropRef.current = x.timestamp;
          // Picchi e record hanno già il loro jingle. Tutti i messaggi di
          // coaching ricevono invece un richiamo dedicato, dopo il controller.
          if (feedback.kind !== "peak") coachCue = feedback.kind;
          setBurst({ ...feedback, id: burstId.current++ });
        }
        if (challenge === "dyno") {
          const nextSamples = [...sRef.current, y];
          // Il controller sceglie al massimo un evento importante: nessuna
          // esplosione a intervallo fisso e nessuna sovrapposizione casuale.
          const audioState = dynoAudioRef.current.update({
            powerWatts: x.powerWatts,
            timestamp: x.timestamp,
            peakPower: peakRef.current,
            best5s: trailingPower(nextSamples, 5),
            personalPeak: personalPeakRef.current,
            personalBest5s: personalBest5Ref.current,
          });
          // Priorità assoluta a record, soglie ed overdrive: il coach suona
          // soltanto quando non c'è già un effetto che copre lo stesso istante.
          if (coachCue && !audioState.event) dynoAudioRef.current.playCoachCue(coachCue);
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
          // Nel Velodromo i due delta rimangono sempre visibili: il vecchio
          // pannello a fine giro avrebbe nascosto proprio il confronto live.
          if (challenge !== "velodrome")
            setLapFlash({ lap, rank: lapRank(lap.seconds, lapsRef.current), total: lapsRef.current.length });
          lapStartMs.current = elapsed;
          lapStartKm.current = distance;
        }
        if (!course.lap && course.distanceKm && distance >= course.distanceKm) finish(true);
      });
    } catch (e) {
      sessionActiveRef.current = false;
      dynoAudioRef.current.stop();
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
    dynoAudioRef.current.stop();
    const data = sRef.current,
      m = calculateMetrics(data, settings.thresholds);
    setSamples([...data]);
    const covered = data.at(-1)?.distanceKm ?? 0;
    const course = challenges[challenge];
    const target = course.distanceKm;
    const sessionLaps = lapsRef.current;
    const fastest = bestLap(sessionLaps);
    const finishTrack = challengeTrack(challenge);
    const finishedResult: DynoSession = {
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
    };
    setResult(finishedResult);
    // Lo Sprint è una prova rapida da evento: ogni tentativo entra subito
    // nell'archivio, poi eventualmente si elimina dalla Classifica.
    if (challenge === "dyno") {
      void sessionRepo.save(finishedResult).then(async () => {
        setSessions(await sessionRepo.getAll());
        setNotice("RISULTATO SALVATO AUTOMATICAMENTE");
      });
    }
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
    setSuggestedAlias(uniqueRiderAlias(sessions));
    setSamples([]);
    setResult(undefined);
    setView("home");
  }
  const ranked = useMemo(
      () => rankFor(sessions.filter((x) => x.validSession), challenge),
      [sessions, challenge],
    ),
    leaderboardSessions = useMemo(
      () => rankFor(sessions.filter((x) => x.validSession || x.dataSource === "demo"), challenge),
      [sessions, challenge],
    );
  if (view === "countdown")
    return (
      <main className="countdown">
        <button className="session-home" onClick={goHome}>⌂ HOME</button>
        <div className={count === "START!" ? "countdown-start" : ""}>{count}</div>
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
    const showTrackAverages = challenge === "monza" || challenge === "velodrome";
    const sessionBestLap = challenge === "velodrome" ? bestLap(laps) : undefined;
    const absoluteVelodromeLap = challenge === "velodrome" ? bestRecordedLap(sessions, "velodrome") : undefined;
    const metersIntoLap = Math.max(0, metersDone - lapStartKm.current * 1000);
    const currentLapSeconds = Math.max(0, clock - lapStartMs.current / 1000);
    // Entrambi i riferimenti sono confrontati nello stesso punto dell'anello,
    // non al traguardo: perciò il delta è utile in ogni secondo del giro.
    const sessionLapDelta =
      sessionBestLap && metersIntoLap > 2
        ? currentLapSeconds - lapSecondsAt(samples, sessionBestLap, metersIntoLap)
        : undefined;
    const absoluteLapDelta =
      absoluteVelodromeLap && metersIntoLap > 2
        ? currentLapSeconds - lapSecondsAt(absoluteVelodromeLap.session.samples, absoluteVelodromeLap.lap, metersIntoLap)
        : undefined;
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
        <button className="session-home" onClick={goHome}>⌂ HOME</button>
        <header>
          <span className="live">
            ● {riderNameRef.current} · {provider.status().toUpperCase()}
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
        {lapFlash && challenge !== "velodrome" && (
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
            <Gauge power={displayPower} range={activeChallenge.powerRangeWatts} overdriveAt={500} />
            <div className="sprint-secondary">
              <div className="sprint-peak">
                <label>PICCO</label>
                <strong className={powerLevel(peakPower)}>{Math.round(peakPower)}<em>W</em></strong>
              </div>
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
          <div className="run-data">
        {challenge === "velodrome" && (
          <section className="velodrome-deltas" aria-live="polite">
            <div className={`velodrome-delta ${sessionLapDelta !== undefined && sessionLapDelta <= 0 ? "ahead" : "behind"}`}>
              <label>Δ BEST SESSIONE</label>
              <strong>{deltaLabel(sessionLapDelta)}</strong>
              <small>{sessionBestLap ? `riferimento ${formatLapTime(sessionBestLap.seconds)}` : "chiudi il primo giro"}</small>
            </div>
            <div className={`velodrome-delta ${absoluteLapDelta !== undefined && absoluteLapDelta <= 0 ? "ahead" : "behind"}`}>
              <label>Δ RECORD ASSOLUTO</label>
              <strong>{deltaLabel(absoluteLapDelta)}</strong>
              <small>{absoluteVelodromeLap ? `${absoluteVelodromeLap.session.participantName} · ${formatLapTime(absoluteVelodromeLap.lap.seconds)}` : "nessun record reale"}</small>
            </div>
          </section>
        )}
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
        {liveTrack && (
          <section className="run-strip">
            {/* Un solo quadro dati: potenza e velocità sono già enormi qui sopra,
                la pendenza e il residuo stanno sulla mappa. */}
            <Bar
              n={showTrackAverages ? "POTENZA MEDIA" : "PICCO POTENZA"}
              v={`${Math.round(showTrackAverages ? liveMetrics.averagePower : peakPower)}`}
              u="W"
              fill={(showTrackAverages ? liveMetrics.averagePower : peakPower) / activeChallenge.powerRangeWatts}
              tone="power"
              emphasis={showTrackAverages}
            />
            <Bar n="CADENZA" v={`${live?.cadenceRpm ?? "--"}`} u="rpm" fill={(live?.cadenceRpm ?? 0) / 150} tone="cadence" />
            <Bar
              n={showTrackAverages ? "VELOCITÀ MEDIA" : "PICCO VELOCITÀ"}
              v={(showTrackAverages ? averageSpeedKmh : speedPeak).toFixed(1)}
              u="km/h"
              fill={(showTrackAverages ? averageSpeedKmh : speedPeak) / 100}
              tone="speed"
              emphasis={showTrackAverages}
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
            <PowerChart samples={samples} />
          </div>
        )}
        <button className="danger" onClick={() => finish(activeChallenge.lap && laps.length > 0)}>
          {activeChallenge.lap && laps.length > 0 ? "TERMINA SESSIONE" : "STOP / INVALIDA"}
        </button>
      </main>
    );
  }
  if (view === "result" && result) {
    const isDynoResult = (result.challenge ?? "dyno") === "dyno";
    // Il risultato corrente non è ancora salvato: lo inseriamo provvisoriamente
    // nel gruppo giusto per poter mostrare subito posizione e podio.
    const rankingSource = result.dataSource === "demo"
      ? sessions.filter((session) => session.dataSource === "demo")
      : sessions.filter((session) => session.validSession);
    // Il salvataggio automatico può completarsi mentre il riepilogo è aperto:
    // in quel caso il risultato è già in rankingSource e non va aggiunto due volte.
    const dynoRanking = isDynoResult
      ? rankFor([...rankingSource.filter((session) => session.id !== result.id), result], "dyno")
      : [];
    const dynoPlace = dynoRanking.findIndex((session) => session.id === result.id) + 1;
    const rankingTitle = result.dataSource === "demo" ? "CLASSIFICA DEMO" : "CLASSIFICA UFFICIALE";
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
          ) : isDynoResult ? (
            <>
              <section className="dyno-result-score">
                <div className={`dyno-result-peak ${powerLevel(result.peakPower)}`}>
                  <label>POTENZA MASSIMA</label>
                  <strong>{Math.round(result.peakPower)}<em>W</em></strong>
                  <small>SEI {dynoPlace}º IN CLASSIFICA</small>
                </div>
                <div className="dyno-result-best5">
                  <label>POTENZA 5 SECONDI</label>
                  <strong>{fmt(result.best5s)}</strong>
                </div>
              </section>
              <section className="dyno-result-ranking">
                <p>{rankingTitle}</p>
                <strong>SEI {dynoPlace}º IN CLASSIFICA!</strong>
                <ol>
                  {dynoRanking.slice(0, 3).map((session, index) => (
                    <li className={session.id === result.id ? "you" : ""} key={session.id}>
                      <span>{index + 1}</span>
                      <b>{session.participantName}</b>
                      <strong>{Math.round(session.peakPower)} W</strong>
                      {index === 0 && session.id !== result.id && <small>+{Math.max(0, Math.round(session.peakPower - result.peakPower))} W</small>}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          ) : (
            <>
              <label>BEST 5 SECONDS</label>
              <strong>{fmt(result.best5s)}</strong>
            </>
          )}
          <div className="result-grid">
            <Metric n="BEST 5 SECONDS" v={fmt(result.best5s)} />
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
            {isDynoResult ? (
              <button className="primary" onClick={newRider}>TORNA ALLA HOME</button>
            ) : (
              <>
                <button className="primary" onClick={save}>
                  SAVE RESULT
                </button>
                <button onClick={begin}>RETRY</button>
                <button onClick={newRider}>NEW RIDER</button>
              </>
            )}
          </div>
          <p>{notice}</p>
        </section>
      </main>
    );
  }
  if (view === "leaderboard")
    return (
      <main>
        {nav}
        <section className="page">
          <h1>LEADERBOARD · {activeChallenge.label}</h1>
          <p className="sub">
            {challenge === "dyno" ? "ORDINATA PER PICCO POTENZA" : "ORDINATA PER TEMPO SUL PERCORSO"} · DEMO E SESSIONI REALI
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
            sessions={leaderboardSessions}
            onDelete={async (id) => {
              const selected = sessions.find((session) => session.id === id);
              if (confirm(`Eliminare solo il record di ${selected?.participantName ?? "questo atleta"}?`)) {
                await sessionRepo.delete(id);
                setSessions(await sessionRepo.getAll());
                setNotice("RECORD ELIMINATO");
              }
            }}
          />
          <div className="actions">
            <button
              onClick={() =>
                download(
                  `hpv-power-dyno-${challenge}.csv`,
                  "Rank,Name,Date,Challenge,Vehicle,TimeSeconds,DistanceKm,Best5s,Peak,Average,Source,Valid\n" +
                    leaderboardSessions
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
            <button
              className="danger"
              onClick={async () => {
                const toDelete = sessions.filter((session) => (session.challenge ?? "dyno") === challenge);
                if (!toDelete.length) return;
                if (confirm(`Cancellare tutti i ${toDelete.length} record di ${activeChallenge.label}, incluse le demo?`)) {
                  await Promise.all(toDelete.map((session) => sessionRepo.delete(session.id)));
                  setSessions(await sessionRepo.getAll());
                }
              }}
            >
              CANCELLA TUTTI I RECORD
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
          <button onClick={() => {
            dynoAudioRef.current.testFromGesture(settings.audio);
            window.setTimeout(() => setNotice(dynoAudioRef.current.audioStatus()), 600);
          }}>
            TEST AUDIO OVERDRIVE
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
            <dt>HTTPS</dt>
            <dd>{window.isSecureContext ? "OK" : "NO — apri la versione pubblicata"}</dd>
            <dt>WEB BLUETOOTH</dt>
            <dd>{navigator.bluetooth ? "DISPONIBILE" : "MANCANTE"}</dd>
            <dt>BLUEFY</dt>
            <dd>{/bluefy/i.test(navigator.userAgent) ? "RILEVATO" : "NON RILEVATO"}</dd>
            <dt>ULTIMO ERRORE</dt>
            <dd>{bleLastError || "--"}</dd>
            <dt>BATTERY</dt>
            <dd>
              {isA && provider.battery !== undefined
                ? `${provider.battery}%`
                : "--"}
            </dd>
            <dt>PACKETS RECEIVED</dt>
            <dd>{isA ? provider.logs.length : "0"}</dd>
            <dt>POWER DAL PEDALE</dt>
            <dd>{isA ? `${live?.powerWatts ?? 0} W` : "-- (Assioma non connesso)"}</dd>
          </dl>
          <pre>
            {bleDiagnostics.length
              ? bleDiagnostics.join("\n")
              : "Premi RIPROVA ASSIOMA: qui compariranno ogni passaggio e l'errore preciso."}
          </pre>
          <div className="actions">
            <button className="primary" onClick={connect}>RIPROVA ASSIOMA</button>
            <button onClick={() => { setBleDiagnostics([]); setBleLastError(""); }}>PULISCI DEBUG</button>
          </div>
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
          <button onClick={goHome}>⌂ HOME</button>
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
            NOME <small className="nickname-suggestion">facoltativo · suggerito: <button type="button" onClick={() => setName(suggestedAlias)}>{suggestedAlias}</button></small>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={suggestedAlias}
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
    <div className={`table ${onDelete ? "with-actions" : ""}`}>
      <div className="tr head">
        <span>POS</span>
        <span>NAME</span>
        <span>{timed ? "TEMPO" : "PICCO"}</span>
        <span>{timed ? "MEZZO" : "BEST 5S"}</span>
        <span>AVG</span>
        <span>FONTE</span>
        {onDelete && <span>ELIMINA</span>}
      </div>
      {sessions.length ? (
        sessions.map((s, i) => (
          <div className="tr" key={s.id}>
            <span>{i + 1}</span>
            <span>{s.participantName}</span>
            <span>{timed ? (s.completed ? formatLapTime(s.elapsedSeconds ?? 0) : "DNF") : fmt(s.peakPower)}</span>
            <span>{timed ? (s.vehicle ? vehicles[s.vehicle].label : "--") : fmt(s.best5s)}</span>
            <span>{fmt(s.averagePower)}</span>
            <span className={s.dataSource === "demo" ? "source-demo" : "source-real"}>{s.dataSource === "demo" ? "DEMO" : "REALE"}</span>
            {onDelete && (
              <button
                type="button"
                title={`Elimina solo il record di ${s.participantName}`}
                aria-label={`Elimina solo il record di ${s.participantName}`}
                onClick={() => onDelete(s.id)}
              >
                ELIMINA
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="empty">Nessun risultato</p>
      )}
    </div>
  );
}
