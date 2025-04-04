const { autoUpdater } = require('electron-updater');
const { app, ipcMain, BrowserWindow } = require('electron');
const log = require('electron-log');

class UpdateManager {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.setupLogging();
        this.configureAutoUpdater();
        this.setupEventHandlers();
        this.setupIpcHandlers();
    }

    setupLogging() {
        log.transports.file.level = 'debug';
        autoUpdater.logger = log;
    }

    configureAutoUpdater() {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.allowDowngrade = false;
    }

    setupEventHandlers() {
        autoUpdater.on('checking-for-update', () => {
            this.sendStatusToWindow('update-status', 'Checking for updates...');
        });

        autoUpdater.on('update-available', (info) => {
            log.info('Update available:', info);
            this.sendStatusToWindow('update-available', info);
            // Removed disableMainWindow call
        });

        autoUpdater.on('update-not-available', () => {
            log.info('Update not available');
            this.sendStatusToWindow('update-not-available');
            // Removed enableMainWindow call
        });

        autoUpdater.on('error', (err) => {
            log.error('Update error:', err);
            this.sendStatusToWindow('update-error', err.toString());
            // Removed enableMainWindow call
        });

        autoUpdater.on('download-progress', (progressObj) => {
            log.info('Download progress:', progressObj);
            this.sendStatusToWindow('download-progress', {
                percent: progressObj.percent,
                transferred: progressObj.transferred,
                total: progressObj.total,
                bytesPerSecond: progressObj.bytesPerSecond
            });
        });

        autoUpdater.on('update-downloaded', () => {
            log.info('Update downloaded');
            this.sendStatusToWindow('update-downloaded');
        });
    }

    setupIpcHandlers() {
        ipcMain.on('check-for-update', () => {
            autoUpdater.checkForUpdates();
        });

        ipcMain.handle('install-update', async () => {
            try {
                log.info('Installing update...');
                autoUpdater.quitAndInstall(false, true);
                return true;
            } catch (error) {
                log.error('Error installing update:', error);
                throw error;
            }
        });

        ipcMain.handle('close-app', async () => {
            try {
                log.info('Closing app...');
                app.quit();
                return true;
            } catch (error) {
                log.error('Error closing app:', error);
                throw error;
            }
        });
    }

    sendStatusToWindow(channel, data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, data);
        }
    }

    checkForUpdates() {
        autoUpdater.checkForUpdates().catch(err => {
            log.error('Error checking for updates:', err);
            this.sendStatusToWindow('update-error', err.toString());
        });
    }
}

module.exports = UpdateManager;