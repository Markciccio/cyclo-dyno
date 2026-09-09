import type { ChallengeId, DynoSession, Metrics, SessionSample } from '../types'
const duration=(s:SessionSample[])=>s.length?s.at(-1)!.elapsedMs-s[0].elapsedMs:0
function weighted(s:SessionSample[],start:number,end:number){let total=0,ms=0;for(let i=0;i<s.length;i++){const a=Math.max(start,s[i].elapsedMs),b=Math.min(end,i+1<s.length?s[i+1].elapsedMs:end);if(b>a){total+=s[i].powerWatts*(b-a);ms+=b-a}}return ms?total/ms:null}
export const averagePower=(s:SessionSample[])=>weighted(s,0,duration(s))??(s[0]?.powerWatts??0)
export function bestWindow(s:SessionSample[],seconds:number){if(!s.length)return null;const total=duration(s),win=Math.min(seconds*1000,total);if(win<=0)return s[0].powerWatts;let best=0;for(const x of s){const v=weighted(s,x.elapsedMs,Math.min(total,x.elapsedMs+win));if(v!==null)best=Math.max(best,v)}return best}
export function thresholdTimes(s:SessionSample[],ts:number[]){const r:Record<number,number>={};for(const t of ts){let ms=0;for(let i=0;i<s.length-1;i++)if(s[i].powerWatts>t)ms+=s[i+1].elapsedMs-s[i].elapsedMs;r[t]=ms/1000}return r}
export function calculateMetrics(s:SessionSample[],ts:number[]):Metrics{const last=duration(s),best5s=bestWindow(s,5),last5=weighted(s,Math.max(0,last-5000),last),c=s.map(x=>x.cadenceRpm).filter((x):x is number=>x!==undefined);return{peakPower:Math.max(0,...s.map(x=>x.powerWatts)),best1s:bestWindow(s,1),best5s,best10s:bestWindow(s,10),averagePower:averagePower(s),maxVirtualSpeed:Math.max(0,...s.map(x=>x.virtualSpeedKmh)),averageCadence:c.length?c.reduce((a,b)=>a+b,0)/c.length:null,maxCadence:c.length?Math.max(...c):null,powerDrop:best5s&&last5!==null?(last5-best5s)/best5s*100:null,thresholdTimes:thresholdTimes(s,ts)}}
export const leaderboardSort=<T extends {best5s:number|null;timestamp:number}>(items:T[])=>[...items].sort((a,b)=>(b.best5s??-Infinity)-(a.best5s??-Infinity)||b.timestamp-a.timestamp)

/** Tempo sul giro in m:ss,d, per le prove a distanza fissa. */
export function formatLapTime(seconds:number){const m=Math.floor(seconds/60);const r=seconds-m*60;return `${m}:${r<10?'0':''}${r.toFixed(1)}`}

/**
 * Classifica di una singola sfida. Sul dyno vince chi spinge di piu, sulle prove
 * a percorso vince chi ci mette meno: confrontarle tra loro non avrebbe senso,
 * perche uno sprint da 30 s batte sempre una salita da 40 minuti sui best 5 s.
 */
export function rankFor(sessions:DynoSession[],challenge:ChallengeId){
  const scoped=sessions.filter(x=>(x.challenge??'dyno')===challenge)
  if(challenge==='dyno')return leaderboardSort(scoped)
  // Su un anello vince il miglior giro, su un punto-a-punto il tempo totale.
  const score=(x:DynoSession)=>x.bestLapSeconds??x.elapsedSeconds??Infinity
  return [...scoped].sort((a,b)=>
    Number(!!b.completed)-Number(!!a.completed)||
    score(a)-score(b)||
    b.timestamp-a.timestamp)
}
