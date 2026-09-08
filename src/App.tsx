import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChallengeId,
  DataSource,
  DynoSession,
  PowerDataProvider,
  SessionSample,
  Settings,
  VehicleProfile,
} from "./types";
import { DemoPowerProvider } from "./services/demoProvider";
import { AssiomaBluetoothProvider } from "./services/assiomaBluetooth";
import { advanceVirtualSpeed, trackGrade } from "./logic/speed";
import { calculateMetrics, leaderboardSort } from "./logic/metrics";
import { sessionRepo, download } from "./storage/repository";
import { Gauge } from "./components/Gauge";
import { PowerChart } from "./components/PowerChart";
import { TrackMap } from "./components/TrackMap";
import { challenges, vehicles } from "./logic/challenges";
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
    [clock, setClock] = useState(0),
    [result, setResult] = useState<DynoSession>(),
    [sessions, setSessions] = useState<DynoSession[]>([]),
    [count, setCount] = useState(3),
    [notice, setNotice] = useState(""),
    [riderWeight, setRiderWeight] = useState(""),
    [vehicle, setVehicle] = useState<VehicleProfile>("velomobile"),
    [challenge, setChallenge] = useState<ChallengeId>("dyno");
  const pRef = useRef(provider),
    sRef = useRef<SessionSample[]>([]),
    start = useRef(0),
    timer = useRef<number>(),
    ended = useRef(false),
    vehicleRef = useRef<VehicleProfile>("velomobile"),
    riderNameRef = useRef(""),
    riderWeightRef = useRef(70);
  pRef.current = provider;
  useEffect(() => {
    sessionRepo.settings(defaults).then(setSettings);
    sessionRepo.getAll().then(setSessions);
  }, []);
  const live = samples.at(-1),
    isA = provider instanceof AssiomaBluetoothProvider,
    activeChallenge = challenges[challenge],
    activeVehicle = vehicles[vehicle];
  const speedPeak = Math.max(0, ...samples.map((x) => x.virtualSpeedKmh));
  const newSpeedPeak = !!live && samples.length > 1 && live.virtualSpeedKmh > Math.max(0, ...samples.slice(0, -1).map((x) => x.virtualSpeedKmh));
  const nav = (
    <nav>
      <button onClick={() => setView("home")}>HOME</button>
      <button onClick={() => setView("leaderboard")}>CLASSIFICA</button>
      <button onClick={() => setView("debug")}>DEBUG</button>
      <button onClick={() => setView("settings")}>SETTINGS</button>
    </nav>
  );
  function demo() {
    provider.stop();
    setProvider(new DemoPowerProvider());
    setSource("demo");
    setNotice("DEMO MODE ATTIVA");
  }
  function selectVehicle(next: VehicleProfile) {
    vehicleRef.current = next;
    setVehicle(next);
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
    setName(riderNameRef.current);
    sRef.current = [];
    setSamples([]);
    setCount(3);
    setView("countdown");
    let n = 3;
    const i = window.setInterval(() => {
      n--;
      setCount(n);
      if (!n) {
        clearInterval(i);
        startSession();
      }
    }, 1000);
  }
  function startSession() {
    start.current = performance.now();
    ended.current = false;
    setView("dyno");
    const course = challenges[challenge];
    try {
      pRef.current.start((x) => {
        if (ended.current) return;
        const prev = sRef.current.at(-1),
          elapsed = x.timestamp - start.current,
          dt = prev ? x.timestamp - prev.timestamp : 0,
          speed = advanceVirtualSpeed({
            powerWatts: x.powerWatts,
            previousKmh: prev?.virtualSpeedKmh ?? 0,
            dtSeconds: dt / 1000,
            grade: trackGrade(challenge, prev?.distanceKm ?? 0),
            totalKg: riderWeightRef.current + vehicles[vehicleRef.current].weightKg + 2,
            aeroCoefficient: vehicles[vehicleRef.current].aeroCoefficient,
          }),
          distance =
            (prev?.distanceKm ?? 0) +
            ((((prev?.virtualSpeedKmh ?? speed) + speed) / 2) * dt) / 3600000,
          y: SessionSample = {
            ...x,
            elapsedMs: elapsed,
            virtualSpeedKmh: speed,
            distanceKm: distance,
          };
        sRef.current.push(y);
        setSamples([...sRef.current]);
        if (course.distanceKm && distance >= course.distanceKm) finish(true);
      });
    } catch (e) {
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
    if (timer.current) clearInterval(timer.current);
    pRef.current.stop();
    const data = sRef.current,
      m = calculateMetrics(data, settings.thresholds);
    setResult({
      id: crypto.randomUUID(),
      participantName: riderNameRef.current,
      riderWeightKg: riderWeightRef.current,
      vehicle: vehicleRef.current,
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
      () => leaderboardSort(sessions.filter((x) => x.validSession)),
      [sessions],
    ),
    demor = useMemo(
      () => leaderboardSort(sessions.filter((x) => x.dataSource === "demo")),
      [sessions],
    );
  if (view === "countdown")
    return (
      <main className="countdown">
        <div>{count || "GO!"}</div>
      </main>
    );
  if (view === "dyno") {
    const progress = activeChallenge.distanceKm
      ? (live?.distanceKm ?? 0) / activeChallenge.distanceKm
      : 0;
    return (
      <main className="dyno">
        <header>
          <span className="live">
            ● {source.toUpperCase()} · {activeVehicle.label}
          </span>
          <b>
            {clock.toFixed(1)}
            <small>{activeChallenge.distanceKm ? " SEC" : " SEC LEFT"}</small>
          </b>
        </header>
        <TrackMap challenge={challenge} progress={progress} elapsedSeconds={clock} vehicle={vehicle} onVehicleChange={selectVehicle} />
        {challenge === "dyno" && <VehicleControls vehicle={vehicle} onChange={selectVehicle} />}
        <section className="hero">
          <div className="hero-reading power-reading">
            <label>POTENZA</label>
            <strong className={`power-readout ${powerLevel(live?.powerWatts ?? 0)}`}>
              {live?.powerWatts ?? 0}<em> W</em>
            </strong>
            <Gauge power={live?.powerWatts ?? 0} range={750} />
          </div>
          <div className="hero-reading speed-reading">
            <label>VELOCITÀ</label>
            <strong className={`speed-readout ${newSpeedPeak ? "speed-peak" : ""}`}>
              {(live?.virtualSpeedKmh ?? 0).toFixed(1)}<em> km/h</em>
            </strong>
            <div className={`speed-scale ${newSpeedPeak ? "speed-extra" : ""}`}><div style={{width:`${Math.min(100,(live?.virtualSpeedKmh??0))}%`}}/>{newSpeedPeak&&<i>NUOVO PICCO · {speedPeak.toFixed(1)} km/h</i>}<span>0</span><b>100 km/h</b></div>
          </div>
        </section>
        <section className="metrics">
          <Metric
            n="PEAK"
            v={`${Math.max(0, ...samples.map((x) => x.powerWatts))} W`}
          />
          <Metric n="CADENCE" v={`${live?.cadenceRpm ?? "--"} rpm`} />
          <Metric
            n="MAX SPEED"
            v={`${speedPeak.toFixed(1)} km/h`}
          />
          <Metric
            n="DISTANCE"
            v={
              activeChallenge.distanceKm
                ? `${((live?.distanceKm ?? 0) * 1000).toFixed(0)} m`
                : fmt(calculateMetrics(samples, settings.thresholds).best5s)
            }
          />
        </section>
        <PowerChart samples={samples} />
        <button className="danger" onClick={() => finish(false)}>
          STOP / INVALIDA
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
          <p className="system-weight">{result.riderWeightKg ?? 70} kg atleta + {result.vehicle ? vehicles[result.vehicle].weightKg : 24} kg mezzo + 2 kg accessori</p>
          <label>BEST 5 SECONDS</label>
          <strong>{fmt(result.best5s)}</strong>
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
          </div>
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
          <h1>LEADERBOARD</h1>
          <p className="sub">
            ORDINATA PER BEST 5 SECONDS · SOLO SESSIONI VALID
          </p>
          <Table
            sessions={ranked}
            onDelete={async (id) => {
              if (confirm("Eliminare risultato?")) {
                await sessionRepo.delete(id);
                setSessions(await sessionRepo.getAll());
              }
            }}
          />
          <h2>DEMO</h2>
          <Table sessions={demor} />
          <div className="actions">
            <button
              onClick={() =>
                download(
                  "hpv-power-dyno.csv",
                  "Rank,Name,Date,Best5s,Peak,Average,Source,Valid\n" +
                    ranked
                      .map(
                        (s, i) =>
                          `${i + 1},${s.participantName},${new Date(s.timestamp).toISOString()},${s.best5s},${s.peakPower},${s.averagePower},${s.dataSource},${s.validSession}`,
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
        <label className="field">
          NOME PARTECIPANTE <small>facoltativo</small>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome o nickname"
          />
        </label>
        <label className="field">
          PESO ATLETA <small>facoltativo · predefinito 70 kg</small>
          <input value={riderWeight} onChange={(e) => setRiderWeight(e.target.value)} inputMode="decimal" placeholder="70" aria-label="Peso atleta in kg" />
        </label>
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
          <button onClick={demo}>DEMO MODE</button>
        </div>
        {notice && <p className="notice">{notice}</p>}
      </section>
    </main>
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
function VehicleControls({ vehicle, onChange }: { vehicle: VehicleProfile; onChange: (vehicle: VehicleProfile) => void }) {
  return <aside className="test-vehicle-switch">{(Object.keys(vehicles) as VehicleProfile[]).map(id=><button onClick={()=>onChange(id)} className={vehicle===id?"active":""} key={id}><strong>{id==="velomobile"?"◖":id==="trike"?"△":"●"}</strong><span>{vehicles[id].label}</span><small>{vehicles[id].referenceKmh} km/h @250W</small></button>)}</aside>
}
function Table({
  sessions,
  onDelete,
}: {
  sessions: DynoSession[];
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="table">
      <div className="tr head">
        <span>POS</span>
        <span>NAME</span>
        <span>BEST 5S</span>
        <span>PEAK</span>
        <span>AVG</span>
      </div>
      {sessions.length ? (
        sessions.map((s, i) => (
          <div className="tr" key={s.id}>
            <span>{i + 1}</span>
            <span>{s.participantName}</span>
            <span>{fmt(s.best5s)}</span>
            <span>{fmt(s.peakPower)}</span>
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
