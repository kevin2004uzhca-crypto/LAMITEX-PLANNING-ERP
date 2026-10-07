// Pronóstico de la demanda por código SAP. Métodos estadísticos clásicos (guía: Hyndman y Athanasopoulos,
// "Forecasting: Principles and Practice", y la librería abierta Nixtla/statsforecast, que usa los mismos métodos).
// Con menos de 3 meses de historia se usa la demanda vigente con una variación (±10 % por defecto) para los escenarios.

export type Observation={period:string;quantity:number}; // period = 'AAAA-MM'
export type Method='DEMANDA_VIGENTE'|'PROMEDIO_MOVIL'|'SUAVIZACION_SIMPLE'|'HOLT';
export type Forecast={method:Method;point:number;low:number;high:number;error:number|null;alpha?:number;beta?:number;observations:number};

const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/(xs.length||1);

/** Suavización exponencial simple: nivel_t = α·y_t + (1−α)·nivel_{t−1}. Devuelve pronósticos un paso adelante. */
export function ses(y:number[],alpha:number){const fit:number[]=[];let level=y[0];for(const v of y){fit.push(level);level=alpha*v+(1-alpha)*level;}return {fit,next:level};}
/** Holt (tendencia lineal): nivel y pendiente se actualizan con α y β. */
export function holt(y:number[],alpha:number,beta:number){const fit:number[]=[];let level=y[0],trend=y.length>1?y[1]-y[0]:0;
 for(const v of y){fit.push(level+trend);const prev=level;level=alpha*v+(1-alpha)*(level+trend);trend=beta*(level-prev)+(1-beta)*trend;}return {fit,next:Math.max(0,level+trend)};}
export function movingAverage(y:number[],n=3){const fit=y.map((_,i)=>i===0?y[0]:mean(y.slice(Math.max(0,i-n),i)));return {fit,next:mean(y.slice(-n))};}
/** Error absoluto medio de los pronósticos un paso adelante (sin contar el primer punto). */
const mae=(y:number[],fit:number[])=>mean(y.slice(1).map((v,i)=>Math.abs(v-fit[i+1])));
const sd=(y:number[],fit:number[])=>{const e=y.slice(1).map((v,i)=>v-fit[i+1]);const m=mean(e);return Math.sqrt(mean(e.map(x=>(x-m)**2)));};

/**
 * Elige el método con menor error un paso adelante. Intervalo del escenario: ±z·σ de los errores (z=1,28 ≈ percentiles 10 y 90)
 * o, con poca historia, ±variación de la demanda vigente.
 */
export function forecastSeries(history:Observation[],current:number,variationPct=10,z=1.2816):Forecast{
 const y=[...history].sort((a,b)=>a.period.localeCompare(b.period)).map(o=>Number(o.quantity));const v=variationPct/100;
 if(y.length<3){const point=y.length?y[y.length-1]:current;return {method:'DEMANDA_VIGENTE',point,low:point*(1-v),high:point*(1+v),error:null,observations:y.length};}
 const cands:{method:Method;fit:number[];next:number;alpha?:number;beta?:number}[]=[{method:'PROMEDIO_MOVIL',...movingAverage(y,3)}];
 for(let a=0.1;a<=0.91;a+=0.1)cands.push({method:'SUAVIZACION_SIMPLE',...ses(y,a),alpha:Math.round(a*10)/10});
 if(y.length>=4)for(let a=0.1;a<=0.91;a+=0.2)for(let b=0.1;b<=0.51;b+=0.2)cands.push({method:'HOLT',...holt(y,a,b),alpha:Math.round(a*10)/10,beta:Math.round(b*10)/10});
 const best=cands.map(c=>({...c,error:mae(y,c.fit)})).sort((a,b)=>a.error-b.error)[0];
 const s=Math.max(sd(y,best.fit),best.next*v*0.5);
 return {method:best.method,point:best.next,low:Math.max(0,best.next-z*s),high:best.next+z*s,error:best.error,alpha:best.alpha,beta:best.beta,observations:y.length};
}

/** Pronóstico de todos los códigos de la demanda. */
export function forecastAll(items:{material_code:string;monthly_demand:number;active:boolean}[],obs:{material_code:string;period:string;quantity:number}[],variationPct=10){
 const by=new Map<string,Observation[]>();for(const o of obs){const l=by.get(o.material_code)??[];l.push({period:o.period,quantity:Number(o.quantity)});by.set(o.material_code,l);}
 return new Map(items.filter(i=>i.active).map(i=>[i.material_code,forecastSeries(by.get(i.material_code)??[],Number(i.monthly_demand),variationPct)]));
}

/** Generador pseudoaleatorio reproducible (para que la simulación Monte Carlo de el mismo resultado con la misma semilla). */
export function rng(seed:number){let s=seed>>>0||1;return ()=>{s^=s<<13;s>>>=0;s^=s>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
