import { PlayerController } from "../../../core/player/playerController.js";
import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { Router } from "../../navigation/router.js";
import { WatchProgressStore } from "../../../data/local/watchProgressStore.js";
import { WatchedItemsStore } from "../../../data/local/watchedItemsStore.js";

function formatTime(secondsValue) {
  const total = Math.max(0, Math.floor(Number(secondsValue || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatClock(date = new Date()) {
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatEndsAt(cur, dur) {
  if (!Number.isFinite(dur) || dur <= 0) return "--:--";
  return formatClock(new Date(Date.now() + Math.max(0, (dur - cur) * 1000)));
}

export const PlayerScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("player");
    // Fade-in all'apertura del player
    this.container.style.opacity = "0";
    this.container.style.transition = "";
    this.container.style.display = "block";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.container.style.transition = "opacity 180ms ease";
        this.container.style.opacity = "1";
        const onEnd = () => {
          if (this.container) {
            this.container.style.transition = "";
          }
          this.container?.removeEventListener("transitionend", onEnd);
        };
        this.container.addEventListener("transitionend", onEnd);
      });
    });
    this.params = params;
    this.streamCandidates = Array.isArray(params.streamCandidates) ? params.streamCandidates : [];

    // Carica progresso e preferenza sorgente salvati
    this._savedProgress = params.itemId
      ? WatchProgressStore.findOne(params.itemId, params.videoId ?? null)
      : null;
    this._progressSaveTimer = null;
    this._resumeHandled = false;

    // Scegli sorgente: prima la preferita (per titolo), poi la best scored
    const initialUrl = params.streamUrl || this._pickPreferredOrBestStream() || null;
    this.currentStreamIndex = Math.max(0, this.streamCandidates.findIndex((s) => s.url === initialUrl));

    this.subtitles = [];
    this.externalTrackNodes = [];
    this.episodes = Array.isArray(params.episodes) ? params.episodes : [];
    this.switchingEpisode = false;
    this.paused = false;
    this.controlsVisible = true;
    this.loadingVisible = true;
    this.controlsHideTimer = null;
    this.tickTimer = null;
    this.videoListeners = [];

    this.subtitlePanelVisible = false;
    this.audioPanelVisible = false;
    this.streamPanelVisible = false;
    this.episodePanelVisible = false;
    this.subtitlePanelIndex = 0;
    this.audioPanelIndex = 0;
    this.streamPanelIndex = this.currentStreamIndex;
    this.episodePanelIndex = Math.max(0, this.episodes.findIndex((e) => e.id === params.videoId));
    this.selectedSubtitleTrackIndex = -1;
    this.selectedAudioTrackIndex = -1;
    // focusZone: "video" | "scrubber" | "controls"
    this.focusZone = "video";

    this.renderPlayerUi();
    this.bindVideoEvents();
    this.updateUiTick();

    if (initialUrl) {
      PlayerController.play(initialUrl, {
        itemId: params.itemId || null,
        itemType: params.itemType || "movie",
        videoId: params.videoId || null,
        season: params.season == null ? null : Number(params.season),
        episode: params.episode == null ? null : Number(params.episode)
      });
    }

    this.loadSubtitles();
    this.syncTrackState();
    this.tickTimer = setInterval(() => this.updateUiTick(), 1000);
    this.endedHandler = () => this.handlePlaybackEnded();
    PlayerController.video?.addEventListener("ended", this.endedHandler);
    this.setControlsVisible(true, { zone: "controls" });

    // Page Visibility API: sospendi il tick quando lo schermo si spegne
    this._visibilityHandler = () => {
      if (document.hidden) {
        if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
        if (this._progressSaveTimer) { clearTimeout(this._progressSaveTimer); this._progressSaveTimer = null; this._doSaveProgress(); }
      } else {
        if (!this.tickTimer) { this.tickTimer = setInterval(() => this.updateUiTick(), 1000); }
        this.updateUiTick();
      }
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);
  },

  // ── consumeBackRequest: chiamato dal FocusEngine prima di Router.back() ──
  consumeBackRequest() {
    const panel = this.getActivePanelName();
    if (panel) {
      this.closeFocusedPanel();
      return true; // consumato: non uscire dal player
    }
    // NON chiamare cleanup() qui: il Router lo invoca già in navigate().
    // Avviamo solo il fade-out anticipato così non c'è flash nero.
    this._startExitFade();
    return false; // lascia che Router.back() navighi indietro
  },

  // Avvia un fade-out visivo del container senza fermare il player.
  _startExitFade() {
    if (!this.container) return;
    this.container.style.transition = "opacity 200ms ease";
    this.container.style.opacity = "0";
  },

  // ── Render ───────────────────────────────────────────────────────────────

  renderPlayerUi() {
    this.container.querySelector("#playerUiRoot")?.remove();
    const root = document.createElement("div");
    root.id = "playerUiRoot";
    root.className = "player-ui-root";
    root.innerHTML = `
      <div id="playerLoadingOverlay" class="player-loading-overlay">
        <div class="player-loading-backdrop"${this.params.playerBackdropUrl ? ` style="background-image:url('${this.params.playerBackdropUrl}')"` : ""}></div>
        <div class="player-loading-gradient"></div>
        <div class="player-loading-center">
          ${this.params.playerLogoUrl ? `<img class="player-loading-logo" src="${this.params.playerLogoUrl}" alt="" />` : ""}
          <div class="player-loading-title">${this.params.playerTitle || this.params.itemId || "Nuvio"}</div>
          ${this.params.playerSubtitle ? `<div class="player-loading-subtitle">${this.params.playerSubtitle}</div>` : ""}
        </div>
      </div>
      <div id="playerControlsOverlay" class="player-controls-overlay">
        <div class="player-controls-top">
          <div id="playerClock" class="player-clock">--:--</div>
          <div class="player-ends-at">Ends at: <span id="playerEndsAt">--:--</span></div>
        </div>
        <div class="player-controls-bottom">
          <div class="player-meta">
            <div class="player-title">${this.params.playerTitle || this.params.itemId || ""}</div>
            <div class="player-subtitle">${this.params.playerSubtitle || this.params.episodeLabel || ""}</div>
          </div>
          <div class="player-progress-track" id="playerProgressTrack">
            <div id="playerProgressFill" class="player-progress-fill"></div>
            <div id="playerProgressThumb" class="player-progress-thumb"></div>
            <div id="playerSeekPreview" class="player-seek-preview" aria-hidden="true"></div>
          </div>
          <div class="player-controls-row">
            <div id="playerControlButtons" class="player-control-buttons"></div>
            <div id="playerTimeLabel" class="player-time-label">0:00 / 0:00</div>
          </div>
        </div>
      </div>
    `;
    this.container.appendChild(root);
    this.renderControlButtons();

    // Click globale sul container del player: gestito internamente, NON dal focusEngine.
    // Usiamo capture=true per girare PRIMA del focusEngine, poi stopImmediatePropagation.
    this._containerClickHandler = (e) => this._handleContainerClick(e);
    this.container.addEventListener("click", this._containerClickHandler, true);
    this._bindProgressScrubber();
  },

  _bindProgressScrubber() {
    const track = this.container.querySelector("#playerProgressTrack");
    if (!track) return;
    let dragging = false;

    const updatePreview = (clientX, show) => {
      const preview = this.container.querySelector("#playerSeekPreview");
      if (!preview) return;
      if (!show) { preview.classList.remove("visible"); return; }
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const video = PlayerController.video;
      const dur = video?.duration || 0;
      if (!dur) { preview.classList.remove("visible"); return; }
      const seekTime = ratio * dur;
      preview.textContent = formatTime(seekTime);
      // Posiziona centrato sul punto, con clamp ai bordi
      const pct = ratio * 100;
      preview.style.left = `${pct}%`;
      preview.classList.add("visible");
    };

    const seekToX = (clientX) => {
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const video = PlayerController.video;
      if (!video || !video.duration) return;
      video.currentTime = ratio * video.duration;
      this.updateUiTick();
      this.resetControlsAutoHide();
    };

    track.addEventListener("mousedown", (e) => {
      e.stopImmediatePropagation();
      dragging = true;
      this.setControlsVisible(true, { zone: "scrubber" });
      seekToX(e.clientX);
      updatePreview(e.clientX, true);
    }, true);

    const thumb = track.querySelector(".player-progress-thumb");
    const THUMB_PROXIMITY_PX = 40; // distanza verticale/orizzontale per attivare il grab

    // Hover sul track (senza drag): mostra il preview e gestisce il timer
    track.addEventListener("mousemove", (e) => {
      if (!dragging) {
        updatePreview(e.clientX, true);
        // Non nascondere i controlli mentre il mouse è sulla timeline
        this.clearControlsAutoHide();
        this.setControlsVisible(true);
      }
      // Thumb proximity: ingrandisce il pallino quando il cursore è abbastanza vicino
      if (thumb) {
        const thumbRect = thumb.getBoundingClientRect();
        const thumbCx = thumbRect.left + thumbRect.width / 2;
        const thumbCy = thumbRect.top + thumbRect.height / 2;
        const dist = Math.sqrt(Math.pow(e.clientX - thumbCx, 2) + Math.pow(e.clientY - thumbCy, 2));
        thumb.classList.toggle("near", dist < THUMB_PROXIMITY_PX);
        if (dragging) thumb.classList.add("dragging");
      }
    });
    track.addEventListener("mouseleave", () => {
      if (!dragging) {
        updatePreview(0, false);
        if (thumb) thumb.classList.remove("near", "dragging");
        // Riavvia il timer di auto-hide quando il mouse lascia la timeline
        this.resetControlsAutoHide();
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      seekToX(e.clientX);
      updatePreview(e.clientX, true);
      if (thumb) {
        thumb.classList.add("near", "dragging");
      }
    });
    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      updatePreview(0, false);
      if (thumb) thumb.classList.remove("near", "dragging");
      this.resetControlsAutoHide();
    });
  },

  _handleContainerClick(e) {
    // Blocca sempre la propagazione verso il focusEngine per qualsiasi click dentro il player
    e.stopImmediatePropagation();
    e.stopPropagation();

    const btn = e.target.closest("[data-ctrl]");
    if (btn) {
      const action = btn.dataset.ctrl;
      // Aggiorna focus visivo
      this.container.querySelectorAll("[data-ctrl]").forEach((b) => b.classList.remove("focused"));
      btn.classList.add("focused");
      this.performControlAction(action);
      return;
    }

    const panelItem = e.target.closest("[data-panel-index]");
    if (panelItem) {
      const idx = Number(panelItem.dataset.panelIndex);
      const panelName = this.getActivePanelName();
      if (panelName === "subtitle") { this.subtitlePanelIndex = idx; this.applySubtitleFromPanel(); }
      else if (panelName === "audio") { this.audioPanelIndex = idx; this.applyAudioFromPanel(); }
      else if (panelName === "stream") { this.streamPanelIndex = idx; this.applyStreamFromPanel(); }
      else if (panelName === "episode") { this.episodePanelIndex = idx; this.renderEpisodePanel(); this.playEpisodeFromPanel(); }
      return;
    }

    const closeBtn = e.target.closest("[data-panel-close]");
    if (closeBtn) {
      this.closeFocusedPanel();
      return;
    }

    // Click su area video (fuori dai bottoni): toggle controls
    const inControls = e.target.closest("#playerControlsOverlay");
    if (!inControls) {
      this.setControlsVisible(!this.controlsVisible);
    }
  },

  // ── Control buttons ──────────────────────────────────────────────────────
  // IMPORTANTE: non usare class="focusable" né data-action → altrimenti il focusEngine li intercetta

  getControlDefinitions() {
    const defs = [
      { action: "playPause",    icon: this.paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg", title: this.paused ? "Play" : "Pausa" },
      { action: "subtitlePanel", icon: "assets/icons/ic_player_subtitles.svg", title: "Sottotitoli", active: this.subtitlePanelVisible },
      { action: "audioPanel",   icon: this.selectedAudioTrackIndex >= 0 ? "assets/icons/ic_player_audio_filled.svg" : "assets/icons/ic_player_audio_outline.svg", title: "Audio", active: this.audioPanelVisible },
      { action: "streamPanel",  icon: "assets/icons/ic_player_source.svg", title: "Sorgente", active: this.streamPanelVisible }
    ];
    if (this.episodes.length > 0) {
      defs.push({ action: "episodePanel", icon: "assets/icons/ic_player_episodes.svg", title: "Episodi", active: this.episodePanelVisible });
    }
    defs.push({ action: "external", label: "EXT", title: "Player esterno" });
    return defs;
  },

  renderControlButtons() {
    const wrap = this.container.querySelector("#playerControlButtons");
    if (!wrap) return;
    const currentAction = wrap.querySelector(".player-control-btn.focused")?.dataset?.ctrl || "";
    // Usa data-ctrl invece di data-action per non essere intercettato dal focusEngine
    wrap.innerHTML = this.getControlDefinitions().map((ctrl) => `
      <button class="player-control-btn${ctrl.active ? " active" : ""}" data-ctrl="${ctrl.action}" title="${ctrl.title || ""}">
        ${ctrl.icon
          ? `<img class="player-control-icon" src="${ctrl.icon}" alt="" aria-hidden="true" />`
          : `<span>${ctrl.label}</span>`}
      </button>
    `).join("");
    const preferred = wrap.querySelector(`[data-ctrl="${currentAction}"]`) || wrap.querySelector(".player-control-btn");
    if (preferred) preferred.classList.add("focused");
  },

  // ── Panel rendering ──────────────────────────────────────────────────────

  _buildPanelHtml(id, title, hint, items, selectedIndex) {
    const listHtml = items.length
      ? items.map((item, i) => {
          const extra = item.extraClass ? ` ${item.extraClass}` : "";
          return `
          <div class="player-side-item${i === selectedIndex ? " selected" : ""}${extra}" data-panel-index="${i}">
            <div class="player-side-item-label">${item.label || ""}</div>
            ${item.sub ? `<div class="player-side-item-sub">${item.sub}</div>` : ""}
          </div>`;
        }).join("")
      : `<div class="player-side-empty">Nessun elemento disponibile</div>`;

    return `
      <div class="player-side-panel-header">
        <div class="player-side-panel-title">${title}</div>
        <button class="player-side-panel-close" data-panel-close="1">✕ Chiudi</button>
      </div>
      <div class="player-side-panel-hint">${hint}</div>
      <div class="player-side-panel-list" id="${id}List">${listHtml}</div>
    `;
  },

  _scrollPanelToSelected(listId) {
    const list = this.container.querySelector(`#${listId}`);
    if (!list) return;
    const selected = list.querySelector(".player-side-item.selected");
    if (selected) selected.scrollIntoView({ block: "nearest", behavior: "instant" });
  },

  // ── Subtitle panel ───────────────────────────────────────────────────────

  toggleSubtitlePanel() {
    if (this.subtitlePanelVisible) { this.hideSubtitlePanel(); return; }
    this.closeAllPanels();
    this.subtitlePanelVisible = true;
    this.syncTrackState();
    this.subtitlePanelIndex = Math.max(0, this.selectedSubtitleTrackIndex + 1);
    this.renderSubtitlePanel();
    this.clearControlsAutoHide();
    this.renderControlButtons();
  },

  renderSubtitlePanel() {
    this.container.querySelector("#playerSubtitlePanel")?.remove();
    const tracks = this.getTextTracks();
    const items = [{ label: "Disattivati", sub: "" }, ...tracks.map((t, i) => ({ label: t.label || t.language || `Traccia ${i + 1}`, sub: t.language || "" }))];
    const panel = document.createElement("div");
    panel.id = "playerSubtitlePanel";
    panel.className = "player-side-panel";
    panel.innerHTML = this._buildPanelHtml("subtitleList", "Sottotitoli", "▲▼ seleziona &nbsp; OK applica &nbsp; ← chiudi", items, this.subtitlePanelIndex);
    this.container.appendChild(panel);
    requestAnimationFrame(() => this._scrollPanelToSelected("subtitleList"));
  },

  hideSubtitlePanel() {
    this.subtitlePanelVisible = false;
    this.container.querySelector("#playerSubtitlePanel")?.remove();
    this.resetControlsAutoHide();
    this.renderControlButtons();
  },

  applySubtitleFromPanel() {
    const tracks = this.getTextTracks();
    const trackIndex = this.subtitlePanelIndex - 1;
    tracks.forEach((t, i) => { t.mode = i === trackIndex ? "showing" : "disabled"; });
    this.selectedSubtitleTrackIndex = trackIndex;
    this.renderSubtitlePanel();
  },

  // ── Audio panel ──────────────────────────────────────────────────────────

  toggleAudioPanel() {
    if (this.audioPanelVisible) { this.hideAudioPanel(); return; }
    this.closeAllPanels();
    this.audioPanelVisible = true;
    this.syncTrackState();
    this.audioPanelIndex = Math.max(0, this.selectedAudioTrackIndex);
    this.renderAudioPanel();
    this.clearControlsAutoHide();
    this.renderControlButtons();
  },

  renderAudioPanel() {
    this.container.querySelector("#playerAudioPanel")?.remove();
    const tracks = this.getAudioTracks();
    const items = tracks.map((t, i) => ({ label: t.label || t.language || `Traccia ${i + 1}`, sub: t.language || "" }));
    const panel = document.createElement("div");
    panel.id = "playerAudioPanel";
    panel.className = "player-side-panel";
    panel.innerHTML = this._buildPanelHtml("audioList", "Traccia Audio", "▲▼ seleziona &nbsp; OK applica &nbsp; ← chiudi", items, this.audioPanelIndex);
    this.container.appendChild(panel);
    requestAnimationFrame(() => this._scrollPanelToSelected("audioList"));
  },

  hideAudioPanel() {
    this.audioPanelVisible = false;
    this.container.querySelector("#playerAudioPanel")?.remove();
    this.resetControlsAutoHide();
    this.renderControlButtons();
  },

  applyAudioFromPanel() {
    const tracks = this.getAudioTracks();
    if (!tracks.length) return;
    tracks.forEach((t, i) => { t.enabled = i === this.audioPanelIndex; });
    this.selectedAudioTrackIndex = this.audioPanelIndex;
    const trackName = tracks[this.audioPanelIndex]?.label || tracks[this.audioPanelIndex]?.language || `Traccia ${this.audioPanelIndex + 1}`;
    this.showToast(`\uD83C\uDFA7 ${trackName}`);
    this.renderAudioPanel();
    this.renderControlButtons();
  },

  showToast(message, durationMs = 2200) {
    this.container.querySelector("#playerToast")?.remove();
    const toast = document.createElement("div");
    toast.id = "playerToast";
    toast.className = "player-toast";
    toast.textContent = message;
    this.container.appendChild(toast);
    // Forza reflow per animazione CSS
    void toast.offsetWidth;
    toast.classList.add("visible");
    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  },

  // ── Stream panel ─────────────────────────────────────────────────────────

  toggleStreamPanel() {
    if (this.streamPanelVisible) { this.hideStreamPanel(); return; }
    this.closeAllPanels();
    this.streamPanelVisible = true;
    this.streamPanelIndex = this.currentStreamIndex;
    this.renderStreamPanel();
    this.clearControlsAutoHide();
    this.renderControlButtons();
  },

  renderStreamPanel() {
    this.container.querySelector("#playerStreamPanel")?.remove();
    const items = this.streamCandidates.map((s, i) => ({
      label: (s.name || `Sorgente ${i + 1}`).replace(/\n/g, " · "),
      sub: s.title || s.description || s.addonName || ""
    }));
    const panel = document.createElement("div");
    panel.id = "playerStreamPanel";
    panel.className = "player-side-panel";
    panel.innerHTML = this._buildPanelHtml("streamList", "Sorgente Video", "▲▼ seleziona &nbsp; OK applica &nbsp; ← chiudi", items, this.streamPanelIndex);
    this.container.appendChild(panel);
    requestAnimationFrame(() => this._scrollPanelToSelected("streamList"));
  },

  hideStreamPanel() {
    this.streamPanelVisible = false;
    this.container.querySelector("#playerStreamPanel")?.remove();
    this.resetControlsAutoHide();
    this.renderControlButtons();
  },

  applyStreamFromPanel() {
    const selected = this.streamCandidates[this.streamPanelIndex];
    if (!selected?.url) return;
    this.currentStreamIndex = this.streamPanelIndex;
    // Salva la sorgente preferita per questo contenuto
    this._savePreferredStream(selected);
    this.loadingVisible = true;
    this.updateLoadingVisibility();
    PlayerController.play(selected.url, {
      itemId: this.params.itemId || null,
      itemType: this.params.itemType || "movie",
      videoId: this.params.videoId || null,
      season: this.params.season == null ? null : Number(this.params.season),
      episode: this.params.episode == null ? null : Number(this.params.episode)
    });
    this.paused = false;
    this.hideStreamPanel();
  },

  // ── Episode panel ────────────────────────────────────────────────────────

  toggleEpisodePanel() {
    if (!this.episodes.length) return;
    if (this.episodePanelVisible) { this.hideEpisodePanel(); return; }
    this.closeAllPanels();
    this.episodePanelVisible = true;
    this.renderEpisodePanel();
    this.clearControlsAutoHide();
    this.renderControlButtons();
  },

  renderEpisodePanel() {
    this.container.querySelector("#episodeSidePanel")?.remove();
    if (!this.episodePanelVisible) return;

    // Costruisci set degli episodi guardati (usano videoId come contentId nel WatchedItemsStore)
    const watchedSet = new Set(
      WatchedItemsStore.listAll().map((w) => w.contentId)
    );
    // Episodi con progresso parziale salvato
    const inProgressIds = new Set(
      WatchProgressStore.list().map((p) => p.videoId).filter(Boolean)
    );
    const currentVideoId = this.params?.videoId || null;

    const items = this.episodes.slice(0, 80).map((ep) => {
      const isPlaying = ep.id === currentVideoId;
      const isWatched = watchedSet.has(ep.id) && !isPlaying;
      const inProgress = inProgressIds.has(ep.id) && !isPlaying;
      let badge = "";
      if (isPlaying)   badge = "▶";
      else if (isWatched)  badge = "✓";
      else if (inProgress) badge = "…";
      const label = `${badge ? badge + " " : ""}S${ep.season}E${ep.episode} ${ep.title || "Episodio"}`;
      return {
        label,
        sub: ep.overview || "",
        extraClass: isPlaying ? "playing" : isWatched ? "watched" : inProgress ? "in-progress" : ""
      };
    });

    const panel = document.createElement("div");
    panel.id = "episodeSidePanel";
    panel.className = "player-side-panel";
    panel.innerHTML = this._buildPanelHtml("episodeList", "Episodi", "▲▼ seleziona &nbsp; OK riproduci &nbsp; ← chiudi", items, this.episodePanelIndex);
    this.container.appendChild(panel);
    requestAnimationFrame(() => this._scrollPanelToSelected("episodeList"));
  },

  hideEpisodePanel() {
    this.episodePanelVisible = false;
    this.container.querySelector("#episodeSidePanel")?.remove();
    this.resetControlsAutoHide();
    this.renderControlButtons();
  },

  // ── Panel utilities ──────────────────────────────────────────────────────

  closeAllPanels() {
    this.subtitlePanelVisible = false;
    this.audioPanelVisible = false;
    this.streamPanelVisible = false;
    this.episodePanelVisible = false;
    ["#playerSubtitlePanel", "#playerAudioPanel", "#playerStreamPanel", "#episodeSidePanel"]
      .forEach((sel) => this.container.querySelector(sel)?.remove());
  },

  getActivePanelName() {
    if (this.subtitlePanelVisible) return "subtitle";
    if (this.audioPanelVisible) return "audio";
    if (this.streamPanelVisible) return "stream";
    if (this.episodePanelVisible) return "episode";
    return null;
  },

  movePanelSelection(delta) {
    const panel = this.getActivePanelName();
    if (!panel) return;

    if (panel === "subtitle") {
      this.subtitlePanelIndex = Math.min(this.getTextTracks().length, Math.max(0, this.subtitlePanelIndex + delta));
      this.renderSubtitlePanel();
    } else if (panel === "audio") {
      const n = this.getAudioTracks().length;
      if (!n) return;
      this.audioPanelIndex = Math.min(n - 1, Math.max(0, this.audioPanelIndex + delta));
      this.renderAudioPanel();
    } else if (panel === "stream") {
      this.streamPanelIndex = Math.min(this.streamCandidates.length - 1, Math.max(0, this.streamPanelIndex + delta));
      this.renderStreamPanel();
    } else if (panel === "episode") {
      this.episodePanelIndex = Math.min(this.episodes.length - 1, Math.max(0, this.episodePanelIndex + delta));
      this.renderEpisodePanel();
    }
  },

  confirmPanelSelection() {
    const panel = this.getActivePanelName();
    if (panel === "subtitle") { this.applySubtitleFromPanel(); }
    else if (panel === "audio") { this.applyAudioFromPanel(); }
    else if (panel === "stream") { this.applyStreamFromPanel(); }
    else if (panel === "episode") { this.playEpisodeFromPanel(); }
  },

  closeFocusedPanel() {
    const panel = this.getActivePanelName();
    if (panel === "subtitle") { this.hideSubtitlePanel(); }
    else if (panel === "audio") { this.hideAudioPanel(); }
    else if (panel === "stream") { this.hideStreamPanel(); }
    else if (panel === "episode") { this.hideEpisodePanel(); }
  },

  // ── External player ──────────────────────────────────────────────────────

  openExternalPlayer() {
    const stream = this.streamCandidates[this.currentStreamIndex];
    const url = stream?.url || this.params?.streamUrl;
    if (!url) return;

    // Prova webOS application manager (lancia il browser di sistema)
    try {
      if (typeof webOSSystem !== "undefined" || window.webOS) {
        const svc = window.webOS?.service;
        if (svc) {
          svc.request("luna://com.webos.applicationManager", {
            method: "launch",
            parameters: { id: "com.webos.app.browser", params: { target: url } },
            onSuccess: () => {},
            onFailure: () => { this._tryWindowOpen(url); }
          });
          return;
        }
      }
    } catch { }
    this._tryWindowOpen(url);
  },

  _tryWindowOpen(url) {
    try { window.open(url, "_blank"); } catch { }
  },

  // ── Controls UI ──────────────────────────────────────────────────────────

  setControlsVisible(visible, { zone = null } = {}) {
    this.controlsVisible = Boolean(visible);
    const overlay = this.container.querySelector("#playerControlsOverlay");
    if (!overlay) return;
    overlay.classList.toggle("hidden", !this.controlsVisible);
    if (this.controlsVisible) {
      if (zone) this.focusZone = zone;
      this.renderControlButtons();
      this._updateScrubberFocus();
      this.resetControlsAutoHide();
    } else {
      this.focusZone = "video";
      this._updateScrubberFocus();
      this.clearControlsAutoHide();
    }
  },

  _updateScrubberFocus() {
    const track = this.container.querySelector("#playerProgressTrack");
    if (track) track.classList.toggle("focused", this.focusZone === "scrubber");
  },

  focusFirstControl() {
    const btns = Array.from(this.container.querySelectorAll(".player-control-btn"));
    if (!btns.length) return;
    btns.forEach((b) => b.classList.remove("focused"));
    btns[0].classList.add("focused");
  },

  clearControlsAutoHide() {
    if (this.controlsHideTimer) { clearTimeout(this.controlsHideTimer); this.controlsHideTimer = null; }
  },

  resetControlsAutoHide() {
    this.clearControlsAutoHide();
    if (!this.controlsVisible || this.paused || this.getActivePanelName()) return;
    this.controlsHideTimer = setTimeout(() => this.setControlsVisible(false), 4500);
  },

  updateLoadingVisibility() {
    const el = this.container.querySelector("#playerLoadingOverlay");
    if (el) el.classList.toggle("hidden", !this.loadingVisible);
  },

  updateUiTick() {
    const video = PlayerController.video;
    const cur = Number(video?.currentTime || 0);
    const dur = Number(video?.duration || 0);
    const progress = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
    const pct = `${Math.round(progress * 10000) / 100}%`;
    const pf = this.container.querySelector("#playerProgressFill");
    if (pf) pf.style.width = pct;
    const thumb = this.container.querySelector("#playerProgressThumb");
    if (thumb) thumb.style.left = pct;
    const clock = this.container.querySelector("#playerClock");
    if (clock) clock.textContent = formatClock(new Date());
    const endsAt = this.container.querySelector("#playerEndsAt");
    if (endsAt) endsAt.textContent = formatEndsAt(cur, dur);
    const tl = this.container.querySelector("#playerTimeLabel");
    if (tl) tl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
  },

  // ── Video events ─────────────────────────────────────────────────────────

  bindVideoEvents() {
    const video = PlayerController.video;
    if (!video) return;
    const bindings = [
      ["waiting",       () => { this.loadingVisible = true; this.updateLoadingVisibility(); }],
      ["playing",       () => { this.loadingVisible = false; this.paused = false; this.updateLoadingVisibility(); this.updateUiTick(); this.resetControlsAutoHide(); }],
      ["pause",         () => { if (video.ended) return; this.paused = true; this.setControlsVisible(true, { zone: "controls" }); this.updateUiTick(); }],
      ["timeupdate",    () => { this.updateUiTick(); this._throttledSaveProgress(); }],
      ["loadedmetadata",() => {
        this.updateUiTick();
        // Ripristina posizione salvata (se significativa)
        this._handleResumeOnLoad();
        // Alcuni stream caricano le tracce con ritardo (es. MKV con sub embedded)
        setTimeout(() => {
          this.syncTrackState();
          if (this.subtitlePanelVisible) this.renderSubtitlePanel();
          if (this.audioPanelVisible) this.renderAudioPanel();
          this.renderControlButtons();
        }, 800);
      }]
    ];
    bindings.forEach(([ev, h]) => { video.addEventListener(ev, h); this.videoListeners.push({ eventName: ev, handler: h }); });
  },

  unbindVideoEvents() {
    const video = PlayerController.video;
    if (!video) return;
    this.videoListeners.forEach(({ eventName, handler }) => video.removeEventListener(eventName, handler));
    this.videoListeners = [];
  },

  // ── Player actions ───────────────────────────────────────────────────────

  seekBy(seconds) {
    const video = PlayerController.video;
    if (!video || Number.isNaN(video.currentTime)) return;
    const dur = Number(video.duration || 0);
    let next = Math.max(0, (video.currentTime || 0) + seconds);
    if (dur > 0) next = Math.min(dur, next);
    video.currentTime = next;
    this.updateUiTick();
    this.resetControlsAutoHide();
  },

  togglePause() {
    if (this.paused) {
      PlayerController.resume();
      this.paused = false;
    } else {
      PlayerController.pause();
      this.paused = true;
      this.setControlsVisible(true, { zone: "controls" });
    }
    this.renderControlButtons();
  },

  moveControlFocus(delta) {
    const controls = Array.from(this.container.querySelectorAll(".player-control-btn"));
    if (!controls.length) return;
    const focused = this.container.querySelector(".player-control-btn.focused") || controls[0];
    let idx = controls.indexOf(focused);
    if (idx < 0) idx = 0;
    const next = Math.min(controls.length - 1, Math.max(0, idx + delta));
    if (next === idx) return;
    focused.classList.remove("focused");
    controls[next].classList.add("focused");
    this.resetControlsAutoHide();
  },

  performFocusedControl() {
    const btn = this.container.querySelector(".player-control-btn.focused");
    if (!btn) return;
    this.performControlAction(btn.dataset.ctrl || "");
  },

  performControlAction(action) {
    if (action === "seekBack")     { this.seekBy(-10); return; }
    if (action === "seekForward")  { this.seekBy(10); return; }
    if (action === "playPause")    { this.togglePause(); return; }
    if (action === "subtitlePanel"){ this.toggleSubtitlePanel(); return; }
    if (action === "audioPanel")   { this.toggleAudioPanel(); return; }
    if (action === "streamPanel")  { this.toggleStreamPanel(); return; }
    if (action === "episodePanel") { this.toggleEpisodePanel(); return; }
    if (action === "external")     { this.openExternalPlayer(); return; }
  },

  // ── Key handler ──────────────────────────────────────────────────────────
  //
  // Modello a 3 zone:
  //   video    → controlli nascosti, nessuna azione su ←/→
  //   scrubber → ←/→ seekano, ↑ torna a video, ↓ va a controls
  //   controls → ←/→ navigano bottoni, ↑ torna a scrubber, ↓ torna a video

  onKeyDown(event) {
    const k = Number(event?.keyCode || 0);

    // Shortcuts globali (sempre attivi)
    if (k === 83) { this.toggleSubtitlePanel(); return; }
    if (k === 84) { this.toggleAudioPanel(); return; }
    if (k === 67) { this.toggleStreamPanel(); return; }
    if (k === 69) { this.toggleEpisodePanel(); return; }
    if (k === 80) { this.togglePause(); return; }

    // ── Panel aperto: usa ↑↓ per navigare, OK per confermare, ← per chiudere
    const panel = this.getActivePanelName();
    if (panel) {
      if (k === 38) { this.movePanelSelection(-1); return; }
      if (k === 40) { this.movePanelSelection(1);  return; }
      if (k === 13) { this.confirmPanelSelection(); return; }
      if (k === 37) { this.closeFocusedPanel(); return; }
      return;
    }

    const zone = this.focusZone;

    // ── Zona VIDEO (controlli nascosti)
    if (zone === "video") {
      if (k === 38) {
        // ↑ dal video: mostra controlli, vai a scrubber
        this.setControlsVisible(true, { zone: "scrubber" });
        return;
      }
      if (k === 13) {
        // OK: mostra controlli, vai a scrubber
        this.setControlsVisible(true, { zone: "scrubber" });
        return;
      }
      // ←/→/↓ ignorati in zona video
      return;
    }

    // ── Zona SCRUBBER
    if (zone === "scrubber") {
      if (k === 37) { this.seekBy(-10); this.resetControlsAutoHide(); return; } // ← seek -10s
      if (k === 39) { this.seekBy(10);  this.resetControlsAutoHide(); return; } // → seek +10s
      if (k === 40) {
        // ↓ da scrubber: vai a controls
        this.focusZone = "controls";
        this._updateScrubberFocus();
        this.focusFirstControl();
        this.resetControlsAutoHide();
        return;
      }
      if (k === 38) {
        // ↑ da scrubber: torna a video (nascondi controlli)
        this.setControlsVisible(false);
        return;
      }
      if (k === 13) { this.togglePause(); return; } // OK su scrubber: play/pause
      return;
    }

    // ── Zona CONTROLS
    if (zone === "controls") {
      if (k === 37) { this.moveControlFocus(-1); this.resetControlsAutoHide(); return; }
      if (k === 39) { this.moveControlFocus(1);  this.resetControlsAutoHide(); return; }
      if (k === 38) {
        // ↑ da controls: vai a scrubber
        this.focusZone = "scrubber";
        this._updateScrubberFocus();
        this.resetControlsAutoHide();
        return;
      }
      if (k === 40) {
        // ↓ da controls: torna a video
        this.setControlsVisible(false);
        return;
      }
      if (k === 13) { this.performFocusedControl(); return; }
      return;
    }

    this.resetControlsAutoHide();
  },

  // ── Tracks ───────────────────────────────────────────────────────────────

  getTextTracks() {
    const v = PlayerController.video;
    return (v?.textTracks) ? Array.from(v.textTracks) : [];
  },

  getAudioTracks() {
    const v = PlayerController.video;
    return (v?.audioTracks) ? Array.from(v.audioTracks) : [];
  },

  syncTrackState() {
    this.selectedSubtitleTrackIndex = this.getTextTracks().findIndex((t) => t.mode === "showing");
    this.selectedAudioTrackIndex    = this.getAudioTracks().findIndex((t) => t.enabled);
  },

  // ── Subtitles ────────────────────────────────────────────────────────────

  async loadSubtitles() {
    if (!this.params.itemId || !this.params.itemType) return;
    try {
      this.subtitles = await subtitleRepository.getSubtitles(this.params.itemType, this.params.itemId);
      this.attachExternalSubtitles();
      this.syncTrackState();
    } catch { this.subtitles = []; }
  },

  attachExternalSubtitles() {
    const video = PlayerController.video;
    if (!video) return;
    this.externalTrackNodes.forEach((n) => n.remove());
    this.externalTrackNodes = [];
    this.subtitles.slice(0, 10).forEach((sub, i) => {
      if (!sub.url) return;
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = sub.lang || `Sub ${i + 1}`;
      track.srclang = (sub.lang || "und").slice(0, 2).toLowerCase();
      track.src = sub.url;
      video.appendChild(track);
      this.externalTrackNodes.push(track);
    });
  },

  // ── Episode playback ─────────────────────────────────────────────────────

  async playEpisodeFromPanel() {
    if (this.switchingEpisode || !this.episodes.length) return;
    const selected = this.episodes[this.episodePanelIndex];
    if (!selected?.id) return;
    this.switchingEpisode = true;
    try {
      const itemType = this.params?.itemType || "series";
      const result = await streamRepository.getStreamsFromAllAddons(itemType, selected.id);
      const streams = (result?.status === "success")
        ? (result.data || []).flatMap((g) => (g.streams || []).map((s) => ({ ...s, addonName: g.addonName || "Addon" }))).filter((s) => s.url)
        : [];
      if (!streams.length) return;
      const next = this.episodes[this.episodePanelIndex + 1] || null;
      Router.navigate("player", {
        streamUrl: this.selectBestStreamUrl(streams) || streams[0].url,
        itemId: this.params?.itemId, itemType,
        videoId: selected.id,
        season: selected.season ?? null, episode: selected.episode ?? null,
        episodeLabel: `S${selected.season}E${selected.episode}`,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerSubtitle: selected.title?.trim() || `S${selected.season}E${selected.episode}`,
        playerBackdropUrl: this.params?.playerBackdropUrl || null,
        playerLogoUrl: this.params?.playerLogoUrl || null,
        episodes: this.episodes, streamCandidates: streams,
        nextEpisodeVideoId: next?.id || null,
        nextEpisodeLabel: next ? `S${next.season}E${next.episode}` : null
      });
    } finally { this.switchingEpisode = false; }
  },

  // ── Watch progress & stream preference ────────────────────────────────

  _pickPreferredOrBestStream() {
    if (!this.streamCandidates.length) return null;
    // Cerca una sorgente con lo stesso titolo di quella salvata
    const preferred = this._savedProgress?.preferredStreamTitle;
    if (preferred) {
      const match = this.streamCandidates.find(
        (s) => (s.title || s.name || "") === preferred
      );
      if (match?.url) return match.url;
    }
    return this.selectBestStreamUrl(this.streamCandidates);
  },

  _savePreferredStream(stream) {
    if (!this.params.itemId || !stream?.url) return;
    const cur = WatchProgressStore.findOne(this.params.itemId, this.params.videoId ?? null) || {};
    WatchProgressStore.upsert({
      ...cur,
      contentId:    this.params.itemId,
      contentType:  this.params.itemType || "movie",
      videoId:      this.params.videoId ?? null,
      season:       this.params.season  ?? null,
      episode:      this.params.episode ?? null,
      preferredStreamTitle: stream.title || stream.name || "",
      updatedAt: Date.now()
    });
  },

  _throttledSaveProgress() {
    if (this._progressSaveTimer) return;
    this._progressSaveTimer = setTimeout(() => {
      this._progressSaveTimer = null;
      this._doSaveProgress();
    }, 5000);
  },

  _doSaveProgress() {
    const video = PlayerController.video;
    if (!video || !this.params.itemId) return;
    const cur = Number(video.currentTime || 0);
    const dur = Number(video.duration || 0);
    if (!dur || cur < 10) return;          // troppo presto per salvare
    const pct = cur / dur;
    if (pct > 0.95) return;               // quasi finito: non sovrascrivere
    const existing = WatchProgressStore.findOne(this.params.itemId, this.params.videoId ?? null) || {};
    WatchProgressStore.upsert({
      ...existing,
      contentId:    this.params.itemId,
      contentType:  this.params.itemType || "movie",
      videoId:      this.params.videoId  ?? null,
      season:       this.params.season   ?? null,
      episode:      this.params.episode  ?? null,
      currentTime:  Math.floor(cur),
      duration:     Math.floor(dur),
      updatedAt:    Date.now()
    });
  },

  _handleResumeOnLoad() {
    if (this._resumeHandled) return;
    this._resumeHandled = true;
    const saved = this._savedProgress;
    if (!saved) return;
    const savedTime = Number(saved.currentTime || 0);
    const savedDur  = Number(saved.duration    || 0);
    if (savedTime < 30) return;                        // meno di 30s: ricomincia
    if (savedDur > 0 && savedTime / savedDur > 0.95) return; // quasi finito
    this._showResumeDialog(savedTime);
  },

  _showResumeDialog(savedTime) {
    // Rimuovi eventuale dialog precedente
    this.container.querySelector("#playerResumeDialog")?.remove();

    const label = formatTime(savedTime);
    const dialog = document.createElement("div");
    dialog.id = "playerResumeDialog";
    dialog.className = "player-resume-dialog";
    dialog.innerHTML = `
      <div class="player-resume-text">Riprendi da <strong>${label}</strong>?</div>
      <div class="player-resume-actions">
        <button class="player-resume-btn player-resume-btn--yes" id="playerResumeBtnYes">▶ Riprendi</button>
        <button class="player-resume-btn player-resume-btn--no"  id="playerResumeBtnNo">Ricomincia</button>
      </div>
      <div class="player-resume-bar"><div class="player-resume-bar-fill" id="playerResumeBarFill"></div></div>
    `;
    this.container.appendChild(dialog);
    void dialog.offsetWidth;
    dialog.classList.add("visible");

    // Countdown 8s → auto-riprendi
    const TIMEOUT = 8000;
    const start = Date.now();
    const barFill = dialog.querySelector("#playerResumeBarFill");
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      if (barFill) barFill.style.width = `${Math.min(100, (elapsed / TIMEOUT) * 100)}%`;
    }, 80);

    const accept = () => {
      clearInterval(tick);
      clearTimeout(autoTimer);
      dialog.remove();
      const video = PlayerController.video;
      if (video) video.currentTime = savedTime;
    };
    const decline = () => {
      clearInterval(tick);
      clearTimeout(autoTimer);
      dialog.remove();
      // Cancella il progresso salvato così la prossima volta ricomincia
      if (this.params.itemId) {
        WatchProgressStore.remove(this.params.itemId, this.params.videoId ?? null);
      }
    };

    const autoTimer = setTimeout(accept, TIMEOUT);
    dialog.querySelector("#playerResumeBtnYes")?.addEventListener("click", accept);
    dialog.querySelector("#playerResumeBtnNo")?.addEventListener("click", decline);
  },

  async handlePlaybackEnded() {
    // Video completato: cancella il progresso salvato
    if (this.params.itemId) {
      WatchProgressStore.remove(this.params.itemId, this.params.videoId ?? null);
    }
    let nextVideoId = this.params?.nextEpisodeVideoId || null;
    let nextEpisode = null;
    if (!nextVideoId && this.params?.videoId && this.episodes.length) {
      const idx = this.episodes.findIndex((e) => e.id === this.params.videoId);
      nextEpisode = idx >= 0 ? this.episodes[idx + 1] : null;
      nextVideoId = nextEpisode?.id || null;
    }
    if (!nextEpisode && nextVideoId && this.episodes.length) nextEpisode = this.episodes.find((e) => e.id === nextVideoId) || null;
    const itemType = this.params?.itemType || "movie";
    if (!nextVideoId || (itemType !== "series" && itemType !== "tv")) return;
    try {
      const result = await streamRepository.getStreamsFromAllAddons(itemType, nextVideoId);
      const streams = (result?.status === "success")
        ? (result.data || []).flatMap((g) => (g.streams || []).map((s) => ({ ...s, addonName: g.addonName || "Addon" }))).filter((s) => s.url)
        : [];
      if (!streams.length) return;
      Router.navigate("player", {
        streamUrl: this.selectBestStreamUrl(streams) || streams[0].url,
        itemId: this.params?.itemId, itemType,
        videoId: nextVideoId,
        season: nextEpisode?.season ?? null, episode: nextEpisode?.episode ?? null,
        episodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerSubtitle: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : "",
        playerBackdropUrl: this.params?.playerBackdropUrl || null,
        playerLogoUrl: this.params?.playerLogoUrl || null,
        episodes: this.episodes, streamCandidates: streams,
        nextEpisodeVideoId: null, nextEpisodeLabel: null
      });
    } catch (err) { console.warn("Next episode failed", err); }
  },

  // ── Stream selection ─────────────────────────────────────────────────────

  selectBestStreamUrl(streams = []) {
    if (!streams.length) return null;
    const scored = streams.filter((s) => s?.url).map((s) => {
      const t = `${s.title || ""} ${s.name || ""}`.toLowerCase();
      let score = 0;
      if (t.includes("1080")) score += 30;
      if (t.includes("2160") || t.includes("4k")) score += 20;
      if (t.includes("web")) score += 8;
      if (t.includes("bluray")) score += 8;
      if (t.includes("cam")) score -= 40;
      if (t.includes("ts")) score -= 20;
      return { s, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.s?.url || streams[0]?.url || null;
  },

  // ── Cleanup ──────────────────────────────────────────────────────────────

  cleanup() {
    // Salva progresso finale prima di uscire
    this._doSaveProgress();
    if (this._progressSaveTimer) { clearTimeout(this._progressSaveTimer); this._progressSaveTimer = null; }
    if (this._visibilityHandler) { document.removeEventListener("visibilitychange", this._visibilityHandler); this._visibilityHandler = null; }
    this.container?.querySelector("#playerResumeDialog")?.remove();
    if (this._containerClickHandler) {
      this.container?.removeEventListener("click", this._containerClickHandler, true);
      this._containerClickHandler = null;
    }
    this.closeAllPanels();
    this.externalTrackNodes.forEach((n) => n.remove());
    this.externalTrackNodes = [];
    this.clearControlsAutoHide();
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    this.unbindVideoEvents();
    PlayerController.stop();
    if (this.container) {
      // Se il fade-out è già in corso (tasto Back), aspettare che finisca;
      // altrimenti nascondere subito (es. cambio episodio / navigate diretta).
      const alreadyFading = this.container.style.opacity === "0";
      const hide = () => {
        if (this.container) {
          this.container.style.display = "none";
          this.container.style.opacity = "";
          this.container.style.transition = "";
          this.container.querySelector("#playerUiRoot")?.remove();
        }
      };
      if (alreadyFading) {
        setTimeout(hide, 210); // attende il termine della transizione CSS (200ms)
      } else {
        this.container.querySelector("#playerUiRoot")?.remove();
        this.container.style.display = "none";
      }
    }
    if (this.endedHandler && PlayerController.video) {
      PlayerController.video.removeEventListener("ended", this.endedHandler);
      this.endedHandler = null;
    }
  }
};