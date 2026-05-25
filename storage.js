export function memoryStore() {
  const state = { latest: null, alerts: [], ticks: {} };
  return {
    setLatest(payload) {
      state.latest = payload;
    },
    getLatest() {
      return state.latest;
    },
    pushAlert(a) {
      state.alerts.unshift(a);
      state.alerts = state.alerts.slice(0, 50);
    },
    getAlerts() {
      return state.alerts;
    },
    setTick(tick) {
      state.ticks[tick.symbol] = tick;
    },
    getTicks() {
      return state.ticks;
    }
  };
}
