/**
 * ui-settings.js — Panneau paramètres (onglet ⚙️)
 *
 * Permet de configurer une IP WiFi manuelle pour l'iPhone.
 * Si le champ est vide, le mode mDNS est utilisé automatiquement.
 *
 * Chargé après ui.js dans index.html.
 */

;(function () {
  'use strict'

  // ─── Injection HTML dans le panneau ──────────────────────────────────────────

  // Ajouter l'onglet Settings dans la barre de tabs
  const tabsEl = document.querySelector('.tabs')
  const settingsTab = document.createElement('div')
  settingsTab.className  = 'tab'
  settingsTab.dataset.tab = 'settings'
  settingsTab.textContent = '⚙️ Config'
  tabsEl.appendChild(settingsTab)

  // Ajouter le panneau settings après les autres list-panels
  const lastPanel = document.getElementById('tab-favorites')
  const settingsPanel = document.createElement('div')
  settingsPanel.id        = 'tab-settings'
  settingsPanel.className = 'list-panel'
  settingsPanel.innerHTML = `
    <div class="settings-section">

      <div class="settings-group">
        <div class="settings-label">
          📡 Connexion WiFi manuelle
        </div>
        <div class="settings-desc">
          Si l'iPhone n'est pas détecté automatiquement sur le réseau,
          entrez son adresse IP ici. Laissez vide pour utiliser la
          découverte automatique (mDNS).
        </div>

        <div class="settings-row">
          <label for="setting-wifi-ip">Adresse IP iPhone</label>
          <input
            type="text"
            id="setting-wifi-ip"
            placeholder="ex : 192.168.1.42"
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        <div class="settings-row">
          <label for="setting-wifi-port">Port (optionnel)</label>
          <input
            type="text"
            id="setting-wifi-port"
            placeholder="ex : 58783"
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        <div class="settings-label" style="margin-top: 10px;">
          🔌 Mode de Connexion
        </div>
        <div class="settings-desc">
          Choisissez comment l'app doit communiquer avec l'iPhone.
        </div>
        
        <div class="toggle-group" id="connection-mode-group">
          <button class="toggle-btn" data-mode="usb">USB</button>
          <button class="toggle-btn" data-mode="wifi">WiFi</button>
          <button class="toggle-btn active" data-mode="both">Mixte</button>
        </div>

        <div class="settings-hint" id="settings-hint"></div>

        <div class="settings-actions">
          <button class="btn btn-secondary" id="btn-settings-clear" style="flex:1">
            🗑 Effacer
          </button>
          <button class="btn btn-primary" id="btn-settings-save" style="flex:2">
            💾 Enregistrer
          </button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-label">ℹ️ Comment trouver l'IP de l'iPhone</div>
        <div class="settings-desc">
          Réglages → WiFi → appuyer sur le réseau connecté → Adresse IP.<br><br>
          L'iPhone et le PC doivent être sur le même réseau local.
        </div>
      </div>

    </div>
  `
  lastPanel.insertAdjacentElement('afterend', settingsPanel)

  // ─── CSS inline ──────────────────────────────────────────────────────────────

  const style = document.createElement('style')
  style.textContent = `
    .settings-section {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .settings-group {
      background: var(--bg-input);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .settings-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-main);
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .settings-desc {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .settings-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .settings-row label {
      font-size: 11px;
      color: var(--text-muted);
    }
    .settings-row input {
      width: 100%;
      background: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-main);
      font-size: 13px;
      padding: 7px 10px;
      outline: none;
      transition: border-color .2s;
      font-family: 'Consolas', monospace;
    }
    .settings-row input:focus {
      border-color: var(--btn-primary);
    }
    .settings-row input.has-value {
      border-color: var(--text-success);
      color: var(--text-success);
    }
    .settings-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .settings-hint {
      font-size: 11px;
      min-height: 16px;
      transition: color .2s;
    }
    .settings-hint.ok    { color: var(--text-success); }
    .settings-hint.err   { color: var(--text-error); }
    .settings-hint.info  { color: var(--text-info); }

    .toggle-group {
      display: flex;
      background: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    .toggle-btn {
      flex: 1;
      background: none;
      border: none;
      padding: 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      transition: all .2s;
    }
    .toggle-btn:hover {
      background: var(--bg-list-hover);
      color: var(--text-main);
    }
    .toggle-btn.active {
      background: var(--btn-primary);
      color: var(--text-white);
    }
  `
  document.head.appendChild(style)

  // ─── Logique ─────────────────────────────────────────────────────────────────

  const ipInput   = document.getElementById('setting-wifi-ip')
  const portInput = document.getElementById('setting-wifi-port')
  const hintEl    = document.getElementById('settings-hint')
  const btnSave   = document.getElementById('btn-settings-save')
  const btnClear  = document.getElementById('btn-settings-clear')

  function setHint(msg, type = 'info') {
    hintEl.textContent = msg
    hintEl.className   = `settings-hint ${type}`
  }

  function updateInputStyle() {
    ipInput.classList.toggle('has-value', ipInput.value.trim() !== '')
  }

  // Validation légère de l'IP
  function isValidIp(ip) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim())
  }

  let selectedMode = 'both'

  // Gestion des clics sur les boutons toggle
  const modeGroup = document.getElementById('connection-mode-group')
  modeGroup.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modeGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      selectedMode = btn.dataset.mode
    })
  })

  function setModeUI(mode) {
    selectedMode = mode || 'both'
    modeGroup.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === selectedMode)
    })
  }

  // Charger les settings depuis le main process
  async function loadSettings() {
    try {
      const settings = await window.gps.getSettings()
      ipInput.value   = settings.wifiIp   || ''
      portInput.value = settings.wifiPort || ''
      setModeUI(settings.connectionMode)
      updateInputStyle()
      if (settings.wifiIp) {
        setHint(`IP manuelle active : ${settings.wifiIp}`, 'ok')
      } else {
        setHint('Mode découverte automatique (mDNS)', 'info')
      }
    } catch (e) {
      setHint('Erreur chargement settings', 'err')
    }
  }

  // Sauvegarder
  btnSave.addEventListener('click', async () => {
    const ip   = ipInput.value.trim()
    const port = portInput.value.trim()

    if (ip && !isValidIp(ip)) {
      setHint('Adresse IP invalide (ex: 192.168.1.42)', 'err')
      ipInput.focus()
      return
    }

    if (port && !/^\d+$/.test(port)) {
      setHint('Port invalide (nombres uniquement)', 'err')
      portInput.focus()
      return
    }

    btnSave.disabled    = true
    btnSave.textContent = '⏳ Enregistrement...'

    try {
      await window.gps.saveSettings({ 
        wifiIp: ip, 
        wifiPort: port,
        connectionMode: selectedMode
      })
      updateInputStyle()

      if (ip) {
        setHint(`✅ IP manuelle enregistrée — connexion en cours...`, 'ok')
        window.UIModule?.showToast(`IP WiFi : ${ip}`, 'success')
      } else {
        setHint('✅ Retour en mode découverte automatique (mDNS)', 'ok')
        window.UIModule?.showToast('Mode mDNS activé', 'success')
      }
    } catch (e) {
      setHint(`Erreur: ${e.message}`, 'err')
    }

    btnSave.disabled    = false
    btnSave.textContent = '💾 Enregistrer'
  })

  // Effacer
  btnClear.addEventListener('click', async () => {
    ipInput.value   = ''
    portInput.value = ''
    updateInputStyle()

    try {
      await window.gps.saveSettings({ wifiIp: '', wifiPort: '' })
      setHint('IP manuelle effacée — retour en mode mDNS', 'info')
      window.UIModule?.showToast('IP WiFi effacée', 'info')
    } catch (e) {
      setHint(`Erreur: ${e.message}`, 'err')
    }
  })

  // Mise à jour style en temps réel
  ipInput.addEventListener('input', () => {
    updateInputStyle()
    const ip = ipInput.value.trim()
    if (!ip) {
      setHint('Mode découverte automatique (mDNS)', 'info')
    } else if (!isValidIp(ip)) {
      setHint('Format attendu : 192.168.1.42', 'err')
    } else {
      setHint('IP valide — cliquez Enregistrer pour appliquer', 'ok')
    }
  })

  // Enter pour sauvegarder
  ipInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnSave.click() })
  portInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnSave.click() })

  // ─── Chargement au démarrage (après que window.gps soit disponible)
  window.addEventListener('DOMContentLoaded', loadSettings)
  // Fallback si DOMContentLoaded déjà passé
  if (document.readyState !== 'loading') loadSettings()

})()
