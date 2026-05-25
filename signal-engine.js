function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round(n) {
  return Math.round(n);
}

function score(seed, m1, m2) {
  return clamp(round((seed * m1 + m2) % 101), 0, 100);
}

export function buildSignal(u, strike, side) {
  const seed = u.spot + strike + (side === 'CE' ? 11 : 17);
  const gex = score(seed, 7, 13);
  const quantumMath = score(seed, 5, 29);
  const quantumAi = score(seed, 11, 7);
  const agenticAi = score(seed, 3, 41);
  const oiSentiment = score(seed, 9, 21);
  const institutionalInterest = score(seed, 4, 53);
  const quantumScore = round((gex + quantumMath + quantumAi + agenticAi + oiSentiment + institutionalInterest) / 6);
  const decision = quantumScore >= 76 ? (side === 'CE' ? 'CALL BUY' : 'PUT BUY') : quantumScore >= 65 ? 'CASH BUY' : 'WAIT';
  const mode = u.type === 'STOCK' && decision === 'CASH BUY' ? 'CASH' : 'OPTION';
  const reversalScore = clamp(round((100 - quantumScore) * 0.82 + (gex > 75 ? 12 : 0)), 0, 100);
  const sidewaysProb = clamp(round(100 - quantumScore + Math.abs(gex - 50) * 0.2), 0, 100);
  const supportProb = clamp(round((institutionalInterest + oiSentiment + quantumMath) / 3), 0, 100);
  const targetProb = clamp(round((gex + quantumAi + agenticAi) / 3), 0, 100);
  const probability = clamp(round(quantumScore * 0.45 + targetProb * 0.3 + supportProb * 0.25), 0, 100);
  const entryLow = Math.max(1, (u.spot * 0.004 + (100 - quantumScore) * 0.04));
  const entryHigh = entryLow * 1.08;
  const dir = side === 'CE' ? 1 : -1;
  const targets = [
    `T1 ₹${(entryHigh + dir * 6).toFixed(1)}`,
    `T2 ₹${(entryHigh + dir * 12).toFixed(1)}`,
    `T3 ₹${(entryHigh + dir * 18).toFixed(1)}`,
    `T4 ₹${(entryHigh + dir * 25).toFixed(1)}`
  ];
  const zones = {
    support: side === 'CE' ? `${round(strike - 80)}-${round(strike - 35)}` : `${round(strike + 35)}-${round(strike + 80)}`,
    target: side === 'CE' ? `${round(strike + 60)}-${round(strike + 180)}` : `${round(strike - 180)}-${round(strike - 60)}`
  };

  return {
    symbol: u.symbol,
    type: u.type,
    expiry: u.expiry,
    strike: `${strike} ${side}`,
    side,
    mode,
    decision,
    quantumScore,
    reversalScore,
    sidewaysProb,
    supportProb,
    targetProb,
    probability,
    gex,
    quantumMath,
    quantumAi,
    agenticAi,
    oiSentiment,
    institutionalInterest,
    entry: `₹${entryLow.toFixed(1)} - ₹${entryHigh.toFixed(1)}`,
    targets,
    zones,
    exit: reversalScore > 78 ? 'Exit now on reversal' : `Exit if score > ${reversalScore}`,
    cashText: mode === 'CASH' ? 'Cash stronger than option' : 'Option stronger than cash'
  };
}
