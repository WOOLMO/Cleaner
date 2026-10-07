// The only bridge between the window and the engine: a fixed list of calls, no Node.js access.
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (fn) => {
  const handler = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

const windowApi = {
  capture: process.argv.includes("--cleaner-capture"),
  setTitleBar: (colors) => ipcRenderer.send("window:titlebar", colors),
  onNavigate: listen("capture:navigate"),
};

// Demo mode (screenshots, try-outs) runs on built-in sample data and touches nothing.
if (process.argv.includes("--cleaner-demo")) {
  contextBridge.exposeInMainWorld("cleanerWindow", { ...windowApi, demo: true });
} else {
  contextBridge.exposeInMainWorld("cleanerWindow", { ...windowApi, demo: false });
  contextBridge.exposeInMainWorld("cleaner", {
    info: invoke("app:info"),
    drives: invoke("system:drives"),
    pickFolders: invoke("system:pickFolders"),
    reveal: invoke("system:reveal"),
    openExternal: invoke("system:openExternal"),
    openPath: invoke("system:openPath"),
    getSettings: invoke("settings:get"),
    setSettings: invoke("settings:set"),
    setKey: invoke("key:set"),
    clearKey: invoke("key:clear"),
    lastScan: invoke("scan:last"),
    startScan: invoke("scan:start"),
    cancelScan: invoke("scan:cancel"),
    onScanEvent: listen("scan:event"),
    act: invoke("items:act"),
    onActProgress: listen("items:progress"),
    exportScript: invoke("items:script"),
    exportReport: invoke("report:export"),
    lastMap: invoke("map:last"),
    startMap: invoke("map:start"),
    cancelMap: invoke("map:cancel"),
    onMapEvent: listen("map:event"),
    onMapExplained: listen("map:explained"),
    mapChildren: invoke("map:children"),
    listHeld: invoke("hold:list"),
    restoreHeld: invoke("hold:restore"),
    purgeHeld: invoke("hold:purge"),
    listActivity: invoke("audit:list"),
    exportActivity: invoke("audit:export"),
    organizePlaces: invoke("organize:places"),
    pickFolder: invoke("system:pickFolder"),
    planOrganize: invoke("organize:plan"),
    applyOrganize: invoke("organize:apply"),
    organizeHistory: invoke("organize:history"),
    undoOrganize: invoke("organize:undo"),
    graphLoad: invoke("graph:load"),
    graphExpand: invoke("graph:expand"),
    graphNetwork: invoke("graph:network"),
    graphNetworkCancel: invoke("graph:networkCancel"),
    onNetworkEvent: listen("graph:networkEvent"),
    protectStatus: invoke("protect:status"),
    lastThreatScan: invoke("protect:last"),
    startThreatScan: invoke("protect:start"),
    cancelThreatScan: invoke("protect:cancel"),
    onThreatEvent: listen("protect:event"),
    quarantineItems: invoke("protect:quarantine"),
    trustItem: invoke("protect:trust"),
    lookupItem: invoke("protect:lookup"),
    listQuarantine: invoke("quarantine:list"),
    restoreQuarantine: invoke("quarantine:restore"),
    deleteQuarantine: invoke("quarantine:delete"),
    setServiceKey: invoke("keys:set"),
    updateIntel: invoke("protect:intelUpdate"),
    setupYara: invoke("protect:yara"),
    onSetupEvent: listen("protect:setupEvent"),
    endProcess: invoke("protect:endProcess"),
    watchEvents: invoke("protect:watchEvents"),
    onWatchEvent: listen("protect:watchEvent"),
    watchQuarantine: invoke("protect:watchQuarantine"),
    watchDismiss: invoke("protect:watchDismiss"),
    clearServiceKey: invoke("keys:clear"),
  });
}
