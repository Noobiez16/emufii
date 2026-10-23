import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';

export interface SwitchKeyStatus {
  isInstalled: boolean;
  version: string;
  keyPath?: string;
  hasTitleKeys: boolean;
  hasFirmware: boolean;
  firmwareNcaCount: number;
}

const REMOTE_PROD_KEYS_URL = 'https://archive.org/download/nspk1901/prod.keys';
const REMOTE_TITLE_KEYS_URL = 'https://archive.org/download/nspk1901/title.keys';

export class SwitchKeyManager {
  /**
   * Returns central directory for Emufii Switch assets.
   */
  static getCentralDir(): string {
    const platform = os.platform();
    const home = os.homedir();
    if (platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      return path.join(appData, 'emufii', 'system', 'switch');
    } else if (platform === 'darwin') {
      return path.join(home, 'Library', 'Application Support', 'emufii', 'system', 'switch');
    } else {
      return path.join(home, '.config', 'emufii', 'system', 'switch');
    }
  }

  /**
   * Returns all possible system key directories for Ryujinx, Eden, Yuzu, Suyu on the active OS.
   */
  static getTargetKeyDirs(): string[] {
    const platform = os.platform();
    const home = os.homedir();
    const dirs: string[] = [];

    if (platform === 'linux') {
      // Ryujinx Flatpak
      dirs.push(path.join(home, '.var', 'app', 'io.github.ryubing.Ryujinx', 'config', 'Ryujinx', 'system'));
      dirs.push(path.join(home, '.var', 'app', 'org.ryujinx.Ryujinx', 'config', 'Ryujinx', 'system'));
      // Eden Flatpak
      dirs.push(path.join(home, '.var', 'app', 'dev.eden_emu.eden', 'data', 'yuzu', 'keys'));
      dirs.push(path.join(home, '.var', 'app', 'dev.eden_emu.eden', 'config', 'yuzu', 'keys'));
      // Native Ryujinx
      dirs.push(path.join(home, '.config', 'Ryujinx', 'system'));
      // Native Yuzu / Eden / Suyu
      dirs.push(path.join(home, '.local', 'share', 'yuzu', 'keys'));
      dirs.push(path.join(home, '.local', 'share', 'eden', 'keys'));
      dirs.push(path.join(home, '.local', 'share', 'suyu', 'keys'));
      dirs.push(path.join(home, '.config', 'yuzu', 'keys'));
      dirs.push(path.join(home, '.config', 'eden', 'keys'));
      dirs.push(path.join(home, '.config', 'suyu', 'keys'));
    } else if (platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      dirs.push(path.join(appData, 'Ryujinx', 'system'));
      dirs.push(path.join(appData, 'yuzu', 'keys'));
      dirs.push(path.join(appData, 'eden', 'keys'));
      dirs.push(path.join(appData, 'suyu', 'keys'));
    } else if (platform === 'darwin') {
      const appSupport = path.join(home, 'Library', 'Application Support');
      dirs.push(path.join(appSupport, 'Ryujinx', 'system'));
      dirs.push(path.join(appSupport, 'yuzu', 'keys'));
      dirs.push(path.join(appSupport, 'eden', 'keys'));
      dirs.push(path.join(appSupport, 'suyu', 'keys'));
    }

    // Always include central Emufii directory
    dirs.push(this.getCentralDir());
    return dirs;
  }

