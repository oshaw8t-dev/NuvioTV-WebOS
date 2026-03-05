/**
 * clickBridge.js
 * Aggiunge il supporto click del mouse a tutte le schermate
 * che usano la navigazione D-pad (data-zone, data-row, data-col)
 */

export function bindClicks(container, screen) {
    const focusables = container.querySelectorAll("[data-zone]");
    focusables.forEach(el => {
        // Rimuovi listener precedenti clonando il nodo
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
    });

    // Riseleziona dopo la sostituzione
    container.querySelectorAll("[data-zone]").forEach(el => {
        el.style.cursor = "pointer";
        el.addEventListener("click", async () => {
            const zone = el.dataset.zone;

            if (zone === "rail") {
                screen.focusZone = "rail";
                screen.railIndex = Number(el.dataset.railIndex ?? screen.railIndex ?? 0);
            } else {
                screen.focusZone = "content";
                if (el.dataset.row !== undefined) screen.contentRow = Number(el.dataset.row);
                if (el.dataset.col !== undefined) screen.contentCol = Number(el.dataset.col);
            }

            if (typeof screen.applyFocus === "function") screen.applyFocus();
            if (typeof screen.activateFocused === "function") await screen.activateFocused();
        });
    });
}