import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Storage } from './library/storage.js';
import { setupIpc } from './ipc.js';
import { EmulatorDownloader } from './emulators/downloader.js';
import { SwitchKeyManager } from './emulators/switchKeys.js';

let mainWindow: BrowserWindow | null = null;
let installerWindow: BrowserWindow | null = null;
const storage = new Storage();

function getAppIconPath(): string {
  const ico = path.join(__dirname, '../../build/icon.ico');
  const png = path.join(__dirname, '../../build/icon.png');
  const assetPng = path.join(__dirname, '../renderer/assets/logo.png');
  if (process.platform === 'win32' && fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return assetPng;
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: isMac ? true : false,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    backgroundColor: '#120F1D',
    icon: getAppIconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupIpc(mainWindow, storage);

  const indexPath = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:state-changed', { maximized: true });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:state-changed', { maximized: false });
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:state-changed', { maximized: true });
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:state-changed', { maximized: mainWindow?.isMaximized() || false });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createInstallerWindow() {
  const isMac = process.platform === 'darwin';

  installerWindow = new BrowserWindow({
    width: 740,
    height: 520,
    resizable: false,
    maximizable: false,
    frame: isMac ? true : false,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    backgroundColor: '#0D0A16',
    icon: getAppIconPath(),
    center: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupIpc(installerWindow, storage, () => {
    // Transition from installer to main app
    if (installerWindow && !installerWindow.isDestroyed()) {
      installerWindow.close();
      installerWindow = null;
    }
    createWindow();
  });

  const installerPath = path.join(__dirname, '../renderer/installer.html');
  installerWindow.loadFile(installerPath);

  installerWindow.once('ready-to-show', () => {
    installerWindow?.show();
  });

  installerWindow.on('closed', () => {
    installerWindow = null;
  });
}

app.whenReady().then(() => {
  const isInstallerMode = process.argv.includes('--installer') || process.argv.includes('--setup');

  if (isInstallerMode) {
    createInstallerWindow();
  } else {
    createWindow();

    // Background check / auto-download of emulators
    setTimeout(() => {
      EmulatorDownloader.downloadAll((consoleType, percent, status) => {
        mainWindow?.webContents.send('emulators:download-progress', { consoleType, percent, status });
      }).catch(() => {});

      // Auto-provision Switch decryption keys and configuration across emulators
      const vaultPath = storage.getConfig().settings.romDirectories[0];
      SwitchKeyManager.autoProvisionKeys(vaultPath).catch(() => {});
    }, 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (isInstallerMode) createInstallerWindow();
      else createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
