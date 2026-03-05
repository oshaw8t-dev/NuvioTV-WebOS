import { Router } from "./router.js";
import { LocalStore } from "../../core/storage/localStore.js";

const ROTATED_DPAD_KEY = "rotatedDpadMapping";

function getArrowCodeFromKey(key) {
  if (key === "ArrowUp" || key === "Up") return 38;
  if (key === "ArrowDown" || key === "Down") return 40;
  if (key === "ArrowLeft" || key === "Left") return 37;
  if (key === "ArrowRight" || key === "Right") return 39;
  return null;
}

function isBackKey(event, normalizedCode) {
  const target = event?.target || null;
  const tagName = String(target?.tagName || "").toUpperCase();
  const isEditable = Boolean(
    target?.isContentEditable
    || tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT"
  );
  const key = String(event?.key || "");
  const keyLower = key.toLowerCase();
  const code = String(event?.code || "");
  const rawCode = Number(event?.keyCode || 0);
  if (isEditable && (key === "Backspace" || rawCode === 8 || key === "Delete" || rawCode === 46)) {
    return false;
  }
  if (normalizedCode === 461 || rawCode === 461) {
    return true;
  }
  if (
    key === "Escape" ||
    key === "Esc" ||
    key === "Backspace" ||
    key === "GoBack" ||
    key === "XF86Back" ||
    code === "BrowserBack" ||
    code === "GoBack"
  ) {
    return true;
  }
  if (keyLower.includes("back")) {
    return true;
  }
  if (rawCode === 27 || rawCode === 8 || rawCode === 10009) {
    return true;
  }
  return false;
}

function isSimulator() {
  const ua = String(globalThis.navigator?.userAgent || "").toLowerCase();
  return ua.includes("simulator");
}

function shouldUseRotatedMapping() {
  const stored = LocalStore.get(ROTATED_DPAD_KEY, null);
  if (typeof stored === "boolean") {
    return stored;
  }
  return isSimulator();
}

function normalizeDirectionalKeyCode(code) {
  const rotatedMap = {
    37: 38,
    38: 37,
    39: 40,
    40: 39
  };
  if (shouldUseRotatedMapping() && rotatedMap[code]) {
    return rotatedMap[code];
  }
  return code;
}

