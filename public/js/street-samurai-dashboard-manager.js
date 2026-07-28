import { gmcp } from './gmcp.js';
import {
  STREET_SAMURAI_PACKAGE,
  streetSamuraiDashboardView,
} from './street-samurai-dashboard.js';

export const streetSamuraiDashboardManager = {
  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    gmcp.on(STREET_SAMURAI_PACKAGE, (payload) => {
      streetSamuraiDashboardView.update(payload);
    });
  },

  getSnapshot() {
    return streetSamuraiDashboardView.getSnapshot();
  },
};
