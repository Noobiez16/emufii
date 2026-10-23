import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface EmulatorDownloadInfo {
  name: string;
  console: string;
  linuxUrl: string;
  archiveType: 'direct' | 'zip';
  binaryName: string;
  extractedName?: string;
}

export const EMULATOR_CATALOG: Record<string, EmulatorDownloadInfo> = {
  DS: {
    name: 'melonDS',
    console: 'DS',
    linuxUrl: 'https://github.com/melonDS-emu/melonDS/releases/download/1.1/melonDS-1.1-appimage-x86_64.zip',
    archiveType: 'zip',
    binaryName: 'melonDS.AppImage',
    extractedName: 'melonDS-x86_64.AppImage',
  },
  GBA: {
    name: 'mGBA',
    console: 'GBA',
    linuxUrl: 'https://github.com/mgba-emu/mgba/releases/download/0.10.5/mGBA-0.10.5-appimage-x64.appimage',
    archiveType: 'direct',
    binaryName: 'mgba.AppImage',
  },
  PSP: {
    name: 'PPSSPP',
    console: 'PSP',
    linuxUrl: 'https://github.com/hrydgard/ppsspp/releases/download/v1.20.4/PPSSPP-v1.20.4-anylinux-x86_64.AppImage',
    archiveType: 'direct',
    binaryName: 'ppsspp.AppImage',
  },
  '3DS': {
    name: 'Azahar',
    console: '3DS',
    linuxUrl: 'https://github.com/azahar-emu/azahar/releases/download/2126.2/azahar.AppImage',
    archiveType: 'direct',
    binaryName: 'azahar.AppImage',
  },
  PS2: {
    name: 'PCSX2',
    console: 'PS2',
    linuxUrl: 'https://github.com/PCSX2/pcsx2/releases/download/v2.8.2/pcsx2-v2.8.2-linux-appimage-x64-Qt.AppImage',
    archiveType: 'direct',
    binaryName: 'pcsx2.AppImage',
  },
  GameCube: {
    name: 'Dolphin',
    console: 'GameCube',
    linuxUrl: 'https://github.com/pkgforge-dev/Dolphin-emu-AppImage/releases/download/2609%402026-10-01_1790876487/Dolphin_Emulator-2609-anylinux-x86_64.AppImage',
    archiveType: 'direct',
    binaryName: 'dolphin.AppImage',
  },
  Wii: {
    name: 'Dolphin',
    console: 'Wii',
    linuxUrl: 'https://github.com/pkgforge-dev/Dolphin-emu-AppImage/releases/download/2609%402026-10-01_1790876487/Dolphin_Emulator-2609-anylinux-x86_64.AppImage',
    archiveType: 'direct',
    binaryName: 'dolphin.AppImage',
  },
};

export class EmulatorDownloader {
  private static activeDownloads = new Map<string, Promise<{ success: boolean; path?: string; message: string }>>();

  static getBaseDir(): string {
    return path.join(os.homedir(), '.config', 'emufii', 'emulators');
  }

  static getManagedPath(consoleType: string): string | null {
    const info = EMULATOR_CATALOG[consoleType];
    if (!info) return null;
    const targetFolder = consoleType === 'Wii' ? 'GameCube' : consoleType;
    return path.join(this.getBaseDir(), targetFolder, info.binaryName);
  }

  static isDownloaded(consoleType: string): boolean {
    const p = this.getManagedPath(consoleType);
    return !!p && fs.existsSync(p);
  }

  /**
   * Download a single emulator with progress callback.
   */
  static async downloadEmulator(
    consoleType: string,
    onProgress?: (percent: number, status: string) => void
  ): Promise<{ success: boolean; path?: string; message: string }> {
    const key = consoleType === 'Wii' ? 'GameCube' : consoleType;
    const existing = this.activeDownloads.get(key);
    if (existing) {
      return existing;
    }

    const task = this.runDownload(key, onProgress).finally(() => {
      this.activeDownloads.delete(key);
    });

    this.activeDownloads.set(key, task);
    return task;
  }

