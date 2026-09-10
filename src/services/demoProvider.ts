import type {ChallengeId,PowerDataProvider,PowerSample} from '../types'

export class DemoPowerProvider implements PowerDataProvider {
  readonly source='demo' as const
  private timer?:number
  private startAt=0
  private scenario:ChallengeId
  constructor(scenario:ChallengeId='dyno'){this.scenario=scenario}
  setScenario(scenario:ChallengeId){this.scenario=scenario}
  status(){return'DEMO READY'}
  private watts(t:number){
    if(this.scenario==='dyno'){
      // Una prova credibile: riscaldamento, picco vero dopo 20 s, cedimento,
      // rilancio e recupero. Il rumore e le micro-oscillazioni la rendono meno
      // meccanica, come una pedalata reale e non come una curva pre-registrata.
      const base =
        t < 7 ? 90 + t * 15 :                    // sciogli le gambe
        t < 14 ? 190 + (t - 7) * 18 :             // entra nel ritmo
        t < 20 ? 315 + (t - 14) * 27 :            // preparazione allo sprint
        t < 23.5 ? 825 + Math.sin(t * 5) * 48 :   // attacco: fuori scala
        t < 28 ? 610 - (t - 23.5) * 35 :          // primo calo
        t < 32 ? 515 + (t - 28) * 62 :            // secondo rilancio
        t < 37 ? 655 - (t - 32) * 58 :            // molla dopo il rilancio
        t < 43 ? 300 + Math.sin(t * 2.4) * 75 :   // recupero instabile
        t < 47 ? 470 + (t - 43) * 48 :            // ultimo colpo breve
        t < 53 ? 560 - (t - 47) * 55 :            // svuota le gambe
        Math.max(0, 150 - (t - 53) * 18);         // defaticamento
      const randomKick = (Math.random() - .5) * (t > 20 && t < 47 ? 110 : 45);
      const pedalStroke = Math.sin(t * 2.7) * (t > 20 ? 42 : 20);
      return Math.max(0,Math.round(base + randomKick + pedalStroke))
    }
    const phase=t%60
    if(this.scenario==='monza'){
      if(t<10)return 400+(Math.random()-.5)*20
      if(phase>53)return 0 // brevi tratti senza pedalare
      return 280+Math.sin(t*.6)*42+(Math.random()-.5)*22 // 200–300 W, media giro ~250 W
    }
    if(this.scenario==='mottarone'){
      // In salita non si smette di pedalare: potenza continua con deriva da fatica.
      if(t<8)return 300+(Math.random()-.5)*18
      return Math.max(150,270-t*.045)+Math.sin(t*.42)*22+(Math.random()-.5)*16
    }
    if(this.scenario==='velodrome'){
      // Anello corto: rilanci in rettilineo, un filo di respiro in curva.
      return 300+Math.sin(t*.9)*70+(Math.random()-.5)*24
    }
    return 255+Math.sin(t*.8)*32+(Math.random()-.5)*20
  }
  start(on:(s:PowerSample)=>void){
    this.startAt=performance.now()
    this.timer=window.setInterval(()=>{
      const t=(performance.now()-this.startAt)/1000,p=Math.round(this.watts(t))
      on({timestamp:performance.now(),powerWatts:p,cadenceRpm:Math.round(Math.max(0,68+p*.065+Math.sin(t)*6))})
    },250)
  }
  stop(){if(this.timer)clearInterval(this.timer)}
}
