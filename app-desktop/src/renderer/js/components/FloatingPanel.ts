import { store } from '../state.js';
import { sfx } from '../sfx.js';
import { formatFriendCode, isValidFriendCode } from '../../../main/profile/friendCode.js';
import type { OpenSession } from '../../../main/network/coordinator.js';

export type FloatingTab = 'sessions' | 'join' | 'friends' | 'profile' | 'server';

let currentTab: FloatingTab = 'sessions';
let isOpen = false;
let enteredJoinCode = '';
let keydownListener: ((e: KeyboardEvent) => void) | null = null;
let friendStatuses: any = { present: {}, names: {}, lastGames: {} };
let publicSessions: OpenSession[] = [];
let loadingSessions = false;
let sessionsLoaded = false;
let currentPresence: 'online' | 'idle' | 'offline' = (localStorage.getItem('emufii_presence') as any) || 'online';
let presenceMenuOpen = false;

export function isFloatingPanelOpen(): boolean {
  return isOpen;
}

export function getFloatingPanelTab(): FloatingTab | null {
  return isOpen ? currentTab : null;
}

export function positionFloatingPanel(tab: FloatingTab) {
  const panel = document.getElementById('floatingCloudPanel');
  if (!panel) return;

  const screenWidth = window.innerWidth;
  const isServer = tab === 'server';
  const isProfile = tab === 'profile';
  const isJoin = tab === 'join';
  const targetWidth = isServer ? 620 : (isProfile ? 440 : 520);
  const panelWidth = Math.min(targetWidth, screenWidth - 32);
  panel.style.width = `${panelWidth}px`;

  // Centered in window for Join Session panel
  if (isJoin) {
    const left = Math.round((screenWidth - panelWidth) / 2);
    const top = Math.max(76, Math.round((window.innerHeight - 520) / 2));
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.transformOrigin = '50% 10%';
    return;
  }

  let triggerEl: HTMLElement | null = null;
  if (tab === 'profile') {
    triggerEl = document.getElementById('headerProfileBtn');
  } else if (tab === 'server') {
    triggerEl = document.getElementById('vpsStatusChip');
  } else if (tab === 'friends') {
    triggerEl = document.getElementById('headerFriendsBtn');
  } else if (tab === 'sessions') {
    triggerEl = document.getElementById('headerFinderBtn');
  }

  if (triggerEl) {
    const rect = triggerEl.getBoundingClientRect();
    const triggerCenter = rect.left + rect.width / 2;

    let left = triggerCenter - panelWidth / 2;
    const padding = 16;
    if (left < padding) left = padding;
    if (left + panelWidth > screenWidth - padding) {
      left = screenWidth - panelWidth - padding;
    }

    panel.style.top = `${Math.round(rect.bottom + 8)}px`;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.right = 'auto';

    const originPercent = Math.max(5, Math.min(95, Math.round(((triggerCenter - left) / panelWidth) * 100)));
    panel.style.transformOrigin = `${originPercent}% 0%`;
  } else {
    panel.style.top = '56px';
    panel.style.left = 'auto';
    panel.style.right = '24px';
    panel.style.transformOrigin = 'top right';
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (isOpen) {
      positionFloatingPanel(currentTab);
    }
  });
}

export function toggleFloatingPanel(tab: FloatingTab) {
  if (isOpen && currentTab === tab) {
    closeFloatingPanel();
  } else {
    openFloatingPanel(tab);
  }
}

export function openFloatingPanel(tab: FloatingTab = 'sessions') {
  currentTab = tab;
  isOpen = true;
  presenceMenuOpen = false;
  sfx.play('toggle');

  const panel = document.getElementById('floatingCloudPanel');
  const backdrop = document.getElementById('floatingPanelBackdrop');
  if (!panel) return;

  // Highlight active header button
  updateHeaderActiveState(tab);

  // Render content
  renderFloatingPanel();

  // Position dynamically below respective trigger button
  positionFloatingPanel(tab);

  // If opening sessions and not yet loaded, load now
  if (tab === 'sessions' && !sessionsLoaded && !loadingSessions) {
    refreshSessions();
  }

  // Show panel with smooth arrive animation
  panel.classList.remove('closing');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');

  if (backdrop) {
    backdrop.classList.add('open');
  }

  // Attach global keyboard listener for typing in Join and Escape
  attachKeyboard();
}

export function closeFloatingPanel() {
  if (!isOpen) return;
  isOpen = false;
  sfx.play('toggle');

  const panel = document.getElementById('floatingCloudPanel');
  const backdrop = document.getElementById('floatingPanelBackdrop');

  updateHeaderActiveState(null);
  detachKeyboard();

  if (panel) {
    panel.classList.remove('open');
    panel.classList.add('closing');
    panel.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      panel.classList.remove('closing');
    }, 220);
  }

  if (backdrop) {
    backdrop.classList.remove('open');
  }
}

