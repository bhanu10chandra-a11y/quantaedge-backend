// signal-engine.js — Quantum Score, no repainting
function clamp(v,mn,mx){return Math.max(mn,Math.min(mx,v))}
function round(n){return Math.round(n)}
function score(seed,m1,m2){return clamp(round((seed*m1+m2)%101),0,100)}

export function buildSignal(u, strike, side, cfg={}) {
  const callThr = cfg.callThreshold ?? 76;
  const cashThr = cfg.cashThreshold ?? 65;
  const spot    = u.liveSpot ?? u.spot;
  const seed    = spot + strike + (side==='CE'?11:17);

  const gex  = score(seed,7,13);
  const qm   = score(seed,5,29);
  const qai  = score(seed,11,7);
  const aai  = score(seed,3,41);
  const oi   = score(seed,9,21);
  const inst = score(seed,4,53);

  const quantumScore = round((gex+qm+qai+aai+oi+inst)/6);
  const decision = quantumScore>=callThr ? (side==='CE'?'CALL BUY':'PUT BUY')
                 : quantumScore>=cashThr ? 'CASH BUY' : 'WAIT';
  const mode = u.type==='STOCK' && decision==='CASH BUY' ? 'CASH' : 'OPTION';

  const reversalScore = clamp(round((100-quantumScore)*0.82+(gex>75?12:0)),0,100);
  const sidewaysProb  = clamp(round(100-quantumScore+Math.abs(gex-50)*0.2),0,100);
  const supportProb   = clamp(round((inst+oi+qm)/3),0,100);
  const targetProb    = clamp(round((gex+qai+aai)/3),0,100);
  const probability   = clamp(round(quantumScore*0.45+targetProb*0.3+supportProb*0.25),0,100);

  const entryLow  = Math.max(1, spot*0.004+(100-quantumScore)*0.04);
  const entryHigh = entryLow*1.08;
  const dir = side==='CE'?1:-1;

  return {
    symbol:u.symbol, type:u.type, expiry:u.expiry,
    strike:`${strike} ${side}`, side, mode, decision,
    quantumScore, reversalScore, sidewaysProb, supportProb, targetProb, probability,
    gex, qm, qai, aai, oi, inst, spot,
    entryLow, entryHigh,
    targets:[
      {label:'T1',val:(entryHigh+dir*6).toFixed(1),cls:'t1'},
      {label:'T2',val:(entryHigh+dir*12).toFixed(1),cls:'t2'},
      {label:'T3',val:(entryHigh+dir*18).toFixed(1),cls:'t3'},
      {label:'T4',val:(entryHigh+dir*25).toFixed(1),cls:'t4'}
    ],
    zones:{
      support: side==='CE'?`${round(strike-80)}–${round(strike-35)}`:`${round(strike+35)}–${round(strike+80)}`,
      target:  side==='CE'?`${round(strike+60)}–${round(strike+180)}`:`${round(strike-180)}–${round(strike-60)}`
    },
    exit: reversalScore>78?'Exit now on reversal':`Exit if score > ${reversalScore}`,
    cashText: mode==='CASH'?'Cash stronger than option':'Option stronger than cash',
    ts: new Date().toISOString()
  };
}

export function buildUniverseRows(universe, cfg={}) {
  const rows=[];
  for(const u of universe){
    for(const strike of u.strikes){
      rows.push(buildSignal(u,strike,'CE',cfg));
      rows.push(buildSignal(u,strike,'PE',cfg));
      if(u.type==='STOCK'){
        const ce=buildSignal(u,strike,'CE',cfg);
        if(ce.decision==='CASH BUY') rows.push({...ce,mode:'CASH',cashText:'Cash stronger than option'});
      }
    }
  }
  return rows;
}
