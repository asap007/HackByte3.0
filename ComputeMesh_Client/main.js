const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs'); // Required for checking file existence
const { machineIdSync } = require('node-machine-id');
const UpdateHandler = require('./updater');

let mainWindow;
let serverProcess = null;
let isCleaningUp = false;
let isQuitting = false;

const SERVER_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'win', 'ComputeMesh_main.exe')
    : path.join(__dirname, 'win', 'ComputeMesh_main.exe');

// Simple logging
function log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log-message', { level, message: `${timestamp} - ${message}` });
    }
}

async function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;

    try {
        log('Starting cleanup process');

        if (serverProcess) {
            serverProcess.kill('SIGTERM'); // Attempt graceful shutdown
            serverProcess = null;
        }

        log('Cleanup process completed');
    } catch (err) {
        log(`Cleanup error: ${err.message}`, 'error');
    } finally {
        isCleaningUp = false;
    }
}

function launchServer() {
    try {
        log('Starting server launch');

        if (!fs.existsSync(SERVER_PATH)) {
            throw new Error(`Server executable not found at ${SERVER_PATH}`);
        }

        serverProcess = spawn(SERVER_PATH, [], {
            stdio: 'pipe', // Capture output for logging
            detached: false,
            windowsHide: true // Hide the console window
        });

        serverProcess.stdout.on('data', (data) => {
            log(`Server stdout: ${data.toString().trim()}`, 'debug');
        });

        serverProcess.stderr.on('data', (data) => {
            log(`Server stderr: ${data.toString().trim()}`, 'error');
        });

        serverProcess.on('close', (code) => {
            log(`Server process exited with code ${code}`, 'warn');
        });

        serverProcess.on('error', (error) => {
            log(`Server process error: ${error.message}`, 'error');
        });

        log(`Server successfully started`);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('server-started', {}); // No port to send
        }

    } catch (error) {
        log(`Server launch failed: ${error.message}`, 'error');
        // Handle the error gracefully, e.g., show a message to the user
        console.error(`Failed to start server: ${error.message}`); // Debugging
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 1280,
        minHeight: 820,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false,
        frame: true,
        autoHideMenuBar: true
    });

    // Remove the application menu completely
    mainWindow.removeMenu();

    const startUrl = path.join(__dirname, 'frontend', 'out', 'index.html');
    mainWindow.loadFile(startUrl);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
      })

     // Initialize updater after window creation
     const updateHandler = new UpdateHandler(mainWindow);
    
     // Check for updates immediately
     updateHandler.checkForUpdates();
     
     // Check for updates every 4 hours
     setInterval(() => {
         updateHandler.checkForUpdates();
     }, 4 * 60 * 60 * 1000);

    mainWindow.on('close', async (e) => {
        if (!isQuitting) {
            e.preventDefault();
            isQuitting = true;
            try {
                await cleanup();
                if (!mainWindow.isDestroyed()) {
                    mainWindow.close();
                }
            } catch (error) {
                console.error('Error during window cleanup:', error);
                app.exit(0); // Force exit on error
            }
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

ipcMain.handle('get-machine-id', () => {
  return machineIdSync();
});

ipcMain.on('request-server-port', (event) => {
    event.reply('server-port', {});
});

ipcMain.handle('forward-request', async (event, { method, url, data }) => {
    try {
        const response = await axios.request({
            method: method.toUpperCase(),
            url,
            headers: { 'Content-Type': 'application/json' },
            data,
            timeout: 10000
        });
        return { success: true, data: response.data };
    } catch (error) {
        return {
            success: false,
            error: JSON.stringify({
                code: error.code || 'UNKNOWN',
                message: error.message,
                response: error.response?.data
            }),
            isConnectionRefused: error.code === 'ECONNREFUSED'
        };
    }
});


async function initializeApp() {
    // Remove the menu bar completely for all windows
    Menu.setApplicationMenu(null);

    try {
        if (!fs.existsSync(SERVER_PATH)) {
            throw new Error('Server executable not found in root directory');
        }

        launchServer(); // Launch the server only once

        createWindow();
    } catch (err) {
       console.error(err.message); // Debugging
    }
}

app.whenReady().then(initializeApp);

app.on('before-quit', async () => {
    isQuitting = true;
    await cleanup();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

process.on('SIGINT', async () => {
    isQuitting = true;
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    isQuitting = true;
    await cleanup();
    process.exit(0);
});