function updateHeaderActiveState(tab: FloatingTab | null) {
  document.getElementById('headerFinderBtn')?.classList.toggle('active', tab === 'sessions');
  document.getElementById('headerJoinBtn')?.classList.toggle('active', tab === 'join');
  document.getElementById('headerFriendsBtn')?.classList.toggle('active', tab === 'friends');
  document.getElementById('headerProfileBtn')?.classList.toggle('active', tab === 'profile');
  document.getElementById('vpsStatusChip')?.classList.toggle('active', tab === 'server');
}

function attachKeyboard() {
  detachKeyboard();
  keydownListener = (e: KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === 'Escape') {
      closeFloatingPanel();
      return;
    }

    // Only process keypad input if currently on 'join' tab and not typing into an input/textarea
    if (currentTab === 'join') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        removeJoinChar();
        return;
      }
      if (e.key === 'Enter' && enteredJoinCode.length === 6) {
        e.preventDefault();
        e.stopPropagation();
        submitJoinSession();
        return;
      }
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        addJoinChar(e.key.toUpperCase());
      }
    }
  };
  window.addEventListener('keydown', keydownListener, true);
}

function detachKeyboard() {
  if (keydownListener) {
    window.removeEventListener('keydown', keydownListener, true);
    keydownListener = null;
  }
}

function getTabHeaderInfo(tab: FloatingTab, profile: any) {
  switch (tab) {
    case 'server':
      return {
        title: 'Emufii server',
        subtitle: 'Select relay region for coordinator',
        icon: `<span style="font-size: 19px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;">🌐</span>`,
        action: '',
      };
    case 'sessions':
      return {
        title: 'Open Sessions',
        subtitle: 'Active netplay rooms on coordinator',
        icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" class="sessions-icon" style="color: var(--accent-bright); stroke: var(--accent-bright);"><rect x="2" y="3" width="9.5" height="7.5" rx="2" stroke="currentColor" stroke-width="2" fill="none" /><rect x="12.5" y="13.5" width="9.5" height="7.5" rx="2" stroke="currentColor" stroke-width="2" fill="none" /><line x1="6.5" y1="10.5" x2="17.5" y2="13.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 3.8" /></svg>`,
        action: `
          <button class="btn-secondary plate-button" id="btnRefreshFloatingSessions" style="height: 30px; padding: 0 12px; font-size: 11px; display: inline-flex; align-items: center; gap: 6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            <span>Refresh</span>
          </button>
        `,
      };
    case 'join':
      return {
        title: 'Join Session',
        subtitle: "Enter friend's 6-character room code",
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
        action: '',
      };
    case 'friends':
      return {
        title: 'Friends',
        subtitle: 'Online status and friend codes',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        action: `
          <button class="btn-secondary plate-button" id="btnFloatingRefreshFriends" style="height: 30px; padding: 0 12px; font-size: 11px; display: inline-flex; align-items: center; gap: 6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            <span>Refresh</span>
          </button>
        `,
      };
    case 'profile':
      return {
        title: profile.name || 'Player Profile',
        subtitle: 'Visible to other players in lobbies',
        icon: profile.avatarDataUrl
          ? `<img src="${profile.avatarDataUrl}" style="width: 26px; height: 26px; border-radius: 50%; object-fit: cover;">`
          : `<div class="chip-avatar" style="width: 26px; height: 26px; font-size: 11px; margin: 0;">${(profile.name || 'J').slice(0, 2).toUpperCase()}</div>`,
        action: '',
      };
  }
}

function renderFloatingPanel() {
  const panel = document.getElementById('floatingCloudPanel');
  if (!panel) return;

  const profile = store.get().profile;
  const headerInfo = getTabHeaderInfo(currentTab, profile);

  panel.innerHTML = `
    <div class="floating-panel-container">
      <!-- Floating Panel Header -->
      <div class="floating-panel-header">
        <div class="floating-panel-heading-wrap">
          <div class="floating-panel-icon-bubble">
            ${headerInfo.icon}
          </div>
          <div>
            <h3 class="floating-pane-title">${headerInfo.title}</h3>
            <p class="floating-pane-subtitle">${headerInfo.subtitle}</p>
          </div>
        </div>
        <div class="floating-panel-actions">
          ${headerInfo.action}
        </div>
      </div>

      <!-- Floating Body View -->
      <div class="floating-panel-body" id="floatingPanelBody">
        ${
          currentTab === 'server'
            ? renderServerTab()
            : currentTab === 'sessions'
            ? renderSessionsTab()
            : currentTab === 'join'
            ? renderJoinTab()
            : currentTab === 'friends'
            ? renderFriendsTab()
            : renderProfileTab()
        }
      </div>
    </div>
  `;

  // Attach tab-specific listeners
  if (currentTab === 'server') {
    attachServerListeners(panel);
  } else if (currentTab === 'sessions') {
    attachSessionsListeners(panel);
  } else if (currentTab === 'join') {
    attachJoinListeners(panel);
  } else if (currentTab === 'friends') {
    attachFriendsListeners(panel);
  } else if (currentTab === 'profile') {
    attachProfileListeners(panel);
  }
}

