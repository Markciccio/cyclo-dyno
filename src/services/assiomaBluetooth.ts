import type {PowerDataProvider,PowerSample} from '../types'
export const CYCLING_POWER_SERVICE=0x1818,CYCLING_POWER_MEASUREMENT=0x2a63,BATTERY_SERVICE=0x180f,BATTERY_LEVEL=0x2a19
const CYCLING_POWER_SERVICE_UUID = "00001818-0000-1000-8000-00805f9b34fb";
const BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
export function parseCyclingPowerMeasurement(v:DataView){if(v.byteLength<4)throw Error('Invalid Cycling Power Measurement');return{powerWatts:v.getInt16(2,true)}}

/**
 * Su iPhone e iPad ogni browser è obbligato a usare WebKit, e WebKit non
 * implementa Web Bluetooth: nemmeno Chrome o Edge per iOS possono connettersi.
 * Vale la pena dirlo esplicitamente, altrimenti sembra un guasto dell'app.
 */
export function unsupportedReason() {
  const ua = navigator.userAgent
  const iPadOS = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS)
    return 'Su iPhone e iPad Web Bluetooth non esiste: usa Android per il sensore, oppure il browser Bluefy. In DEMO funziona tutto.'
  if (!window.isSecureContext) return "Serve HTTPS: apri la versione pubblicata, non l'indirizzo IP in chiaro."
  return 'Web Bluetooth non disponibile su questo browser: usa Chrome su Android.'
}

function errorDetail(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error || "errore senza dettaglio");
}

/** Il log arriva anche all'interfaccia prima che la connessione riesca. */
export class AssiomaBluetoothProvider implements PowerDataProvider {
  readonly source = "assioma" as const;
  device?: BluetoothDevice;
  private c?: BluetoothRemoteGATTCharacteristic;
  private listener?: EventListener;
  private listenerCharacteristic?: BluetoothRemoteGATTCharacteristic;
  private sampleHandler?: (sample: PowerSample) => void;
  private reconnectTimer?: number;
  private reconnectAttempts = 0;
  private manuallyDisconnected = false;
  private onDiagnostic?: (message: string) => void;
  connected = false;
  battery?: number;
  logs: string[] = [];

  constructor(onDiagnostic?: (message: string) => void) { this.onDiagnostic = onDiagnostic; }
  status() { return this.connected ? "ASSIOMA CONNECTED" : "ASSIOMA NOT CONNECTED"; }
  private log(message: string) {
    const entry = `${new Date().toLocaleTimeString()} ${message}`;
    this.logs = [entry, ...this.logs].slice(0, 500);
    this.onDiagnostic?.(entry);
  }

  private readonly onGattDisconnected = () => {
    this.connected = false;
    this.c = undefined;
    this.log("DISCONNESSO: il pedale ha chiuso la connessione BLE");
    this.scheduleReconnect();
  };

