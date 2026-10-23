import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { generateFriendCode, isValidFriendCode } from '../profile/friendCode.js';
import { WireGuardManager, WgKeys } from '../network/wireguard.js';

export interface AppConfig {
  profile: {
    id: string;
    name: string;
    avatarDataUrl?: string | null;
  };
  wgKeys: WgKeys;
  settings: {
    romDirectories: string[];
    romFiles?: string[];
    theme: 'system' | 'light' | 'dark' | 'oled' | 'day' | 'night';
    accent: 'teal' | 'coral' | 'cyan' | 'purple' | 'green' | 'yellow' | 'red' | 'blue';
    animations: boolean;
    soundEffects: boolean;
    libraryLayout: 'grid' | 'carousel' | 'list';
    librarySort: 'az' | 'date' | 'console';
    coordinatorUrl: string;
    customEmulatorPaths: Record<string, string>;
    hiddenRoms: string[];
    customTitles: Record<string, string>;
    friends: string[];
    friendNicknames: Record<string, string>;
    steamGridDbKey?: string;
    language: 'system' | 'en' | 'es' | 'fr';
    hiddenConsoles: string[];
    hideIncompatible: boolean;
    notifyFriends: boolean;
    shareLastGame: boolean;
  };
}

export function getSpecialRomDirectory(): string {
  const home = app.getPath('home');
  return path.join(home, 'Emufii', 'ROMs');
}

export function ensureSpecialRomDirectory(): string {
  const romDir = getSpecialRomDirectory();
  try {
    if (!fs.existsSync(romDir)) {
      fs.mkdirSync(romDir, { recursive: true });
    }
    const subfolders = ['Wii', 'GameCube', 'PS2', 'PSP', 'DS', 'GBA', '3DS', 'Switch'];
    for (const sub of subfolders) {
      const subPath = path.join(romDir, sub);
      if (!fs.existsSync(subPath)) {
        fs.mkdirSync(subPath, { recursive: true });
      }
    }
  } catch (err) {
    console.error('Failed to create special ROM directory:', err);
  }
  return romDir;
}

export class Storage {
  private configPath: string;
  private config: AppConfig;

  constructor() {
    const userData = app.getPath('userData');
    this.configPath = path.join(userData, 'config.json');
    this.config = this.load();
  }