// -------------------------------------------------------------
// SERVER PICKER TAB (Matching Android ServerPicker & VpsLamp)
// -------------------------------------------------------------
function renderSignalBars(rtt: number | null): string {
  const lit = rtt === null ? 0 : rtt < 60 ? 3 : rtt < 130 ? 2 : 1;
  const onColor = rtt === null || rtt < 60 ? '#10B981' : rtt < 130 ? '#F2B233' : '#EF4444';
  const offColor = 'rgba(255, 255, 255, 0.15)';

  const heights = [8, 13, 18];
  const barsHtml = heights
    .map(
      (h, i) =>
        `<span class="signal-bar" style="height: ${h}px; background-color: ${i < lit ? onColor : offColor};"></span>`
    )
    .join('');

  return `<div class="server-signal-bars" title="${rtt !== null ? `${Math.round(rtt)} ms` : 'Latency'}">${barsHtml}</div>`;
}

function renderServerTab(): string {
  const currentRegion = localStorage.getItem('emufii_server_region') || 'auto';

  const servers = [
    { id: 'auto', title: 'Automatic', badge: '🌐', rtt: null, detail: 'Now: US East (NY)', isAuto: true },
    { id: 'eu', title: 'Europe', badge: '🇪🇺', rtt: 162, detail: '162 ms', isAuto: false },
    { id: 'na', title: 'Canada (Montréal)', badge: '🇨🇦', rtt: 76, detail: '76 ms', isAuto: false },
    { id: 'usw', title: 'US West (Seattle)', badge: '🇺🇸', rtt: 127, detail: '127 ms', isAuto: false },
    { id: 'jp', title: 'Japan (Tokyo)', badge: '🇯🇵', rtt: 219, detail: '219 ms', isAuto: false },
    { id: 'use', title: 'US East (NY)', badge: '🇺🇸', rtt: 68, detail: '68 ms', isAuto: false },
  ];

  const renderCard = (opt: any) => {
    const isChosen = opt.id === currentRegion;
    return `
      <div class="server-picker-row ${isChosen ? 'chosen' : ''}" data-region="${opt.id}" tabindex="0">
        <div class="server-picker-badge ${isChosen ? 'chosen' : ''}">
          <span>${opt.badge}</span>
        </div>
        <div class="server-picker-meta">
          <div class="server-picker-name" title="${opt.title}">${opt.title}</div>
          <div class="server-picker-detail" title="${opt.detail}">${opt.detail}</div>
        </div>
        <div class="server-signal-bars-slot">
          ${!opt.isAuto ? renderSignalBars(opt.rtt) : ''}
        </div>
        <div class="server-picker-check-slot">
          ${isChosen ? `<div class="server-picker-check-bead">✓</div>` : ''}
        </div>
      </div>
    `;
  };

  return `
    <div class="floating-tab-pane server-picker-pane">
      <div class="server-picker-grid">
        ${servers.map(renderCard).join('')}
      </div>
    </div>
  `;
}

function attachServerListeners(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>('.server-picker-row').forEach((row) => {
    row.addEventListener('click', () => {
      const regionId = row.dataset.region || 'auto';
      sfx.play('click');
      localStorage.setItem('emufii_server_region', regionId);

      const regionNames: Record<string, string> = {
        auto: 'US East (NY)',
        use: 'US East (NY)',
        usw: 'US West (Seattle)',
        eu: 'Europe',
        na: 'Canada (Montréal)',
        jp: 'Japan (Tokyo)',
      };
      const label = regionNames[regionId] || 'US East (NY)';
      const vpsText = document.getElementById('vpsText');
      if (vpsText) {
        vpsText.innerHTML = `Online &bull; ${label}`;
      }

      closeFloatingPanel();
    });
  });
}

