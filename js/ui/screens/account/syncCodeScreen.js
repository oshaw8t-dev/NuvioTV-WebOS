import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, TV_LOGIN_REDIRECT_BASE_URL } from "../../../config.js";

async function getTvIpAddress() {
  return new Promise((resolve) => {
    try {
      if (window.webOS && window.webOS.service) {
        window.webOS.service.request("luna://com.palm.connectionmanager/getStatus", {
          parameters: {},
          onSuccess: function (result) {
            const ip =
              (result.wired && result.wired.ipAddress && result.wired.state === "connected" ? result.wired.ipAddress : null) ||
              (result.wifi && result.wifi.ipAddress && result.wifi.connStatus === "ipConfigured" ? result.wifi.ipAddress : null) ||
              (result.wired && result.wired.ipAddress) ||
              (result.wifi && result.wifi.ipAddress) ||
              null;
            resolve(ip);
          },
          onFailure: function () {
            resolve(null);
          }
        });
      } else {
        resolve(null);
      }
    } catch (e) {
      resolve(null);
    }
  });
}

async function supabaseRpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

let pollInterval = null;
let countdownInterval = null;

export const SyncCodeScreen = {

  async mount() {
    this.container = document.getElementById("account");
    ScreenUtils.show(this.container);
    this.stopIntervals();
    await this.startSession();
  },

  async startSession() {
    this.container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:16px;color:#888;">
        <div>Generazione QR in corso...</div>
      </div>
    `;

    try {
      const addonUrls = addonRepository.getInstalledAddonUrls();
      const detectedIp = await getTvIpAddress();
      const redirectBase = detectedIp
        ? `http://${detectedIp}:3000`
        : TV_LOGIN_REDIRECT_BASE_URL;
      const result = await supabaseRpc("start_addon_sync", {
        p_addon_urls: addonUrls,
        p_redirect_base_url: redirectBase
      });
      const row = Array.isArray(result) ? result[0] : result;
      if (!row) throw new Error("Nessuna sessione creata");

      this.sessionCode = row.code;
      this.webUrl = row.web_url;
      this.expiresAt = new Date(row.expires_at).getTime();

      this.render();
      this.startPolling();
      this.startCountdown();
    } catch (e) {
      this.container.innerHTML = `
        <div style="padding:32px;text-align:center;">
          <p style="color:#f87171;">Errore: ${e.message}</p>
        </div>
      `;
    }
  },

  render() {
    const code = this.sessionCode || "";
    const url = this.webUrl || "";
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;

    this.container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;padding:32px;">
        <div style="text-align:center;max-width:420px;">
          <div style="font-size:1.6rem;font-weight:bold;color:#a855f7;margin-bottom:8px;">NUVIO</div>
          <h2 style="font-size:1.1rem;margin-bottom:4px;">Gestione Addon</h2>
          <p style="color:#888;font-size:0.85rem;margin-bottom:24px;">Scansiona il QR con il telefono per gestire gli addon</p>

          <div style="display:flex;align-items:center;justify-content:center;margin-bottom:16px;">
            <img src="${qrImageUrl}" style="border-radius:12px;width:220px;height:220px;" alt="QR Code" />
          </div>

          <div style="font-family:monospace;font-size:1.1rem;color:#a855f7;margin-bottom:8px;">Codice: ${code}</div>
          <div id="addonExpiry" style="font-size:0.8rem;color:#666;margin-bottom:8px;"></div>
          <div id="addonStatus" style="font-size:0.9rem;color:#888;margin-bottom:24px;"></div>

          <button data-action="back" class="focusable"
            style="padding:12px 32px;background:rgba(255,255,255,0.1);border:none;border-radius:8px;color:white;font-size:0.95rem;cursor:pointer;">
            Indietro
          </button>
        </div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container, "[data-action='back']");
  },

  startPolling() {
    pollInterval = setInterval(async () => {
      try {
        const result = await supabaseRpc("poll_addon_sync", { p_code: this.sessionCode });
        const row = Array.isArray(result) ? result[0] : result;
        const status = row?.status || "pending";

        if (status === "updated") {
          // Prova a leggere addon_urls direttamente da poll_addon_sync
          // se non disponibile, fa una seconda chiamata get_addon_sync
          let newUrls = Array.isArray(row?.addon_urls) ? row.addon_urls : null;
          if (!newUrls) {
            const syncResult = await supabaseRpc("get_addon_sync", { p_code: this.sessionCode });
            const syncRow = Array.isArray(syncResult) ? syncResult[0] : syncResult;
            newUrls = Array.isArray(syncRow?.addon_urls) ? syncRow.addon_urls : [];
          }

          await addonRepository.setAddonOrder(newUrls);
          this.stopIntervals();

          const statusEl = this.container.querySelector("#addonStatus");
          if (statusEl) {
            statusEl.style.color = "#4ade80";
            statusEl.textContent = "✓ Addon aggiornati! Torno al menu...";
          }

          setTimeout(() => {
            if (Router.getCurrent() === "syncCode") {
              Router.navigate("plugin");
            }
          }, 2000);
        }
      } catch (e) {
        console.warn("Addon sync poll failed", e);
      }
    }, 3000);
  },

  startCountdown() {
    countdownInterval = setInterval(() => {
      const expiryEl = this.container.querySelector("#addonExpiry");
      if (!expiryEl) return;
      const remaining = this.expiresAt - Date.now();
      if (remaining <= 0) {
        expiryEl.textContent = "Scaduto — ricarica";
        clearInterval(countdownInterval);
        return;
      }
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      expiryEl.textContent = `Scade tra ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }, 1000);
  },

  stopIntervals() {
    if (pollInterval) clearInterval(pollInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    pollInterval = null;
    countdownInterval = null;
  },

  onKeyDown(event) {
    if (ScreenUtils.handleDpadNavigation(event, this.container)) return;
    if (event.keyCode === 461 || event.keyCode === 27 || event.keyCode === 10009) {
      this.cleanup();
      Router.back();
      return;
    }
    if (event.keyCode !== 13) return;
    const current = this.container.querySelector(".focusable.focused");
    if (!current) return;
    if (current.dataset.action === "back") {
      this.cleanup();
      Router.back();
    }
  },

  cleanup() {
    this.stopIntervals();
    ScreenUtils.hide(this.container);
  }
};