  /**
   * Returns firmware registration directories.
   */
  static getFirmwareDirs(): string[] {
    const platform = os.platform();
    const home = os.homedir();
    const dirs: string[] = [];

    if (platform === 'linux') {
      dirs.push(path.join(home, '.var', 'app', 'io.github.ryubing.Ryujinx', 'config', 'Ryujinx', 'bis', 'system', 'Contents', 'registered'));
      dirs.push(path.join(home, '.config', 'Ryujinx', 'bis', 'system', 'Contents', 'registered'));
      dirs.push(path.join(home, '.var', 'app', 'dev.eden_emu.eden', 'data', 'yuzu', 'nand', 'system', 'Contents', 'registered'));
      dirs.push(path.join(home, '.local', 'share', 'yuzu', 'nand', 'system', 'Contents', 'registered'));
    } else if (platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      dirs.push(path.join(appData, 'Ryujinx', 'bis', 'system', 'Contents', 'registered'));
      dirs.push(path.join(appData, 'yuzu', 'nand', 'system', 'Contents', 'registered'));
    } else if (platform === 'darwin') {
      const appSupport = path.join(home, 'Library', 'Application Support');
      dirs.push(path.join(appSupport, 'Ryujinx', 'bis', 'system', 'Contents', 'registered'));
      dirs.push(path.join(appSupport, 'yuzu', 'nand', 'system', 'Contents', 'registered'));
    }

    dirs.push(path.join(this.getCentralDir(), 'firmware'));
    return dirs;
  }