// -------------------------------------------------------------
// SESSIONS TAB
// -------------------------------------------------------------
function renderSessionsTab(): string {
  return `
    <div class="floating-tab-pane">
      <div id="floatingSessionsList" style="display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto;">
        ${
          loadingSessions
            ? `
          <div style="display: flex; justify-content: center; padding: 40px;">
            <div class="spinner"></div>
          </div>
        `
            : publicSessions.length === 0
            ? `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px 16px; gap: 8px; text-align: center; color: var(--ink-secondary);">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" class="sessions-icon" style="opacity: 0.45; color: var(--accent-bright); stroke: var(--accent-bright);"><rect x="2" y="3" width="9.5" height="7.5" rx="2" stroke="currentColor" stroke-width="2" fill="none" /><rect x="12.5" y="13.5" width="9.5" height="7.5" rx="2" stroke="currentColor" stroke-width="2" fill="none" /><line x1="6.5" y1="10.5" x2="17.5" y2="13.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 3.8" /></svg>
            <div style="font-weight: 700; font-size: 14px;">No Open Sessions Active</div>
            <div style="font-size: 12px;">Create a session from your library or join with a 6-character room code.</div>
          </div>
        `
            : publicSessions
                .map(
                  (s) => `
            <div class="floating-session-row plate plate-button" data-code="${s.code}">
              <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1 1 auto; overflow: hidden; margin-right: 12px;">
                <span class="floating-session-code" style="flex-shrink: 0;">${s.code}</span>
                <div style="min-width: 0; flex: 1 1 auto; overflow: hidden;">
                  <div style="font-weight: 800; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${s.romTitle || 'Custom Session'}</div>
                  <div style="font-size: 11px; color: var(--ink-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    Hosted by ${s.hostName || 'Player'} · ${s.players} player(s) · ${Math.floor(s.ageSeconds / 60)}m ago
                  </div>
                </div>
              </div>
              <button class="btn-primary plate-button btn-join-floating-session" data-code="${s.code}">
                Join
              </button>
            </div>
          `
                )
                .join('')
        }
      </div>
    </div>
  `;
}

function attachSessionsListeners(panel: HTMLElement) {
  panel.querySelector('#btnRefreshFloatingSessions')?.addEventListener('click', () => {
    sfx.play('click');
    refreshSessions();
  });

  panel.querySelectorAll('.btn-join-floating-session').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = (e.currentTarget as HTMLElement).dataset.code;
      if (code) {
        connectToSession(code);
      }
    });
  });

  panel.querySelectorAll('.floating-session-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      const code = (e.currentTarget as HTMLElement).dataset.code;
      if (code) {
        connectToSession(code);
      }
    });
  });
}

async function refreshSessions() {
  if (loadingSessions) return;
  const emuApi = (window as any).emufii;
  loadingSessions = true;
  renderFloatingPanel();

  try {
    const timeout = new Promise<OpenSession[]>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), 6000)
    );
    publicSessions = await Promise.race([
      emuApi.coordinator.listSessions(),
      timeout,
    ]);
  } catch {
    publicSessions = [];
  } finally {
    loadingSessions = false;
    sessionsLoaded = true;
    renderFloatingPanel();
  }
}

// -------------------------------------------------------------
// JOIN TAB
// -------------------------------------------------------------
function renderJoinTab(): string {
  return `
    <div class="floating-tab-pane" style="display: flex; flex-direction: column; align-items: center; padding-top: 4px;">
      <!-- 6-character Code Boxes -->
      <div style="display: flex; gap: 8px; margin: 4px 0 12px 0;" id="floatingJoinBoxes">
        ${Array.from({ length: 6 })
          .map(
            (_, i) => `
          <div class="join-code-box plate ${enteredJoinCode[i] ? 'filled' : ''}" id="fJoinBox-${i}">
            ${enteredJoinCode[i] || ''}
          </div>
        `
          )
          .join('')}
      </div>

      <!-- Quick Paste Button -->
      <button class="btn-secondary plate-button" id="btnFloatingPaste" style="height: 28px; padding: 0 12px; font-size: 11px; display: flex; align-items: center; gap: 6px; margin-bottom: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
        Paste from Clipboard
      </button>

      <!-- QWERTY Keypad -->
      <div class="code-keyboard-container">
        <div class="code-keyboard-row">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((c) => `<button class="code-key plate-button" data-char="${c}">${c}</button>`).join('')}
        </div>
        <div class="code-keyboard-row">
          ${['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((c) => `<button class="code-key plate-button" data-char="${c}">${c}</button>`).join('')}
        </div>
        <div class="code-keyboard-row">
          ${['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'].map((c) => `<button class="code-key plate-button" data-char="${c}">${c}</button>`).join('')}
        </div>
        <div class="code-keyboard-row">
          <div style="flex: 0.5; max-width: 20px;"></div>
          ${['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((c) => `<button class="code-key plate-button" data-char="${c}">${c}</button>`).join('')}
          <button class="code-key wide plate-button" id="btnFloatingKeypadBack" title="Backspace" style="font-size: 16px; font-weight: bold;">&larr;</button>
        </div>
      </div>

      <button class="btn-primary plate-button" id="btnSubmitFloatingJoin" style="width: 100%; max-width: 440px; height: 40px; margin-top: 14px; opacity: ${enteredJoinCode.length === 6 ? '1' : '0.5'};" ${enteredJoinCode.length === 6 ? '' : 'disabled'}>
        Join Session
      </button>
    </div>
  `;
}