function buildNormalizedEvent(event) {
  const key = String(event?.key || "");
  const code = String(event?.code || "");
  const arrowFromKey = getArrowCodeFromKey(key);
  const rawCode = Number(arrowFromKey || event.keyCode || 0);
  const normalizedCode = normalizeDirectionalKeyCode(rawCode);
  return {
    key,
    code,
    target: event?.target || null,
    altKey: Boolean(event?.altKey),
    ctrlKey: Boolean(event?.ctrlKey),
    shiftKey: Boolean(event?.shiftKey),
    metaKey: Boolean(event?.metaKey),
    repeat: Boolean(event?.repeat),
    defaultPrevented: Boolean(event?.defaultPrevented),
    keyCode: normalizedCode,
    which: normalizedCode,
    originalKeyCode: rawCode,
    preventDefault: () => {
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
    },
    stopPropagation: () => {
      if (typeof event?.stopPropagation === "function") {
        event.stopPropagation();
      }
    },
    stopImmediatePropagation: () => {
      if (typeof event?.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }
  };
}

function makeFakeEnterEvent() {
  return {
    key: "Enter",
    code: "Enter",
    target: null,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    defaultPrevented: false,
    keyCode: 13,
    which: 13,
    originalKeyCode: 13,
    preventDefault: () => {},
    stopPropagation: () => {},
    stopImmediatePropagation: () => {}
  };
}

function isNativeInputElement(el) {
  const tag = String(el?.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export const FocusEngine = {
  lastBackHandledAt: 0,

  init() {
    this.boundHandleKey = this.handleKey.bind(this);
    document.addEventListener("keydown", this.boundHandleKey, true);
    this.initClickSupport();
  },

  initClickSupport() {
    document.addEventListener("click", async (event) => {
      // Se il click è su un input nativo, lascia che il browser gestisca tutto
      // (su webOS aprirà la tastiera di sistema)
      if (isNativeInputElement(event.target)) {
        event.target.focus();
        return;
      }

      const el = event.target.closest("[data-zone], [data-action], .focusable");
      if (!el) return;

      // Anche se l'elemento trovato col closest è un input, lascia stare
      if (isNativeInputElement(el)) {
        el.focus();
        return;
      }

      const screen = Router.getCurrentScreen();
      if (!screen) return;

      const hasZone = el.hasAttribute("data-zone");
      const hasAction = el.hasAttribute("data-action");

      if (hasZone) {
        // Pattern zone (plugin, settings): applyFocus + activateFocused o onKeyDown
        const zone = String(el.dataset.zone || "");

        if (zone === "rail") {
          screen.focusZone = "rail";
          if (el.dataset.railIndex !== undefined) screen.railIndex = Number(el.dataset.railIndex);
        } else if (zone === "nav") {
          screen.focusZone = "nav";
          if (el.dataset.navIndex !== undefined) screen.navIndex = Number(el.dataset.navIndex);
        } else if (zone === "panel") {
          screen.focusZone = "panel";
          if (el.dataset.panelIndex !== undefined) screen.panelIndex = Number(el.dataset.panelIndex);
        } else {
          screen.focusZone = "content";
          if (el.dataset.row !== undefined) screen.contentRow = Number(el.dataset.row);
          if (el.dataset.col !== undefined) screen.contentCol = Number(el.dataset.col);
          if (el.dataset.rowIndex !== undefined) screen.rowIndex = Number(el.dataset.rowIndex);
          if (el.dataset.colIndex !== undefined) screen.colIndex = Number(el.dataset.colIndex);
        }

        if (typeof screen.applyFocus === "function") screen.applyFocus();

        // Usa activateFocused se disponibile, altrimenti simula Enter via onKeyDown
        if (typeof screen.activateFocused === "function") {
          await screen.activateFocused();
        } else if (typeof screen.onKeyDown === "function") {
          await screen.onKeyDown(makeFakeEnterEvent());
        }
        return;
      }

      if (hasAction || el.classList.contains("focusable")) {
        // Pattern action (home, library, search): setta focused e simula Enter
        const allFocusable = document.querySelectorAll(".focusable");
        allFocusable.forEach((node) => node.classList.remove("focused"));
        el.classList.add("focused");
        el.focus();

        if (typeof screen.onKeyDown === "function") {
          await screen.onKeyDown(makeFakeEnterEvent());
        }
        return;
      }
    }, true);
  },

  handleKey(event) {
    if (event.defaultPrevented) {
      return;
    }

    const normalizedEvent = buildNormalizedEvent(event);

    if (isBackKey(event, normalizedEvent.keyCode)) {
      const now = Date.now();
      if (now - this.lastBackHandledAt < 180) {
        return;
      }
      this.lastBackHandledAt = now;
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      const currentScreen = Router.getCurrentScreen();
      if (currentScreen?.consumeBackRequest?.()) {
        return;
      }
      Router.back();
      return;
    }

    // CRITICO: blocca il click sintetico che il browser genera dopo un keydown Enter.
    // Senza questo, ogni pressione del tasto centrale del telecomando esegue
    // l'azione DUE VOLTE: una dal keydown e una dal click sintetico successivo,
    // causando glitch (toggle che si apre e chiude subito) e apertura indesiderata
    // del chooser sorgenti (il secondo run trova playDefault focalizzato dopo
    // che il primo run ha ri-renderizzato la schermata).
    const rawCode = Number(event?.keyCode || 0);
    if (rawCode === 13 || normalizedEvent.keyCode === 13) {
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    }

    const currentScreen = Router.getCurrentScreen();

    currentScreen?.onKeyDown?.(normalizedEvent);
  }
};