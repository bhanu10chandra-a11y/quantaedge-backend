// storage.js — in-memory store
export function memoryStore() {
  let latest = null, alerts = [], feedMode = 'simulated';
  let dhanCreds = { clientId:'', accessToken:'' };
  return {
    setLatest(p)      { latest = p; },
    getLatest()       { return latest; },
    pushAlert(a)      { alerts.unshift(a); alerts = alerts.slice(0, 100); },
    getAlerts()       { return alerts; },
    setDhanCreds(c)   { dhanCreds = { ...dhanCreds, ...c }; },
    getDhanCreds()    { return dhanCreds; },
    hasCreds()        { return !!(dhanCreds.clientId && dhanCreds.accessToken); },
    setFeedMode(m)    { feedMode = m; },
    getFeedMode()     { return feedMode; }
  };
}