function flashKey(selector: string) {
  const btn = document.querySelector<HTMLElement>(selector);
  if (btn) {
    btn.classList.add('key-pressed');
    setTimeout(() => {
      btn.classList.remove('key-pressed');
    }, 140);
  }
}

function attachJoinListeners(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>('.code-key[data-char]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const c = (e.currentTarget as HTMLElement).dataset.char;
      (e.currentTarget as HTMLElement).blur();
      if (c) addJoinChar(c);
    });
  });

  panel.querySelector('#btnFloatingKeypadBack')?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).blur();
    removeJoinChar();
  });

  panel.querySelector('#btnFloatingPaste')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleaned = text.trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
      if (cleaned) {
        enteredJoinCode = cleaned;
        sfx.play('pop');
        updateJoinBoxesUI();
      }
    } catch {}
  });

  panel.querySelector('#btnSubmitFloatingJoin')?.addEventListener('click', () => {
    submitJoinSession();
  });
}

function addJoinChar(c: string) {
  const upper = c.toUpperCase();
  flashKey(`.code-key[data-char="${upper}"]`);
  if (enteredJoinCode.length < 6) {
    enteredJoinCode += upper;
    sfx.play('tick');
    updateJoinBoxesUI();
    if (enteredJoinCode.length === 6) {
      sfx.play('pop');
    }
  }
}

function removeJoinChar() {
  flashKey('#btnFloatingKeypadBack');
  if (enteredJoinCode.length > 0) {
    enteredJoinCode = enteredJoinCode.slice(0, -1);
    sfx.play('tick');
    updateJoinBoxesUI();
  }
}

function updateJoinBoxesUI() {
  for (let i = 0; i < 6; i++) {
    const box = document.getElementById(`fJoinBox-${i}`);
    if (box) {
      box.textContent = enteredJoinCode[i] || '';
      box.classList.toggle('filled', !!enteredJoinCode[i]);
    }
  }
  const submitBtn = document.getElementById('btnSubmitFloatingJoin') as HTMLButtonElement;
  if (submitBtn) {
    submitBtn.disabled = enteredJoinCode.length !== 6;
    submitBtn.style.opacity = enteredJoinCode.length === 6 ? '1' : '0.5';
  }
}

async function submitJoinSession() {
  if (enteredJoinCode.length !== 6) return;
  connectToSession(enteredJoinCode);
}

async function connectToSession(code: string) {
  sfx.play('click');
  const emuApi = (window as any).emufii;
  const profile = store.get().profile;

  try {
    // 1. Fetch remote session
    const remote = await emuApi.coordinator.getSession(code);

    // 2. Claim WireGuard address
    const config = await emuApi.config.get();
    const wgInfo = await emuApi.coordinator.claimAddress(
      code,
      config.wgKeys.publicKey,
      profile.name,
      profile.id
    );

    // 3. Up tunnel
    const wgRes = await emuApi.wireguard.up(wgInfo);

    // 4. Update store and navigate
    store.set({
      activeSession: {
        code,
        isHost: false,
        token: null,
        remote,
        wireguard: wgInfo,
        wireguardConfigPath: wgRes?.configPath || null,
        wireguardNative: wgRes?.isNativeActive !== false,
        step1Done: true,
        step2Done: false,
        netplayBusy: false,
      },
    });

    sfx.play('confirm');
    closeFloatingPanel();
    store.navigate('session');
  } catch (err: any) {
    alert('Could not join session: ' + (err.message || 'Session not found'));
  }
}