  private load(): AppConfig {
    let loaded: Partial<AppConfig> = {};
    try {
      if (fs.existsSync(this.configPath)) {
        loaded = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch {
      loaded = {};
    }

    // Default Profile
    let id = loaded.profile?.id;
    if (!id || !isValidFriendCode(id)) {
      id = generateFriendCode();
    }
    const profile = {
      id,
      name: loaded.profile?.name || 'Joueur',
      avatarDataUrl: loaded.profile?.avatarDataUrl || null,
    };

    // Default WireGuard keys
    let wgKeys = loaded.wgKeys;
    if (!wgKeys || !wgKeys.privateKey || !wgKeys.publicKey) {
      wgKeys = WireGuardManager.generateKeyPair();
    }

    // Ensure Special ROM Directory exists and is registered in settings
    const specialRomDir = ensureSpecialRomDirectory();
    let romDirs: string[] = loaded.settings?.romDirectories || [];
    if (!romDirs.includes(specialRomDir)) {
      romDirs = [specialRomDir, ...romDirs];
    }

    // Default Settings
    const settings = {
      romDirectories: romDirs,
      romFiles: loaded.settings?.romFiles || [],
      theme: (loaded.settings?.theme as any) || 'dark',
      accent: (loaded.settings?.accent as any) || 'teal',
      animations: loaded.settings?.animations !== false,
      soundEffects: loaded.settings?.soundEffects !== false,
      libraryLayout: loaded.settings?.libraryLayout || 'grid',
      librarySort: loaded.settings?.librarySort || 'console',
      coordinatorUrl: loaded.settings?.coordinatorUrl || 'https://coord.emufii.xyz',
      customEmulatorPaths: loaded.settings?.customEmulatorPaths || {},
      hiddenRoms: loaded.settings?.hiddenRoms || [],
      customTitles: loaded.settings?.customTitles || {},
      friends: loaded.settings?.friends || [],
      friendNicknames: loaded.settings?.friendNicknames || {},
      steamGridDbKey: loaded.settings?.steamGridDbKey || '',
      language: (loaded.settings?.language as any) || 'system',
      hiddenConsoles: loaded.settings?.hiddenConsoles || [],
      hideIncompatible: !!loaded.settings?.hideIncompatible,
      notifyFriends: loaded.settings?.notifyFriends !== false,
      shareLastGame: loaded.settings?.shareLastGame !== false,
    };

    const config: AppConfig = { profile, wgKeys, settings };
    this.save(config);
    return config;
  }

  save(config = this.config) {
    this.config = config;
    try {
      const dir = path.dirname(this.configPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  }

  getConfig(): AppConfig {
    return this.config;
  }

  updateProfile(partial: Partial<AppConfig['profile']>) {
    this.config.profile = { ...this.config.profile, ...partial };
    this.save();
    return this.config.profile;
  }

  updateSettings(partial: Partial<AppConfig['settings']>) {
    this.config.settings = { ...this.config.settings, ...partial };
    this.save();
    return this.config.settings;
  }

  addFriend(code: string, nickname?: string) {
    if (!this.config.settings.friends.includes(code)) {
      this.config.settings.friends.push(code);
    }
    if (nickname) {
      this.config.settings.friendNicknames[code] = nickname;
    }
    this.save();
  }

  removeFriend(code: string) {
    this.config.settings.friends = this.config.settings.friends.filter((c) => c !== code);
    delete this.config.settings.friendNicknames[code];
    this.save();
  }

  renameRom(romId: string, customTitle: string) {
    if (customTitle.trim()) {
      this.config.settings.customTitles[romId] = customTitle.trim();
    } else {
      delete this.config.settings.customTitles[romId];
    }
    this.save();
  }

  toggleHideRom(romId: string) {
    const list = this.config.settings.hiddenRoms;
    const index = list.indexOf(romId);
    if (index >= 0) {
      list.splice(index, 1);
    } else {
      list.push(romId);
    }
    this.save();
  }

  addRomDirectory(dir: string) {
    if (!this.config.settings.romDirectories.includes(dir)) {
      this.config.settings.romDirectories.push(dir);
      this.save();
    }
  }

  removeRomDirectory(dir: string) {
    this.config.settings.romDirectories = this.config.settings.romDirectories.filter((d) => d !== dir);
    this.save();
  }

  addRomFile(filePath: string) {
    if (!this.config.settings.romFiles) {
      this.config.settings.romFiles = [];
    }
    if (!this.config.settings.romFiles.includes(filePath)) {
      this.config.settings.romFiles.push(filePath);
      this.save();
    }
  }

  removeRomFile(filePath: string) {
    if (!this.config.settings.romFiles) return;
    this.config.settings.romFiles = this.config.settings.romFiles.filter((f) => f !== filePath);
    this.save();
  }

  restoreHiddenRoms() {
    this.config.settings.hiddenRoms = [];
    this.save();
    return this.config.settings.hiddenRoms;
  }

  setConsoleVisible(console: string, visible: boolean) {
    const list = this.config.settings.hiddenConsoles || [];
    if (visible) {
      this.config.settings.hiddenConsoles = list.filter((c) => c !== console);
    } else {
      if (!list.includes(console)) {
        list.push(console);
      }
      this.config.settings.hiddenConsoles = list;
    }
    this.save();
    return this.config.settings.hiddenConsoles;
  }

  resetProfile() {
    this.config.profile = {
      id: generateFriendCode(),
      name: 'Joueur',
      avatarDataUrl: null,
    };
    this.config.wgKeys = WireGuardManager.generateKeyPair();
    this.config.settings.friends = [];
    this.config.settings.friendNicknames = {};
    this.save();
    return this.config;
  }
}

