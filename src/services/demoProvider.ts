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
      const base=t<3?700*t/3:t<8?760:t<20?710:t<30?710-(t-20)*21:500-(t-30)*7
      return Math.max(0,base+(Math.random()-.5)*70+Math.sin(t*2.7)*28)
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