// -------------------------------------------------------------
// FRIENDS TAB
// -------------------------------------------------------------
function renderFriendsTab(): string {
  const state = store.get();
  const friends = state.settings.friends || [];

  return `
    <div class="floating-tab-pane">
      <!-- Add Friend Box -->
      <div style="background: var(--plate-bg-low); border: 1px solid var(--plate-border); border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 14px;">
        <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--ink-secondary); margin-bottom: 8px;">Add a Friend</div>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="inputFloatingFriendCode" class="cloud-input" placeholder="XXXX-XXXX-XXXX" maxlength="14" style="font-family: var(--font-family); font-weight: 700; text-transform: uppercase; height: 36px; font-size: 13px; flex: 1;">
          <button class="btn-primary plate-button" id="btnFloatingAddFriend" style="width: auto; height: 36px; padding: 0 18px; font-size: 12px;">
            Add
          </button>
        </div>
        <div id="floatingFriendError" style="font-size: 11px; color: var(--compat-broken); margin-top: 6px; display: none;">
          Invalid Crockford friend code or checksum.
        </div>
      </div>

      <!-- Friends List -->
      <div>
        <div style="margin-bottom: 8px;">
          <label class="cloud-section-label">Friends (${friends.length})</label>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; max-height: 250px; overflow-y: auto;">
          ${
            friends.length === 0
              ? `
            <div style="padding: 28px 12px; text-align: center; color: var(--ink-secondary); font-size: 12px;">
              No friends added yet. Enter a friend code above!
            </div>
          `
              : friends
                  .map((code) => {
                    const presence = friendStatuses.present?.[code];
                    const isOnline = !!presence;
                    const customNick = state.settings.friendNicknames?.[code];
                    const name = customNick || friendStatuses.names?.[code] || 'Friend';
                    const lastGame = friendStatuses.lastGames?.[code];

                    return `
                <div class="plate" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: var(--radius-sm);">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="position: relative;">
                      <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-shelf); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; color: var(--accent-bright); border: 1px solid var(--plate-border);">
                        ${name.slice(0, 2).toUpperCase()}
                      </div>
                      <div style="position: absolute; bottom: 0; right: 0; width: 8px; height: 8px; border-radius: 50%; background: ${isOnline ? 'var(--compat-perfect)' : 'var(--ink-tertiary)'}; border: 1.5px solid var(--plate-bg);"></div>
                    </div>
                    <div>
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-weight: 700; font-size: 13px;">${name}</span>
                        <span style="font-size: 10px; font-family: var(--font-family); color: var(--ink-secondary);">${formatFriendCode(code)}</span>
                      </div>
                      <div style="font-size: 10px; color: ${isOnline ? 'var(--compat-perfect)' : 'var(--ink-secondary);'}; margin-top: 1px;">
                        ${isOnline ? `Online · ${lastGame || 'In menu'}` : 'Offline'}
                      </div>
                    </div>
                  </div>

                  <div style="display: flex; gap: 4px;">
                    <button class="btn-secondary plate-button btn-f-rename" data-code="${code}" style="height: 24px; padding: 0 8px; font-size: 10px;">
                      Rename
                    </button>
                    <button class="btn-secondary plate-button btn-f-remove" data-code="${code}" style="height: 24px; padding: 0 8px; font-size: 10px; color: var(--compat-broken);">
                      Remove
                    </button>
                  </div>
                </div>
              `;
                  })
                  .join('')
          }
        </div>
      </div>
    </div>
  `;
}

function attachFriendsListeners(panel: HTMLElement) {
  const emuApi = (window as any).emufii;

  panel.querySelector('#btnFloatingRefreshFriends')?.addEventListener('click', async () => {
    sfx.play('click');
    const friends = store.get().settings.friends || [];
    if (friends.length > 0) {
      try {
        friendStatuses = await emuApi.coordinator.friendStatuses(friends);
      } catch {}
    }
    renderFloatingPanel();
  });

  const submitAddFriend = async () => {
    const codeInput = panel.querySelector('#inputFloatingFriendCode') as HTMLInputElement;
    const errorEl = panel.querySelector('#floatingFriendError') as HTMLElement;
    if (!codeInput) return;

    const raw = codeInput.value.trim().toUpperCase().replace(/[^0-9A-TV-Z]/g, '');
    if (!isValidFriendCode(raw)) {
      if (errorEl) errorEl.style.display = 'block';
      sfx.play('tick');
      return;
    }

    if (errorEl) errorEl.style.display = 'none';
    sfx.play('confirm');
    await emuApi.config.addFriend(raw);
    const updated = await emuApi.config.get();
    store.set({ settings: updated.settings });

    try {
      friendStatuses = await emuApi.coordinator.friendStatuses(updated.settings.friends);
    } catch {}

    renderFloatingPanel();
  };

  panel.querySelector('#btnFloatingAddFriend')?.addEventListener('click', submitAddFriend);
  panel.querySelector<HTMLInputElement>('#inputFloatingFriendCode')?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      submitAddFriend();
    }
  });

  panel.querySelectorAll('.btn-f-rename').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      sfx.play('click');
      const code = (e.currentTarget as HTMLElement).dataset.code;
      if (!code) return;
      const current = store.get().settings.friendNicknames?.[code] || '';
      const newNick = prompt('Enter a nickname for this friend:', current);
      if (newNick !== null) {
        await emuApi.config.addFriend(code, newNick.trim() || undefined);
        const updated = await emuApi.config.get();
        store.set({ settings: updated.settings });
        renderFloatingPanel();
      }
    });
  });

  panel.querySelectorAll('.btn-f-remove').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      sfx.play('click');
      const code = (e.currentTarget as HTMLElement).dataset.code;
      if (!code) return;
      if (confirm('Remove this friend?')) {
        await emuApi.config.removeFriend(code);
        const updated = await emuApi.config.get();
        store.set({ settings: updated.settings });
        renderFloatingPanel();
      }
    });
  });
}

