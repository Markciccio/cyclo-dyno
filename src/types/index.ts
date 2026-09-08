export type DataSource = 'demo' | 'assioma'
export type VehicleProfile = 'road' | 'trike' | 'recumbent' | 'velomobile'
export type ChallengeId = 'dyno' | 'monza' | 'velodrome'
export interface PowerSample { timestamp: number; powerWatts: number; cadenceRpm?: number }
export interface SessionSample extends PowerSample { elapsedMs: number; virtualSpeedKmh: number; distanceKm?: number }
export interface Metrics { peakPower:number; best1s:number|null; best5s:number|null; best10s:number|null; averagePower:number; maxVirtualSpeed:number; averageCadence:number|null; maxCadence:number|null; powerDrop:number|null; thresholdTimes:Record<number,number> }
export interface DynoSession extends Metrics { id:string; participantName:string; timestamp:number; sessionDuration:number; samples:SessionSample[]; dataSource:DataSource; validSession:boolean; quality:'VALID'|'INVALID'|'DEMO' }
export interface Settings { eventName:string; defaultDuration:number; thresholds:number[]; referenceWatts:number; referenceKmh:number; audio:boolean }
export interface PowerDataProvider { readonly source:DataSource; connect?():Promise<void>; disconnect?():Promise<void>; start(onSample:(sample:PowerSample)=>void):void; stop():void; status():string }
