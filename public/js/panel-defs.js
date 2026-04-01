export const PANEL_DEFS = {
  status:    { title: 'Status',    defaultDock: 'left',  defaultOrder: 0 },
  vitals:    { title: 'Vitals',    defaultDock: 'left',  defaultOrder: 1 },
  worth:     { title: 'Worth',     defaultDock: 'left',  defaultOrder: 2 },
  stats:     { title: 'Stats',     defaultDock: 'left',  defaultOrder: 3 },
  room:      { title: 'Room',      defaultDock: 'right', defaultOrder: 0 },
  group:     { title: 'Group',     defaultDock: 'right', defaultOrder: 1 },
  inventory: { title: 'Inventory', defaultDock: 'right', defaultOrder: 2 },
  enemy:     { title: 'Enemy',     defaultDock: 'float', defaultOrder: 0,
               defaultFloatX: -490, defaultFloatY: 50, defaultFloatW: 480, defaultFloatH: 225,
               defaultSnapRight: true, defaultSnapTop: true },
  chat:      { title: 'Chat',      defaultDock: 'float', defaultOrder: 0,
               defaultFloatX: -760, defaultFloatY: -380, defaultFloatW: 750, defaultFloatH: 370,
               defaultSnapRight: true, defaultSnapBottom: true },
  map:       { title: 'Map',       defaultDock: 'float', defaultOrder: 0,
               defaultFloatX: -500, defaultFloatY: 50, defaultFloatW: 400, defaultFloatH: 350,
               defaultSnapRight: true, defaultSnapTop: true },
};

export const PANEL_STORAGE_KEY = 'darkwind-panel-state';