// -------------------------------------------------------------
// PROFILE TAB
// -------------------------------------------------------------
function renderProfileTab(): string {
  const profile = store.get().profile;

  return `
    <div class="floating-tab-pane">
      <!-- Unified Seamless Profile Card (No separated boxes, no divider lines) -->
      <div class="profile-unified-card">
        <!-- 1. Header: Avatar + Nickname + Presence -->
        <div class="profile-unified-top">
          <div class="profile-unified-user">
            <!-- Profile Avatar -->
            <div class="profile-avatar-large" style="width: 44px; height: 44px; font-size: 18px; flex-shrink: 0;">
              ${
                profile.avatarDataUrl
                  ? `<img src="${profile.avatarDataUrl}" alt="${profile.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`
                  : `<span>${(profile.name || 'J').slice(0, 2).toUpperCase()}</span>`
              }
            </div>

            <!-- Presence Light between Icon and Nickname -->
            <span class="user-status-dot ${currentPresence}" id="panelProfileStatusDot"></span>

            <!-- Inline Clickable Nickname -->
            <div id="inlineNickWrap" style="display: flex; align-items: center;">
              <span id="inlineNickDisplay" class="profile-nickname-clickable" title="Click to rename" style="font-weight: 800; font-size: 16px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                <span>${profile.name || 'Joueur'}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity: 0.4;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </span>
              <input type="text" id="inlineNickInput" value="${profile.name || 'Joueur'}" maxlength="24" class="cloud-input" style="display: none; height: 30px; font-size: 14px; font-weight: 800; width: 140px; padding: 2px 8px;">
            </div>
          </div>

          <!-- Presence Status Selector Button -->
          <div style="position: relative;" id="presenceDropdownContainer">
            <button class="chip plate-button" id="btnTogglePresence" style="height: 30px; padding: 0 12px; font-size: 11px; gap: 7px; border: none; background: rgba(255, 255, 255, 0.06);">
              <span class="user-status-dot ${currentPresence}"></span>
              <span id="btnPresenceText" style="text-transform: capitalize; font-weight: 700;">${currentPresence}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>

            <!-- Presence Menu Dropdown -->
            <div id="presenceMenu" class="plate" style="display: ${presenceMenuOpen ? 'flex' : 'none'}; flex-direction: column; position: absolute; top: calc(100% + 6px); right: 0; z-index: 120; min-width: 130px; padding: 4px; gap: 2px; border-radius: var(--radius-sm); box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
              <button class="presence-option-btn plate-button ${currentPresence === 'online' ? 'active' : ''}" data-presence="online">
                <span class="user-status-dot online"></span>
                <span>Online</span>
              </button>
              <button class="presence-option-btn plate-button ${currentPresence === 'idle' ? 'active' : ''}" data-presence="idle">
                <span class="user-status-dot idle"></span>
                <span>Idle</span>
              </button>
              <button class="presence-option-btn plate-button ${currentPresence === 'offline' ? 'active' : ''}" data-presence="offline">
                <span class="user-status-dot offline"></span>
                <span>Offline</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Avatar Controls -->
        <div style="display: flex; gap: 8px;">
          <button class="btn-secondary plate-button" id="btnFloatingChangeAvatar" style="height: 26px; padding: 0 10px; font-size: 11px; border: none; background: rgba(255, 255, 255, 0.06);">
            Change Photo
          </button>
          ${
            profile.avatarDataUrl
              ? `<button class="btn-secondary plate-button" id="btnFloatingRemoveAvatar" style="height: 26px; padding: 0 10px; font-size: 11px; color: var(--compat-broken); border: none; background: rgba(255, 255, 255, 0.06);">Remove</button>`
              : ''
          }
        </div>

        <!-- 2. Friend Code Row (Seamless, No line, No separate box) -->
        <div class="profile-unified-code-row">
          <div>
            <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: var(--ink-secondary);">Your Friend Code</div>
            <div class="friend-code-display" style="font-size: 15px; margin-top: 3px; letter-spacing: 0.5px;">
              ${profile.id ? formatFriendCode(profile.id) : '----'}
            </div>
          </div>
          <button class="btn-secondary plate-button" id="btnCopyFloatingProfileCode" style="height: 28px; padding: 0 12px; font-size: 11px; border: none; background: rgba(255, 255, 255, 0.06);">
            Copy Code
          </button>
        </div>

        <!-- 3. Share Last Game (Seamless, No line, No separate box) -->
        <div class="profile-unified-share-row">
          <div>
            <div style="font-size: 13px; font-weight: 700; color: var(--ink-primary);">Share Last Game</div>
            <div style="font-size: 11px; color: var(--ink-secondary); margin-top: 2px;">Broadcast current game to friends</div>
          </div>
          <label class="clean-switch">
            <input type="checkbox" id="chkFloatingShareLastGame" ${store.get().settings.shareLastGame !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      </div>
    </div>
  `;
}

function attachProfileListeners(panel: HTMLElement) {
  const emuApi = (window as any).emufii;
  const profile = store.get().profile;

  const displayEl = panel.querySelector('#inlineNickDisplay') as HTMLElement;
  const inputEl = panel.querySelector('#inlineNickInput') as HTMLInputElement;

  const saveInlineNick = async () => {
    if (!inputEl) return;
    const newName = inputEl.value.trim() || 'Joueur';
    await emuApi.config.updateProfile({ name: newName });
    store.set({ profile: { ...store.get().profile, name: newName } });
    sfx.play('confirm');
    renderFloatingPanel();
  };

  displayEl?.addEventListener('click', () => {
    if (displayEl && inputEl) {
      displayEl.style.display = 'none';
      inputEl.style.display = 'block';
      inputEl.focus();
      inputEl.select();
    }
  });

  inputEl?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveInlineNick();
    } else if (e.key === 'Escape') {
      inputEl.value = profile.name || 'Joueur';
      inputEl.style.display = 'none';
      displayEl.style.display = 'flex';
    }
  });

  inputEl?.addEventListener('blur', () => {
    const newName = inputEl.value.trim();
    if (newName && newName !== profile.name) {
      saveInlineNick();
    } else {
      inputEl.style.display = 'none';
      displayEl.style.display = 'flex';
    }
  });

  panel.querySelector('#btnTogglePresence')?.addEventListener('click', (e) => {
    e.stopPropagation();
    presenceMenuOpen = !presenceMenuOpen;
    const menu = panel.querySelector('#presenceMenu') as HTMLElement;
    if (menu) menu.style.display = presenceMenuOpen ? 'flex' : 'none';
  });

  panel.querySelectorAll('.presence-option-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      sfx.play('click');
      const p = (e.currentTarget as HTMLElement).dataset.presence as 'online' | 'idle' | 'offline';
      if (p) {
        currentPresence = p;
        localStorage.setItem('emufii_presence', p);
        presenceMenuOpen = false;

        // Update header status dot
        const headerDot = document.getElementById('headerStatusDot');
        if (headerDot) headerDot.className = `user-status-dot ${p}`;

        // Announce presence to coordinator
        try {
          await emuApi.coordinator.announcePresence(profile.id, profile.name, false);
        } catch {}

        renderFloatingPanel();
      }
    });
  });

  panel.addEventListener('click', (e) => {
    if (presenceMenuOpen && !(e.target as HTMLElement).closest('#presenceDropdownContainer')) {
      presenceMenuOpen = false;
      const menu = panel.querySelector('#presenceMenu') as HTMLElement;
      if (menu) menu.style.display = 'none';
    }
  });

  panel.querySelector('#btnFloatingChangeAvatar')?.addEventListener('click', async () => {
    sfx.play('click');
    const dataUrl = await emuApi.dialog.selectAvatar();
    if (dataUrl) {
      await emuApi.config.updateProfile({ avatarDataUrl: dataUrl });
      store.set({ profile: { ...store.get().profile, avatarDataUrl: dataUrl } });
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const pid = store.get().profile.id;
      if (pid) {
        emuApi.coordinator.uploadAvatar(pid, pid, base64).catch(() => {});
      }
      renderFloatingPanel();
    }
  });

  panel.querySelector('#btnFloatingRemoveAvatar')?.addEventListener('click', async () => {
    sfx.play('click');
    await emuApi.config.updateProfile({ avatarDataUrl: null });
    const pid = store.get().profile.id;
    if (pid) {
      emuApi.coordinator.deleteAvatar(pid, pid).catch(() => {});
    }
    store.set({ profile: { ...store.get().profile, avatarDataUrl: null } });
    renderFloatingPanel();
  });

  panel.querySelector('#btnCopyFloatingProfileCode')?.addEventListener('click', () => {
    const p = store.get().profile;
    if (p.id) {
      navigator.clipboard.writeText(formatFriendCode(p.id));
      sfx.play('confirm');
      const btn = panel.querySelector('#btnCopyFloatingProfileCode') as HTMLButtonElement;
      if (btn) {
        btn.textContent = 'Copied!';
        setTimeout(() => (btn.textContent = 'Copy Code'), 2000);
      }
    }
  });

  panel.querySelector('#chkFloatingShareLastGame')?.addEventListener('change', async (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    await emuApi.config.updateSettings({ shareLastGame: checked });
    store.set({ settings: { ...store.get().settings, shareLastGame: checked } });
    sfx.play('toggle');
  });
}