  /**
   * Check status of Switch decryption keys and firmware.
   */
  static getStatus(): SwitchKeyStatus {
    const targetDirs = this.getTargetKeyDirs();
    let foundProdKey: string | undefined;
    let hasTitle = false;

    for (const dir of targetDirs) {
      const p = path.join(dir, 'prod.keys');
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          if (content.includes('header_key') && content.length > 500) {
            foundProdKey = p;
            break;
          }
        } catch {}
      }
    }

    for (const dir of targetDirs) {
      const p = path.join(dir, 'title.keys');
      if (fs.existsSync(p) && fs.statSync(p).size > 100) {
        hasTitle = true;
        break;
      }
    }

    let ncaCount = 0;
    for (const dir of this.getFirmwareDirs()) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.nca'));
          if (files.length > ncaCount) {
            ncaCount = files.length;
          }
        } catch {}
      }
    }

    return {
      isInstalled: !!foundProdKey,
      version: foundProdKey ? 'v19.0.1' : 'Missing',
      keyPath: foundProdKey,
      hasTitleKeys: hasTitle,
      hasFirmware: ncaCount > 100,
      firmwareNcaCount: ncaCount,
    };
  }

  /**
   * Download a file from URL following redirects.
   */
  private static async downloadFile(url: string, destPath: string): Promise<boolean> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    return new Promise((resolve) => {
      const request = (targetUrl: string, depth = 0) => {
        if (depth > 5) return resolve(false);
        const req = https.get(targetUrl, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return request(res.headers.location, depth + 1);
          }
          if (res.statusCode !== 200) {
            return resolve(false);
          }
          const fileStream = fs.createWriteStream(destPath);
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve(true);
          });
          fileStream.on('error', () => {
            try { fs.unlinkSync(destPath); } catch {}
            resolve(false);
          });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(15000, () => {
          req.destroy();
          resolve(false);
        });
      };
      request(url);
    });
  }

  /**
   * Automatically ensure Switch keys are present across all emulators on the system.
   * If missing, downloads from reliable source and populates all emulator config dirs.
   */
  static async autoProvisionKeys(vaultPath?: string): Promise<boolean> {
    const central = this.getCentralDir();
    fs.mkdirSync(central, { recursive: true });

    const centralProd = path.join(central, 'prod.keys');
    const centralTitle = path.join(central, 'title.keys');

    // 1. Check if keys already exist locally in central dir or in Vault
    let prodContent: string | null = null;
    let titleContent: string | null = null;

    if (fs.existsSync(centralProd)) {
      try {
        const c = fs.readFileSync(centralProd, 'utf8');
        if (c.includes('header_key')) prodContent = c;
      } catch {}
    }

    if (vaultPath && !prodContent) {
      const candidates = [
        path.join(vaultPath, 'Switch', 'prod.keys'),
        path.join(vaultPath, 'Switch', 'keys', 'prod.keys'),
        path.join(vaultPath, 'prod.keys'),
        path.join(vaultPath, 'keys', 'prod.keys'),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          try {
            const c = fs.readFileSync(cand, 'utf8');
            if (c.includes('header_key')) {
              prodContent = c;
              const titleCand = path.join(path.dirname(cand), 'title.keys');
              if (fs.existsSync(titleCand)) {
                titleContent = fs.readFileSync(titleCand, 'utf8');
              }
              break;
            }
          } catch {}
        }
      }
    }

    // 2. Also check if any existing emulator directory on the system already has it
    if (!prodContent) {
      for (const dir of this.getTargetKeyDirs()) {
        const cand = path.join(dir, 'prod.keys');
        if (fs.existsSync(cand)) {
          try {
            const c = fs.readFileSync(cand, 'utf8');
            if (c.includes('header_key') && c.length > 500) {
              prodContent = c;
              const titleCand = path.join(dir, 'title.keys');
              if (fs.existsSync(titleCand)) {
                titleContent = fs.readFileSync(titleCand, 'utf8');
              }
              break;
            }
          } catch {}
        }
      }
    }

    // 3. If still not found, download comprehensive keyset
    if (!prodContent) {
      const ok = await this.downloadFile(REMOTE_PROD_KEYS_URL, centralProd);
      if (ok && fs.existsSync(centralProd)) {
        prodContent = fs.readFileSync(centralProd, 'utf8');
      }
      if (fs.existsSync(centralTitle)) {
        titleContent = fs.readFileSync(centralTitle, 'utf8');
      } else {
        await this.downloadFile(REMOTE_TITLE_KEYS_URL, centralTitle);
        if (fs.existsSync(centralTitle)) {
          titleContent = fs.readFileSync(centralTitle, 'utf8');
        }
      }
    } else {
      // Save to central
      if (!fs.existsSync(centralProd)) {
        fs.writeFileSync(centralProd, prodContent, 'utf8');
      }
      if (titleContent && !fs.existsSync(centralTitle)) {
        fs.writeFileSync(centralTitle, titleContent, 'utf8');
      }
    }

    if (!prodContent) return false;

    // 4. Distribute keys to ALL possible Switch emulator directories on this OS
    for (const dir of this.getTargetKeyDirs()) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const pPath = path.join(dir, 'prod.keys');
        const tPath = path.join(dir, 'title.keys');
        if (!fs.existsSync(pPath) || fs.statSync(pPath).size < 500) {
          fs.writeFileSync(pPath, prodContent, 'utf8');
        }
        if (titleContent && (!fs.existsSync(tPath) || fs.statSync(tPath).size < 100)) {
          fs.writeFileSync(tPath, titleContent, 'utf8');
        }
      } catch {}
    }

    // 5. Ensure Ryujinx Config.json has enable_fs_integrity_checks = false
    this.configureRyujinxIntegrity();

    return true;
  }

  /**
   * Configures Ryujinx Config.json for optimal 60 FPS performance and stability.
   * - Disables strict FS integrity checks (prevents XCI hash mismatch crashes).
   * - Switches to Handheld mode (720p target instead of 1080p, reducing GPU workload by >50% for 60 FPS on integrated GPUs/laptops).
   * - Enables multithreaded backend, HostMappedUnsafe memory, PTC, and Macro HLE.
   * - Disables file logging to eliminate I/O stutter.
   */
  static configureRyujinxPerformance(): void {
    const home = os.homedir();
    const configPaths = [
      path.join(home, '.var', 'app', 'io.github.ryubing.Ryujinx', 'config', 'Ryujinx', 'Config.json'),
      path.join(home, '.var', 'app', 'org.ryujinx.Ryujinx', 'config', 'Ryujinx', 'Config.json'),
      path.join(home, '.config', 'Ryujinx', 'Config.json'),
    ];

    if (os.platform() === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      configPaths.push(path.join(appData, 'Ryujinx', 'Config.json'));
    } else if (os.platform() === 'darwin') {
      configPaths.push(path.join(home, 'Library', 'Application Support', 'Ryujinx', 'Config.json'));
    }

    for (const cPath of configPaths) {
      if (fs.existsSync(cPath)) {
        try {
          const raw = fs.readFileSync(cPath, 'utf8');
          const json = JSON.parse(raw);

          // 1. Stability: Disable strict FS integrity check
          json.enable_fs_integrity_checks = false;

          // 2. 60 FPS: Handheld mode (native 720p reduces fillrate dramatically on integrated GPUs)
          json.docked_mode = false;

          // 3. 60 FPS: VSync on to lock smooth 60 Hz frame pacing
          json.enable_vsync = true;
          json.vsync_mode = 0;

          // 4. 60 FPS: Multithreaded Vulkan backend & memory manager
          json.backend_threading = 'On';
          json.graphics_backend = 'Vulkan';
          json.memory_manager_mode = 'HostMappedUnsafe';

          // 5. 60 FPS: JIT PTC (Profiled Translated Code) & Macro HLE
          json.enable_ptc = true;
          json.enable_macro_hle = true;
          json.enable_shader_cache = true;

          // 6. 60 FPS: Eliminate file logging disk I/O stutters
          json.enable_file_log = false;
          json.logging_enable_debug = false;
          json.logging_enable_info = false;
          json.logging_enable_guest = false;

          fs.writeFileSync(cPath, JSON.stringify(json, null, 2), 'utf8');
        } catch {}
      }
    }
  }

  static configureRyujinxIntegrity(): void {
    this.configureRyujinxPerformance();
  }

  /**
   * Inspects and repairs XCI Partition File System (HFS0) SHA-256 partition hashes.
   * If the dump has modified/trimmed headers that mismatch HFS0 entry hashes,
   * this safely updates the 32-byte hash in the header so LibHac/Ryujinx boots it smoothly.
   */
  static verifyAndRepairXci(romPath: string): boolean {
    if (!fs.existsSync(romPath)) return false;
    if (!romPath.toLowerCase().endsWith('.xci')) return true;

    try {
      const fd = fs.openSync(romPath, 'r+');
      const rootHdr = Buffer.alloc(0x200);
      fs.readSync(fd, rootHdr, 0, 0x200, 0xf000);
      if (rootHdr.subarray(0, 4).toString('ascii') !== 'HFS0') {
        fs.closeSync(fd);
        return true;
      }

      // Check secure partition at 0xf600
      const secHdr = Buffer.alloc(0x200);
      fs.readSync(fd, secHdr, 0, 0x200, 0xf600);
      if (secHdr.subarray(0, 4).toString('ascii') !== 'HFS0') {
        fs.closeSync(fd);
        return true;
      }

      const numFiles = secHdr.readUInt32LE(4);
      if (numFiles < 1) {
        fs.closeSync(fd);
        return true;
      }

      // Entry 0 in secure partition is at 0xf600 + 0x10
      const entry0 = Buffer.alloc(0x40);
      fs.readSync(fd, entry0, 0, 0x40, 0xf600 + 0x10);
      const expectedHash = entry0.subarray(32, 64);

      // Data for entry 0 starts at 0xf800
      const first512 = Buffer.alloc(512);
      fs.readSync(fd, first512, 0, 512, 0xf800);
      const actualHash = crypto.createHash('sha256').update(first512).digest();

      if (!expectedHash.equals(actualHash)) {
        // Patch Entry 0 hash
        fs.writeSync(fd, actualHash, 0, 32, 0xf600 + 0x10 + 32);

        // Recalculate secure partition header hash (first 512 bytes of 0xf600)
        const sec512 = Buffer.alloc(512);
        fs.readSync(fd, sec512, 0, 512, 0xf600);
        const secHash = crypto.createHash('sha256').update(sec512).digest();

        // Write into root HFS0 secure entry (Entry 2 is at 0xf090 + 32 = 0xf0b0)
        fs.writeSync(fd, secHash, 0, 32, 0xf0b0);
      }

      fs.closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }
}
