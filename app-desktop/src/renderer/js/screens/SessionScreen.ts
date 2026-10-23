import { store } from '../state.js';
import { sfx } from '../sfx.js';
import { ensureEmulator } from '../components/EmulatorDownloadModal.js';
import type { RemoteSession } from '../../../main/network/coordinator.js';

export function renderSessionScreen(container: HTMLElement) {
  const emuApi = (window as any).emufii;
  let pollTimer: any = null;

  const update = () => {
    const session = store.get().activeSession;
    if (!session) {
      container.innerHTML = `<div style="padding: 32px;">No active session.</div>`;
      return;
    }

    const isHost = session.isHost;
    const isOnline = session.code === 'ONLINE';
    const remote = session.remote;
    const wg = session.wireguard;
    const isPsp = session.rom?.console === 'PSP';
    const isDolphin = session.rom?.console === 'GameCube' || session.rom?.console === 'Wii';
    const isPs2 = session.rom?.console === 'PS2';

    // PPSSPP ad hoc server uses fixed sentinel address 10.66.1.1 (matches Session.kt shownAddress)
    const displayIp = isPsp
      ? '10.66.1.1'
      : isHost
      ? (wg?.address || '10.67.0.2')
      : (remote?.hostIp || '10.67.0.2');

    // Default netplay port matching Console.kt backend.defaultNetplayPort:
    // Dolphin: 2626, PS2: 19072, MelonDS: 7000, 3DS/Switch: 24872
    const defaultPort = isDolphin ? 2626 : isPs2 ? 19072 : session.rom?.console === 'DS' ? 7000 : 24872;
    const displayPort = remote?.port || defaultPort;

    container.innerHTML = `
      <div class="session-screen">
        <!-- Left Panel: State -->
        <div class="session-left">
          <div class="code-display-card" style="border-radius: 24px;">
            <div style="font-size: 13px; font-weight: 700; color: var(--ink-secondary); text-transform: uppercase; letter-spacing: 1px;">
              ${isOnline ? 'Online Play' : 'Session Code'}
            </div>
            <div class="code-value" style="${isOnline ? 'font-size: 32px; letter-spacing: 2px;' : ''}">${session.code}</div>
            ${!isOnline ? `
            <button class="btn-secondary plate-button" id="btnCopyCode" style="height: 36px; padding: 0 18px; font-size: 13px; border-radius: 9999px;">
              Copy Code
            </button>
            ` : `
            <div style="font-size: 12px; color: var(--ink-secondary);">Direct connection to multiplayer servers</div>
            `}
          </div>

          <!-- Connection Details Card -->
          <div class="plate" style="padding: 20px; display: flex; flex-direction: column; gap: 12px; border-radius: 24px;">
            <div style="font-size: 13px; font-weight: 700; color: var(--ink-secondary);">${isOnline ? 'Network Mode' : 'Tunnel & Address'}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--plate-bg-low); padding: 10px 14px; border-radius: 18px; font-family: var(--font-family); font-size: 14px;">
              <span>${isOnline ? 'Service: <strong>Public Online Ready</strong>' : `Address: <strong>${displayIp}</strong>`}</span>
              ${isOnline ? '<span class="lamp active"></span>' : '<button class="btn-secondary plate-button" style="height: 28px; padding: 0 12px; font-size: 11px; border-radius: 9999px;" id="btnCopyIp">Copy</button>'}
            </div>
            ${!isOnline && !isPsp ? `
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--plate-bg-low); padding: 10px 14px; border-radius: 18px; font-family: var(--font-family); font-size: 14px;">
              <span>Port: <strong>${displayPort}</strong></span>
              <button class="btn-secondary plate-button" style="height: 28px; padding: 0 12px; font-size: 11px; border-radius: 9999px;" id="btnCopyPort">Copy</button>
            </div>
            ` : ''}
          </div>

          <!-- Players Card -->
          <div class="plate" style="flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; border-radius: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 13px; font-weight: 700; color: var(--ink-secondary);">${isOnline ? 'Current Player' : 'Players'}</span>
              <span class="lamp active"></span>
            </div>
            <div class="member-list" id="sessionMemberList">
              ${(remote?.members || [{ id: store.get().profile.id, name: store.get().profile.name, forSeconds: 0 }])
                .map(
                  (m) => `
                <div class="member-row" style="border-radius: 18px;">
                  <div class="chip-avatar">${m.name.slice(0, 2).toUpperCase()}</div>
                  <div style="flex: 1;">
                    <div style="font-size: 14px;">${m.name}</div>
                    <div style="font-size: 11px; color: var(--ink-secondary);">${m.forSeconds ? Math.floor(m.forSeconds / 60) + 'm in room' : 'Connected'}</div>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>

        <!-- Right Panel: Actions and Steps -->
        <div class="session-right">
          <div style="font-size: 20px; font-weight: 900; margin-bottom: 4px;">
            ${session.rom ? session.rom.displayName : 'Multiplayer Session'}
          </div>
          <div style="font-size: 14px; color: var(--ink-secondary); margin-bottom: 12px;">
            ${isOnline ? 'Online play via public community server' : (isHost ? 'You are hosting this session' : 'You are joined as a guest')}
          </div>

          <!-- Step 1 -->
          <div class="step-card" style="border-radius: 20px;">
            <div class="step-num ${session.step1Done ? 'done' : ''}">
              ${session.step1Done ? `&#10003;` : '1'}
            </div>
            <div class="step-info">
              <div class="step-title">Configure Network & Emulator</div>
              <div class="step-desc">
                ${isOnline ? 'Online multiplayer connection ready' : (session.step1Done ? (session.wireguardNative === false ? 'Tunnel config prepared (manual sudo elevation required)' : 'WireGuard tunnel active and emulator prepared') : 'Connecting to session relay...')}
              </div>
            </div>
            ${!session.step1Done && session.netplayBusy ? `<div class="spinner"></div>` : ''}
          </div>

          ${
            !isOnline && session.wireguardNative === false
              ? `
            <div class="plate" style="padding: 16px; border-left: 4px solid var(--compat-partial); display: flex; flex-direction: column; gap: 8px; border-radius: 20px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="lamp" style="background-color: var(--compat-partial);"></span>
                <strong style="font-size: 13px;">Tunnel Elevation Required</strong>
              </div>
              <div style="font-size: 12px; color: var(--ink-secondary); line-height: 1.4;">
                WireGuard requires root/sudo privileges to activate the interface on your OS. Run in terminal:
              </div>
              <div style="display: flex; gap: 8px; align-items: center; background: var(--plate-bg-low); padding: 8px 12px; border-radius: 16px; font-family: monospace; font-size: 12px;">
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="wgCmdText">sudo wg-quick up "${session.wireguardConfigPath || 'emufii0.conf'}"</span>
                <button class="btn-secondary plate-button" id="btnCopyWgCmd" style="height: 28px; padding: 0 12px; font-size: 11px; border-radius: 9999px;">Copy</button>
              </div>
            </div>
          `
              : ''
          }

          <!-- Step 2 -->
          <div class="step-card" style="border-radius: 20px;">
            <div class="step-num ${session.step2Done ? 'done' : ''}">
              ${session.step2Done ? `&#10003;` : '2'}
            </div>
            <div class="step-info">
              <div class="step-title">Multiplayer In-Game</div>
              <div class="step-desc">
                ${isOnline ? (session.step2Done ? 'Emulator launched' : 'Ready to start game in emulator') : (isHost ? 'Host your room in the emulator' : (remote?.hostReady ? 'Host is ready! Launch emulator to connect' : 'Waiting for host to open room...'))}
              </div>
            </div>
            <button class="plate-button ${session.step2Done ? '' : 'btn-primary'}" id="btnLaunchEmu" style="width: auto; height: 38px; padding: 0 20px; font-size: 13px; border-radius: 9999px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-weight: 800; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); ${
              session.step2Done
                ? 'background: #22c55e !important; color: #ffffff !important; border: 1px solid #16a34a !important; box-shadow: 0 4px 18px rgba(34, 197, 94, 0.4);'
                : ''
            }">
              ${
                session.launching
                  ? `<div class="spinner" style="width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, 0.25); border-top-color: currentColor; border-radius: 50%; animation: spin 800ms linear infinite;"></div><span>Launching...</span>`
                  : session.step2Done
                  ? `✓ Launched`
                  : `Launch`
              }
            </button>
          </div>

          <div style="flex: 1;"></div>

          <!-- Leave Button -->
          <div style="display: flex; justify-content: flex-end;">
            <button class="btn-secondary plate-button" id="btnLeaveSession" style="color: var(--compat-broken); border-color: rgba(224, 69, 123, 0.3); border-radius: 9999px; height: 42px; padding: 0 24px;">
              ${isOnline ? 'Exit Game' : 'Leave Session'}
            </button>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    container.querySelector('#btnCopyCode')?.addEventListener('click', () => {
      navigator.clipboard.writeText(session.code);
      sfx.play('click');
    });

    container.querySelector('#btnCopyIp')?.addEventListener('click', () => {
      navigator.clipboard.writeText(displayIp);
      sfx.play('click');
    });

    container.querySelector('#btnCopyPort')?.addEventListener('click', () => {
      navigator.clipboard.writeText(displayPort.toString());
      sfx.play('click');
    });

    container.querySelector('#btnCopyWgCmd')?.addEventListener('click', () => {
      const cmd = `sudo wg-quick up "${session.wireguardConfigPath || 'emufii0.conf'}"`;
      navigator.clipboard.writeText(cmd);
      sfx.play('click');
    });

    container.querySelector('#btnLaunchEmu')?.addEventListener('click', async () => {
      sfx.play('click');
      const current = store.get().activeSession;
      if (!current || !current.rom || current.launching) return;

      store.set({ activeSession: { ...current, launching: true } });

      const ok = await ensureEmulator(current.rom.console);
      if (!ok) {
        const reset = store.get().activeSession;
        if (reset) store.set({ activeSession: { ...reset, launching: false } });
        return;
      }

      try {
        if (store.get().settings.shareLastGame !== false && current.rom) {
          emuApi.coordinator
            .announceLastGame(
              store.get().profile.id,
              current.rom.displayName,
              current.rom.titleId || current.rom.productCode
            )
            .catch(() => {});
        }

        const res = await emuApi.emulators.launchGame(current.rom.console, {
          romPath: current.rom.filePath,
          isHost,
          code: current.code,
          hostIp: displayIp,
          port: displayPort,
          onlineMode: current.code === 'ONLINE',
          discId: current.rom.discId || current.rom.titleId,
          ps2ElfCrc: current.rom.ps2ElfCrc,
        });

        const updated = store.get().activeSession;
        if (updated) {
          store.set({
            activeSession: {
              ...updated,
              step2Done: res?.success === true,
              launching: false,
            },
          });
        }

        if (res && !res.success) {
          alert(res.message || `Could not launch ${current.rom.console} emulator. Check Settings to set its executable path.`);
        }
      } catch (err: any) {
        const updated = store.get().activeSession;
        if (updated) {
          store.set({
            activeSession: {
              ...updated,
              launching: false,
            },
          });
        }
        alert('Failed to launch emulator: ' + (err.message || err));
      }
    });

    container.querySelector('#btnLeaveSession')?.addEventListener('click', async () => {
      sfx.play('click');
      clearInterval(pollTimer);
      try {
        await emuApi.emulators.killActiveGame?.();
      } catch {}
      if (session.code !== 'ONLINE') {
        try {
          if (isHost && session.token) {
            await emuApi.coordinator.deleteSession(session.code, session.token);
          } else {
            await emuApi.coordinator.leaveSession(session.code, store.get().profile.id);
          }
        } catch {}
        await emuApi.wireguard.down();
      }
      store.set({ activeSession: null });
      store.navigate('library');
    });
  };

  update();

  const unsubscribe = store.subscribe((state) => {
    if (state.currentScreen === 'session') {
      update();
    }
  });

  const unsubscribeGameClosed = emuApi?.emulators?.onGameClosed?.(() => {
    const current = store.get().activeSession;
    if (current && current.step2Done) {
      store.set({ activeSession: { ...current, step2Done: false } });
    }
  });

  // Polling loop for session heartbeats and members
  const poll = async () => {
    const session = store.get().activeSession;
    if (!session || session.code === 'ONLINE') return;
    try {
      await emuApi.coordinator.heartbeat(session.code, store.get().profile.id, store.get().profile.name);
      const remote = await emuApi.coordinator.getSession(session.code);
      const current = store.get().activeSession;
      if (current && current.code === session.code) {
        store.set({ activeSession: { ...current, remote } });
      }
    } catch {}
  };

  pollTimer = setInterval(poll, 4000);
  return () => {
    clearInterval(pollTimer);
    unsubscribe();
    unsubscribeGameClosed?.();
  };
}
