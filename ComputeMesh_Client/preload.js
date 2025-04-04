const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Existing APIs you had
    requestServerPort: () => ipcRenderer.send('request-server-port'),
    onServerPort: (callback) => ipcRenderer.on('server-port', (event, data) => callback(data)),
    onServerStarted: (callback) => ipcRenderer.on('server-started', (event, data) => callback(data)),
    onServerExited: (callback) => ipcRenderer.on('server-exited', (event, data) => callback(data)),
    onServerHealth: (callback) => ipcRenderer.on('server-health', (event, data) => callback(data)),
    onServerStatus: (callback) => ipcRenderer.on('server-status', (event, status) => callback(status)),
    onLogMessage: (callback) => ipcRenderer.on('log-message', (event, message) => callback(message)),
    forwardRequest: (data) => ipcRenderer.invoke('forward-request', data),
    onForceDisconnect: (callback) => ipcRenderer.on('force-disconnect', (event) => callback()),
    getMachineId: () => ipcRenderer.invoke('get-machine-id'),

    // Update-specific APIs
    checkForUpdate: () => ipcRenderer.send('check-for-update'),
    onUpdateAvailable: (callback) => {
        const subscription = (event, info) => callback(info);
        ipcRenderer.on('update-available', subscription);
        return () => ipcRenderer.removeListener('update-available', subscription);
    },
    onUpdateNotAvailable: (callback) => {
        const subscription = (event) => callback();
        ipcRenderer.on('update-not-available', subscription);
        return () => ipcRenderer.removeListener('update-not-available', subscription);
    },
    onUpdateError: (callback) => {
        const subscription = (event, error) => callback(error);
        ipcRenderer.on('update-error', subscription);
        return () => ipcRenderer.removeListener('update-error', subscription);
    },
    onDownloadProgress: (callback) => {
        const subscription = (event, progress) => callback(progress);
        ipcRenderer.on('download-progress', subscription);
        return () => ipcRenderer.removeListener('download-progress', subscription);
    },
    onUpdateDownloaded: (callback) => {
        const subscription = (event) => callback();
        ipcRenderer.on('update-downloaded', subscription);
        return () => ipcRenderer.removeListener('update-downloaded', subscription);
    },
    onUpdateStatus: (callback) => {
        const subscription = (event, status) => callback(status);
        ipcRenderer.on('update-status', subscription);
        return () => ipcRenderer.removeListener('update-status', subscription);
    },
    installUpdate: () => {
        console.log('Sending install-update command');
        return ipcRenderer.invoke('install-update'); // Change to invoke
    },
    closeApp: () => {
        console.log('Sending close-app command');
        return ipcRenderer.invoke('close-app'); // Change to invoke
    }
});