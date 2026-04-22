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

  // Ajouter le panneau settings dans la modale
  const settingsContainer = document.getElementById('settings-inject-point')
  const settingsPanel = document.createElement('div')
  settingsPanel.id        = 'tab-settings'
  settingsPanel.className = 'list-panel active'
  settingsPanel.innerHTML = `
    <div class="settings-section">
      <div class="settings-group">
        <div class="settings-label">📡 Connexion WiFi manuelle</div>
        <div class="settings-desc">Entrez l'adresse IP si l'iPhone n'est pas détecté.</div>
        <div class="settings-row">
          <label>Adresse IP</label>
          <input type="text" id="setting-wifi-ip" placeholder="ex : 192.168.1.42" />
        </div>
        <div class="settings-row">
          <label>Port (optionnel)</label>
          <input type="text" id="setting-wifi-port" placeholder="ex : 58783" />
        </div>
        
        <div class="settings-label" style="margin-top: 10px;">🔌 Mode</div>
        <div class="toggle-group" id="connection-mode-group">
          <button class="toggle-btn" data-mode="usb">USB</button>
          <button class="toggle-btn" data-mode="wifi">WiFi</button>
          <button class="toggle-btn active" data-mode="both">Mixte</button>
        </div>

        <div class="settings-label" style="margin-top: 20px;">📱 Application Compagnon (iOS)</div>
        <div class="settings-desc">Configurez le serveur pour l'application mobile.</div>
        <div class="settings-row">
          <label>Port WebSocket</label>
          <input type="number" id="setting-companion-port" placeholder="ex : 8080" />
        </div>

        <div class="settings-label" style="margin-top: 20px;">🗺️ Cartographie</div>
        <div class="settings-desc">Choisissez votre moteur de rendu de carte préféré.</div>
        
        <div class="toggle-group" id="map-provider-group" style="margin-top: 8px;">
          <button class="toggle-btn active" data-mode="leaflet">Leaflet (Libre)</button>
          <button class="toggle-btn" data-mode="google">Google Maps</button>
        </div>

        <div id="google-key-section" style="display:none; margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 12px;">
          <div class="settings-row">
            <label>Clé API Google Maps</label>
            <input type="password" id="setting-google-key" placeholder="AIza..." autocomplete="off"/>
          </div>
          <div class="doc-box">
            <h4>Comment obtenir une clé ?</h4>
            <ol>
              <li>Accédez à la <a href="https://console.cloud.google.com/" target="_blank">Google Cloud Console</a>.</li>
              <li>Créez un projet (gratuit).</li>
              <li>Activez <b>"Maps JavaScript API"</b> dans le catalogue.</li>
              <li>Générez une clé dans <b>Identifiants → Créer des identifiants → Clé API</b>.</li>
            </ol>
            <p class="settings-desc"><i>Note : Google offre $200 de crédit gratuit par mois, largement suffisant pour cet usage.</i></p>
          </div>
        </div>

        <div class="settings-hint" id="settings-hint" style="margin-top: 12px;"></div>
        <div class="settings-actions">
          <button class="btn btn-secondary" id="btn-settings-clear" style="flex:1">🗑 Effacer IP</button>
          <button class="btn btn-primary" id="btn-settings-save" style="flex:2">💾 Enregistrer</button>
        </div>
      </div>
    </div>
  `
  if (settingsContainer) settingsContainer.appendChild(settingsPanel)

  // ─── Logique ─────────────────────────────────────────────────────────────────

  const ipInput    = document.getElementById('setting-wifi-ip')
  const portInput  = document.getElementById('setting-wifi-port')
  const companionPortInput = document.getElementById('setting-companion-port')
  const googleInput = document.getElementById('setting-google-key')
  const hintEl     = document.getElementById('settings-hint')
  const btnSave    = document.getElementById('btn-settings-save')
  const btnClear   = document.getElementById('btn-settings-clear')
  const googleSection = document.getElementById('google-key-section')

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
  let selectedProvider = 'leaflet'

  // Gestion des clics sur les boutons toggle (Mode Connexion)
  const modeGroup = document.getElementById('connection-mode-group')
  modeGroup.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modeGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      selectedMode = btn.dataset.mode
    })
  })

  // Gestion des clics sur les boutons toggle (Moteur de carte)
  const providerGroup = document.getElementById('map-provider-group')
  providerGroup.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      providerGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      selectedProvider = btn.dataset.mode
      googleSection.style.display = selectedProvider === 'google' ? 'block' : 'none'
    })
  })

  function setModeUI(mode) {
    selectedMode = mode || 'both'
    modeGroup.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === selectedMode)
    })
  }

  function setProviderUI(provider) {
    selectedProvider = provider || 'leaflet'
    providerGroup.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === selectedProvider)
    })
    googleSection.style.display = selectedProvider === 'google' ? 'block' : 'none'
  }

  // Charger les settings depuis le main process
  async function loadSettings() {
    try {
      const settings = await window.gps.getSettings()
      ipInput.value     = settings.wifiIp   || ''
      portInput.value   = settings.wifiPort || ''
      companionPortInput.value = settings.companionPort || 8080
      googleInput.value = settings.googleMapsKey || ''
      
      setModeUI(settings.connectionMode)
      setProviderUI(settings.mapProvider)
      
      updateInputStyle()
      if (settings.wifiIp) {
        setHint(`IP manuelle active : ${settings.wifiIp}`, 'ok')
      } else {
        setHint('Découverte automatique activée', 'info')
      }
    } catch (e) {
      setHint('Erreur chargement settings', 'err')
    }
  }

  // Sauvegarder
  btnSave.addEventListener('click', async () => {
    const ip     = ipInput.value.trim()
    const port   = portInput.value.trim()
    const gKey   = googleInput.value.trim()

    if (ip && !isValidIp(ip)) {
      setHint('Adresse IP invalide (ex: 192.168.1.42)', 'err')
      ipInput.focus()
      return
    }

    if (selectedProvider === 'google' && !gKey) {
      setHint('Clé API Google obligatoire pour ce mode', 'err')
      googleInput.focus()
      return
    }

    btnSave.disabled    = true
    btnSave.textContent = '⏳ ...'

    try {
      await window.gps.saveSettings({ 
        wifiIp: ip, 
        wifiPort: port,
        companionPort: parseInt(companionPortInput.value) || 8080,
        connectionMode: selectedMode,
        mapProvider: selectedProvider,
        googleMapsKey: gKey
      })
      updateInputStyle()
      setHint('✅ Réglages enregistrés', 'ok')
      
      // On notifie le système de carte
      window.dispatchEvent(new CustomEvent('map-provider-changed', { 
        detail: { provider: selectedProvider, key: gKey } 
      }))

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