  private static async runDownload(
    consoleType: string,
    onProgress?: (percent: number, status: string) => void
  ): Promise<{ success: boolean; path?: string; message: string }> {
    const info = EMULATOR_CATALOG[consoleType];
    if (!info) {
      return { success: false, message: `No automatic download available for console: ${consoleType}` };
    }

    const platform = os.platform();
    if (platform !== 'linux') {
      return { success: false, message: `Auto-download currently configured for Linux. Please install ${info.name} manually.` };
    }

    const targetDir = path.join(this.getBaseDir(), consoleType);
    const finalBinaryPath = path.join(targetDir, info.binaryName);

    try {
      fs.mkdirSync(targetDir, { recursive: true });

      onProgress?.(5, `Connecting to download ${info.name}...`);
      const response = await fetch(info.linuxUrl, {
        headers: { 'User-Agent': 'EmuFii-Desktop' },
        redirect: 'follow',
      });

      if (!response.ok || !response.body) {
        return { success: false, message: `Failed to download ${info.name}: HTTP ${response.status}` };
      }

      const totalBytes = Number(response.headers.get('content-length')) || 0;
      let receivedBytes = 0;

      const isZip = info.archiveType === 'zip';
      const tempPath = isZip
        ? path.join(targetDir, `${consoleType}_temp.zip`)
        : path.join(targetDir, `${consoleType}_temp.AppImage`);

      const fileStream = fs.createWriteStream(tempPath);

      // Stream download with progress calculation
      for await (const chunk of response.body as any) {
        fileStream.write(chunk);
        receivedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = Math.min(95, Math.round((receivedBytes / totalBytes) * 90) + 5);
          onProgress?.(percent, `Downloading ${info.name}... ${Math.round(receivedBytes / 1024 / 1024)}MB / ${Math.round(totalBytes / 1024 / 1024)}MB`);
        } else {
          onProgress?.(50, `Downloading ${info.name}... ${Math.round(receivedBytes / 1024 / 1024)}MB`);
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });

      if (isZip) {
        onProgress?.(96, `Extracting ${info.name}...`);
        await execAsync(`unzip -q -o "${tempPath}" -d "${targetDir}"`, { timeout: 30000 });
        try { fs.unlinkSync(tempPath); } catch {}

        if (info.extractedName && info.extractedName !== info.binaryName) {
          const extractedPath = path.join(targetDir, info.extractedName);
          if (fs.existsSync(extractedPath)) {
            try { fs.unlinkSync(finalBinaryPath); } catch {}
            fs.renameSync(extractedPath, finalBinaryPath);
          }
        }
      } else {
        try { fs.unlinkSync(finalBinaryPath); } catch {}
        fs.renameSync(tempPath, finalBinaryPath);
      }

      // Ensure execution permission
      fs.chmodSync(finalBinaryPath, 0o755);

      onProgress?.(100, `${info.name} installed successfully!`);
      return {
        success: true,
        path: finalBinaryPath,
        message: `${info.name} downloaded and ready.`,
      };
    } catch (err: any) {
      return { success: false, message: `Failed to download ${info.name}: ${err.message}` };
    }
  }

  /**
   * Download all missing emulators in parallel.
   */
  static async downloadAll(
    onProgress?: (consoleType: string, percent: number, status: string) => void
  ): Promise<{ success: boolean; results: Record<string, boolean> }> {
    const consoles = ['DS', 'GBA', 'PSP', '3DS', 'PS2', 'GameCube'];
    const results: Record<string, boolean> = {};

    for (const c of consoles) {
      if (this.isDownloaded(c)) {
        results[c] = true;
        onProgress?.(c, 100, 'Already installed');
        continue;
      }

      const res = await this.downloadEmulator(c, (percent, status) => {
        onProgress?.(c, percent, status);
      });
      results[c] = res.success;
    }

    return {
      success: Object.values(results).every(Boolean),
      results,
    };
  }
}
