import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Storage, ensureSpecialRomDirectory, getSpecialRomDirectory } from './library/storage.js';
import { scanDirectory, scanFile, detectConsole, RomItem } from './library/scanner.js';
import { CoordinatorClient } from './network/coordinator.js';
import { WireGuardManager } from './network/wireguard.js';
import { EmulatorManager } from './emulators/manager.js';
import { EmulatorDownloader } from './emulators/downloader.js';
import { SwitchKeyManager } from './emulators/switchKeys.js';

export function setupIpc(
  mainWindow: BrowserWindow,
  storage: Storage,
  onLaunchInstalledApp?: () => void
) {
  function safeHandle(channel: string, handler: (event: any, ...args: any[]) => any) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }

  const coordinator = new CoordinatorClient(storage.getConfig().settings.coordinatorUrl);
  const wireguard = new WireGuardManager();

  // --- Window controls ---
  safeHandle('window:minimize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    win?.minimize();
  });
  safeHandle('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  safeHandle('window:close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    win?.close();
  });
  safeHandle('window:isMaximized', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    return win?.isMaximized() ?? false;
  });
  safeHandle('app:openExternal', async (_, url: string) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
    }
  });

  // --- Installer Actions ---
  safeHandle('installer:launchInstalledApp', () => {
    if (onLaunchInstalledApp) {
      onLaunchInstalledApp();
    }
  });

  // --- Storage & Config ---
  safeHandle('config:get', () => storage.getConfig());
  safeHandle('config:updateProfile', (_, partial) => storage.updateProfile(partial));
  safeHandle('config:updateSettings', (_, partial) => {
    const updated = storage.updateSettings(partial);
    if (partial.coordinatorUrl) {
      coordinator.setBaseUrl(partial.coordinatorUrl);
    }
    return updated;
  });
  safeHandle('config:addFriend', (_, code, nickname) => storage.addFriend(code, nickname));
  safeHandle('config:removeFriend', (_, code) => storage.removeFriend(code));
  safeHandle('config:renameRom', (_, id, title) => storage.renameRom(id, title));
  safeHandle('config:toggleHideRom', (_, id) => storage.toggleHideRom(id));
  safeHandle('config:restoreHiddenRoms', () => storage.restoreHiddenRoms());
  safeHandle('config:resetProfile', () => storage.resetProfile());
  safeHandle('config:setConsoleVisible', (_, consoleName, visible) =>
    storage.setConsoleVisible(consoleName, visible)
  );

  // --- File Dialogs ---
  safeHandle('dialog:selectDirectory', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select ROM Folder',
    });
    return res.canceled ? null : res.filePaths[0];
  });

  safeHandle('dialog:selectRomFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Game ROMs',
          extensions: [
            'gba', 'agb', '3ds', 'cci', 'cxi', 'cia', '3dsx',
            'nds', 'dsi', 'ids', 'srl',
            'nsp', 'xci',
            'iso', 'cso', 'pbp', 'chd',
            'gcm', 'rvz', 'wia', 'wbfs', 'zip', '7z'
          ],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
      title: 'Select Game ROM File',
    });
    return res.canceled ? null : res.filePaths[0];
  });

  safeHandle('dialog:selectRomFiles', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Game ROMs',
          extensions: [
            'gba', 'agb', '3ds', 'cci', 'cxi', 'cia', '3dsx',
            'nds', 'dsi', 'ids', 'srl',
            'nsp', 'xci',
            'iso', 'cso', 'pbp', 'chd',
            'gcm', 'rvz', 'wia', 'wbfs', 'zip', '7z'
          ],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
      title: 'Select Game ROM Files to Import',
    });
    return res.canceled ? [] : res.filePaths;
  });

  safeHandle('dialog:selectExecutable', async (e, emulatorName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: `Select ${emulatorName} Executable`,
    });
    return res.canceled ? null : res.filePaths[0];
  });

  safeHandle('dialog:selectAvatar', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      title: 'Select Profile Picture',
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const file = res.filePaths[0];
    const data = fs.readFileSync(file);
    const mime = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  });

  // --- Library Scanning & Metadata ---
  safeHandle('library:scan', async () => {
    const cfg = storage.getConfig().settings;
    const dirs = cfg.romDirectories || [];
    const files = cfg.romFiles || [];
    const items: RomItem[] = [];
    const seenPaths = new Set<string>();

    for (const dir of dirs) {
      const scanned = await scanDirectory(dir);
      for (const item of scanned) {
        if (!seenPaths.has(item.filePath)) {
          seenPaths.add(item.filePath);
          items.push(item);
        }
      }
    }

    for (const file of files) {
      if (!seenPaths.has(file)) {
        const item = await scanFile(file);
        if (item) {
          seenPaths.add(file);
          items.push(item);
        }
      }
    }

    return items;
  });

  safeHandle('library:addDirectory', async (_, dir: string) => {
    storage.addRomDirectory(dir);
    return true;
  });

  safeHandle('library:removeDirectory', async (_, dir: string) => {
    storage.removeRomDirectory(dir);
    return true;
  });

  safeHandle('library:getSpecialRomDirectory', () => {
    const specialRomDir = ensureSpecialRomDirectory();
    return {
      path: specialRomDir,
      exists: fs.existsSync(specialRomDir),
    };
  });

  safeHandle('library:openPath', async (_, targetPath?: string) => {
    const p = targetPath || ensureSpecialRomDirectory();
    if (fs.existsSync(p)) {
      await shell.openPath(p);
      return true;
    }
    return false;
  });

  safeHandle('library:importRomFiles', async (_, filePaths: string[], targetDir?: string) => {
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, count: 0, error: 'No files provided' };
    }

    const specialDir = ensureSpecialRomDirectory();
    const destDir = (targetDir && fs.existsSync(targetDir)) ? targetDir : specialDir;
    fs.mkdirSync(destDir, { recursive: true });

    const importedFiles: string[] = [];

    for (const src of filePaths) {
      if (!fs.existsSync(src)) continue;
      const fileName = path.basename(src);
      const consoleType = detectConsole(src);

      // Check if console-specific subfolder exists inside destDir
      let finalDestDir = destDir;
      if (consoleType) {
        const consoleSubDir = path.join(destDir, consoleType);
        if (fs.existsSync(consoleSubDir)) {
          finalDestDir = consoleSubDir;
        }
      }

      const destFile = path.join(finalDestDir, fileName);
      try {
        if (path.resolve(src) !== path.resolve(destFile)) {
          await fs.promises.copyFile(src, destFile);
        }
        importedFiles.push(destFile);
      } catch (err) {
        console.error(`Failed to copy ROM ${src} to ${destFile}:`, err);
      }
    }

    // Ensure destDir is in romDirectories
    storage.addRomDirectory(destDir);

    return {
      success: true,
      count: importedFiles.length,
      destination: destDir,
      importedFiles,
    };
  });

  safeHandle('library:addFile', async (_, filePath: string) => {
    storage.addRomFile(filePath);
    return await scanFile(filePath);
  });

  safeHandle('library:removeFile', async (_, filePath: string) => {
    storage.removeRomFile(filePath);
    return true;
  });

  safeHandle('library:fetchCompat', async () => {
    try {
      const url = `${coordinator.getBaseUrl()}/compat`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback
    }
    return null;
  });

  safeHandle('library:fetchMeta', async () => {
    try {
      const url = `${coordinator.getBaseUrl()}/meta`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback
    }
    return null;
  });

  // --- Coordinator Client ---
  safeHandle('coordinator:checkHealth', () => coordinator.checkHealth());
  safeHandle('coordinator:createSession', (_, params) => coordinator.createSession(params));
  safeHandle('coordinator:patchSession', (_, code, ip, port, token) =>
    coordinator.patchSession(code, ip, port, token)
  );
  safeHandle('coordinator:setHostReady', (_, code, ready, token) =>
    coordinator.setHostReady(code, ready, token)
  );
  safeHandle('coordinator:getSession', (_, code) => coordinator.getSession(code));
  safeHandle('coordinator:listRelays', () => coordinator.listRelays());
  safeHandle('coordinator:listSessions', () => coordinator.listSessions());
  safeHandle('coordinator:heartbeat', (_, code, id, name, rttMs) =>
    coordinator.heartbeat(code, id, name, rttMs)
  );
  safeHandle('coordinator:leaveSession', (_, code, id, token) =>
    coordinator.leaveSession(code, id, token)
  );
  safeHandle('coordinator:deleteSession', (_, code, token) => coordinator.deleteSession(code, token));
  safeHandle('coordinator:announcePresence', (_, id, name, inSession) =>
    coordinator.announcePresence(id, name, inSession)
  );
  safeHandle('coordinator:announceLastGame', (_, id, title, titleId) =>
    coordinator.announceLastGame(id, title, titleId)
  );
  safeHandle('coordinator:friendStatuses', (_, codes) => coordinator.friendStatuses(codes));
  safeHandle('coordinator:claimAddress', (_, code, pubKey, name, profileId) =>
    coordinator.claimAddress(code, pubKey, name, profileId)
  );
  safeHandle('coordinator:uploadAvatar', (_, id, key, imageBase64) =>
    coordinator.uploadAvatar(id, key, imageBase64)
  );
  safeHandle('coordinator:deleteAvatar', (_, id, key) =>
    coordinator.deleteAvatar(id, key)
  );
  safeHandle('coordinator:reportJoinFailure', (_, reason, consoleType, code) =>
    coordinator.reportJoinFailure(reason, consoleType, code)
  );
  safeHandle('coordinator:reportEvent', (_, params) =>
    coordinator.reportEvent(params)
  );

  // --- WireGuard ---
  safeHandle('wireguard:up', (_, info, dns) => {
    const appData = app.getPath('userData');
    const privateKey = storage.getConfig().wgKeys.privateKey;
    return wireguard.up(info, privateKey, appData, dns);
  });
  safeHandle('wireguard:down', () => wireguard.down());
  safeHandle('wireguard:status', () => wireguard.getStatus());

  // --- Emulators ---
  EmulatorManager.setOnGameExit(() => {
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('emulators:game-closed');
      }
    } catch {}
  });

  safeHandle('emulators:killActiveGame', () => {
    EmulatorManager.killActiveGame();
  });
  safeHandle('emulators:detectAll', () => {
    const custom = storage.getConfig().settings.customEmulatorPaths;
    return EmulatorManager.detectAll(custom);
  });
  safeHandle('emulators:download', async (_, consoleType: string) => {
    return EmulatorDownloader.downloadEmulator(consoleType, (percent, status) => {
      mainWindow.webContents.send('emulators:download-progress', { consoleType, percent, status });
    });
  });
  safeHandle('emulators:downloadAll', async () => {
    return EmulatorDownloader.downloadAll((consoleType, percent, status) => {
      mainWindow.webContents.send('emulators:download-progress', { consoleType, percent, status });
    });
  });
  safeHandle('emulators:switchKeyStatus', () => {
    return SwitchKeyManager.getStatus();
  });
  safeHandle('emulators:provisionSwitchKeys', async () => {
    const vault = storage.getConfig().settings.romDirectories[0];
    const success = await SwitchKeyManager.autoProvisionKeys(vault);
    return { success, status: SwitchKeyManager.getStatus() };
  });
  safeHandle('emulators:isDownloaded', (_, consoleType: string) => {
    return EmulatorDownloader.isDownloaded(consoleType);
  });
  safeHandle('emulators:launchGame', (_, consoleType, options) => {
    const custom = storage.getConfig().settings.customEmulatorPaths[consoleType];
    const appRes = app.isPackaged
      ? path.join(process.resourcesPath)
      : path.join(__dirname, '..', '..', 'src', 'renderer', 'assets');
    return EmulatorManager.launchGame(consoleType, {
      ...options,
      customExecutable: custom,
      appResourceDir: appRes,
    });
  });
}