  async connect() {
    if (!navigator.bluetooth) {
      const reason = unsupportedReason();
      this.log(`BLOCCATO: ${reason}`);
      throw Error(reason);
    }
    try {
      this.manuallyDisconnected = false;
      // La finestra di scelta è necessaria soltanto la prima volta. Dopo la
      // scelta, i tentativi usano lo stesso BluetoothDevice senza riscannerare.
      this.log("SCAN: apro tutti i dispositivi BLE; scegli ASSIOMA sinistro/master");
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [CYCLING_POWER_SERVICE_UUID, BATTERY_SERVICE_UUID],
      });
      this.log(`SELEZIONATO: ${this.device.name ?? "senza nome"}`);
      this.device.addEventListener("gattserverdisconnected", this.onGattDisconnected);
      await this.connectToRememberedDevice(false);
    } catch (error) {
      this.log(`ERRORE: ${errorDetail(error)}`);
      throw error;
    }
  }

  private async connectToRememberedDevice(retry: boolean) {
    if (!this.device?.gatt) throw Error("Dispositivo BLE non più disponibile");
    this.log(retry ? "RICONNESSIONE: collegamento all'ultimo Assioma" : "GATT: collegamento al pedale");
    const server = this.device.gatt.connected ? this.device.gatt : await this.device.gatt.connect();
    this.log("GATT: cerco il servizio Cycling Power");
    const service = await server.getPrimaryService(CYCLING_POWER_SERVICE);
    this.log("GATT: cerco la caratteristica Power Measurement");
    this.c = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT);
    try {
      const batteryService = await server.getPrimaryService(BATTERY_SERVICE);
      this.battery = (await (await batteryService.getCharacteristic(BATTERY_LEVEL)).readValue()).getUint8(0);
      this.log(`BATTERIA: ${this.battery}%`);
    } catch (error) { this.log(`BATTERIA: non leggibile (${errorDetail(error)})`); }
    this.log("NOTIFICHE: attivazione dati di potenza");
    await this.c.startNotifications();
    this.connected = true;
    this.reconnectAttempts = 0;
    if (this.sampleHandler) this.attachListener();
    this.log(retry ? "RICONNESSO: Assioma di nuovo attivo" : "CONNESSO: Assioma pronto a inviare watt e cadenza");
  }

  private scheduleReconnect() {
    if (this.manuallyDisconnected || !this.device || this.reconnectTimer) return;
    const delay = Math.min(20000, 1500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.log(`RICONNESSIONE: nuovo tentativo fra ${Math.round(delay / 1000)} s (tentativo ${this.reconnectAttempts})`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.manuallyDisconnected) return;
      void this.connectToRememberedDevice(true)
        .catch((error) => {
          this.connected = false;
          this.c = undefined;
          this.log(`RICONNESSIONE FALLITA: ${errorDetail(error)}`);
          this.scheduleReconnect();
        });
    }, delay);
  }

  start(onSample: (sample: PowerSample) => void) {
    this.sampleHandler = onSample;
    if (!this.c) throw Error("Assioma non connesso");
    this.attachListener();
  }

  private attachListener() {
    if (!this.c || !this.sampleHandler) return;
    this.stop();
    let previous: { rev: number; time: number } | undefined;
    this.listener = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value!;
      try {
        const flags = value.getUint16(0, true), power = value.getInt16(2, true);
        const offset = 4 + (flags & 1 ? 1 : 0) + (flags & 2 ? 2 : 0) + (flags & 4 ? 2 : 0) + (flags & 8 ? 4 : 0);
        let cadenceRpm: number | undefined;
        if (flags & 16 && value.byteLength >= offset + 4) {
          const rev = value.getUint16(offset, true), time = value.getUint16(offset + 2, true);
          if (previous) {
            const deltaRevs = (rev - previous.rev + 65536) % 65536, deltaTime = (time - previous.time + 65536) % 65536;
            if (deltaTime) cadenceRpm = deltaRevs * 60 * 1024 / deltaTime;
          }
          previous = { rev, time };
        }
        this.sampleHandler?.({ timestamp: performance.now(), powerWatts: power, cadenceRpm });
        this.log(`${power} W ${cadenceRpm ? `${Math.round(cadenceRpm)} rpm` : ""}`);
      } catch (error) { this.log(`ERRORE PACCHETTO: ${errorDetail(error)}`); }
    };
    this.c.addEventListener("characteristicvaluechanged", this.listener);
    this.listenerCharacteristic = this.c;
  }

  stop() {
    if (this.listener && this.listenerCharacteristic) this.listenerCharacteristic.removeEventListener("characteristicvaluechanged", this.listener);
    this.listener = undefined;
    this.listenerCharacteristic = undefined;
  }
  async disconnect() {
    this.manuallyDisconnected = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stop();
    this.sampleHandler = undefined;
    this.device?.gatt?.disconnect();
    this.connected = false;
    this.log("DISCONNESSO MANUALMENTE");
  }
}
