// =============================================================================
// Silicon Civilizations — Entry Point (main.js)
// Ties together all modules once the DOM is fully loaded.
//
// Load order enforced by index.html:
//   data.js → mapgen.js → ideaspace.js → engine.js → renderer.js → ui.js → main.js
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {

  // ── 1. INTRO SCREEN ─────────────────────────────────────────────────────────
  UI.initIntroScreen();

  // ── 2. NEW GAME BUTTON ──────────────────────────────────────────────────────
  // Transition to faction selection and populate the grid.
  const btnNewGame = document.getElementById('btn-new-game');
  if (btnNewGame) {
    btnNewGame.addEventListener('click', () => {
      UI.showScreen('faction');
      UI.initFactionScreen();
    });
  }

  // ── 3. START GAME BUTTON ────────────────────────────────────────────────────
  // "Lead This Civilization" — only fires if a faction has been selected.
  const btnStartGame = document.getElementById('btn-start-game');
  if (btnStartGame) {
    btnStartGame.addEventListener('click', () => {
      if (!UI.selectedFactionId) return;
      startNewGame(UI.selectedFactionId);
    });
  }

  // ── 4. HELP MODAL ───────────────────────────────────────────────────────────
  const btnHowToPlay = document.getElementById('btn-how-to-play');
  if (btnHowToPlay) {
    btnHowToPlay.addEventListener('click', () => UI.showModal('help-modal'));
  }

  const btnCloseHelp = document.getElementById('btn-close-help');
  if (btnCloseHelp) {
    btnCloseHelp.addEventListener('click', () => UI.hideModal('help-modal'));
  }

  // ── 5. GLOBAL MODAL DISMISS BUTTONS ─────────────────────────────────────────
  const btnDismissEvent = document.getElementById('btn-dismiss-event');
  if (btnDismissEvent) {
    btnDismissEvent.addEventListener('click', () => UI.hideModal('event-modal'));
  }

  const btnDismissCombat = document.getElementById('btn-dismiss-combat');
  if (btnDismissCombat) {
    btnDismissCombat.addEventListener('click', () => UI.hideModal('combat-modal'));
  }

  const btnDismissDiscovery = document.getElementById('btn-dismiss-discovery');
  if (btnDismissDiscovery) {
    btnDismissDiscovery.addEventListener('click', () => UI.hideModal('discovery-modal'));
  }

  const btnPlayAgain = document.getElementById('btn-play-again');
  if (btnPlayAgain) {
    btnPlayAgain.addEventListener('click', () => location.reload());
  }

  // ── 6. IDEA LAB ─────────────────────────────────────────────────────────────
  // The top-bar button is wired here; the close button and synthesize button
  // are also set up below. UI.initGameScreen() wires the in-game btn-open-idea-lab.
  const btnIdeaLab = document.getElementById('btn-open-idea-lab');
  if (btnIdeaLab) {
    btnIdeaLab.addEventListener('click', () => UI.openIdeaLab());
  }

  const btnCloseIdeaLab = document.getElementById('btn-close-idea-lab');
  if (btnCloseIdeaLab) {
    btnCloseIdeaLab.addEventListener('click', () => UI.closeIdeaLab());
  }

  const btnSynthesize = document.getElementById('btn-synthesize');
  if (btnSynthesize) {
    btnSynthesize.addEventListener('click', () => UI.onSynthesizeClicked());
  }

  // ── 7. MIX SLOT CLEAR BUTTONS ───────────────────────────────────────────────
  // Each .btn-clear-slot has data-slot="0" or data-slot="1".
  document.querySelectorAll('.btn-clear-slot').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = parseInt(btn.dataset.slot, 10);
      if (typeof IdeaSpace !== 'undefined') {
        // Directly clear the slot (null is accepted by IdeaSpace.selectForMix only
        // for discovered concepts, so we manipulate the array directly here).
        IdeaSpace.mixSlots[slot] = null;
        if (typeof Renderer !== 'undefined') Renderer.markDirty();
        UI.updateIdeaLab();
      }
    });
  });

  // ── 8. CONCEPT SEARCH ───────────────────────────────────────────────────────
  const conceptSearch = document.getElementById('concept-search');
  if (conceptSearch) {
    conceptSearch.addEventListener('input', () => {
      if (UI.ideaLabOpen) UI.updateIdeaLab();
    });
  }

  // ── 9. GLOBAL KEYBOARD SHORTCUTS ────────────────────────────────────────────
  // Note: game-screen-specific shortcuts (arrows, space, i) are also registered
  // inside UI.initGameScreen() for the game screen context; those handlers guard
  // on UI.currentScreen. These global handlers catch Escape and anything that
  // should work from any screen.
  document.addEventListener('keydown', (e) => {
    // Escape: close idea lab first, then any open modal
    if (e.key === 'Escape') {
      if (UI.ideaLabOpen) {
        UI.closeIdeaLab();
        return;
      }
      UI.hideAllModals();
      return;
    }

    // Space: end turn (only during player phase in the game screen)
    if (e.key === ' ' && UI.currentScreen === 'game' && !UI.ideaLabOpen) {
      if (typeof GameEngine !== 'undefined' && GameEngine.state?.phase === 'player') {
        e.preventDefault();
        UI.handleEndTurn();
      }
      return;
    }

    // i / I: toggle idea lab (only if a game is running)
    if ((e.key === 'i' || e.key === 'I') && UI.currentScreen === 'game') {
      if (typeof GameEngine !== 'undefined' && GameEngine.state) {
        if (UI.ideaLabOpen) {
          UI.closeIdeaLab();
        } else {
          UI.openIdeaLab();
        }
      }
      return;
    }
  });

}); // end DOMContentLoaded

// =============================================================================
// startNewGame — called when the player confirms faction selection
// =============================================================================

/**
 * Initialize all game systems and transition to the game screen.
 * @param {string} factionId  key from FACTIONS
 */
function startNewGame(factionId) {

  // ── Initialize game engine ─────────────────────────────────────────────────
  // Signature: GameEngine.init(factionId, mapWidth, mapHeight, numAICivs)
  if (typeof GameEngine === 'undefined') {
    console.error('startNewGame: GameEngine is not loaded.');
    UI.showNotification('Game engine not found. Check script load order.', 'danger', 5000);
    return;
  }
  GameEngine.init(factionId, 50, 35, 3);

  // ── Initialize IdeaSpace for player faction ────────────────────────────────
  if (typeof IdeaSpace !== 'undefined') {
    const playerCiv = GameEngine.getPlayerCiv ? GameEngine.getPlayerCiv() : null;
    const branchProf = playerCiv?.branchProficiency
      || (typeof FACTION_BRANCH_PROFICIENCY !== 'undefined'
          ? FACTION_BRANCH_PROFICIENCY[factionId]
          : undefined);
    IdeaSpace.init(factionId, branchProf);
  }

  // ── Transition to game screen ──────────────────────────────────────────────
  UI.showScreen('game');

  // ── Grab canvas elements ───────────────────────────────────────────────────
  const mapCanvas = document.getElementById('map-canvas');
  const csCanvas  = document.getElementById('concept-space-canvas');

  if (!mapCanvas) {
    console.error('startNewGame: #map-canvas not found.');
    return;
  }

  // ── Canvas resize helper ───────────────────────────────────────────────────
  function resizeCanvases() {
    const mapContainer = document.getElementById('map-container');
    if (mapContainer && mapCanvas) {
      mapCanvas.width  = mapContainer.clientWidth  || mapCanvas.offsetWidth  || 800;
      mapCanvas.height = mapContainer.clientHeight || mapCanvas.offsetHeight || 600;
    }

    if (csCanvas) {
      const csContainer = document.getElementById('concept-space-container');
      if (csContainer) {
        csCanvas.width  = csContainer.clientWidth  || 600;
        csCanvas.height = csContainer.clientHeight || 500;
      }
    }

    // Tell the renderer to redraw after resize
    if (typeof Renderer !== 'undefined' && Renderer.markDirty) {
      Renderer.markDirty();
    }
  }

  resizeCanvases();
  window.addEventListener('resize', resizeCanvases);

  // ── Initialize Renderer ────────────────────────────────────────────────────
  if (typeof Renderer === 'undefined') {
    console.warn('startNewGame: Renderer is not loaded — map will not display.');
  } else {
    Renderer.init(mapCanvas, csCanvas);

    // Wire hex click and hover events on the map canvas
    Renderer.setupMapEvents(
      (hex) => hex && UI.onHexSelected(hex.q, hex.r),
      (hex) => hex ? UI.onHexHovered(hex.q, hex.r) : UI.onHexHovered(null, null)
    );

    // Wire concept-space click and hover events
    if (csCanvas && Renderer.setupConceptSpaceEvents) {
      Renderer.setupConceptSpaceEvents(
        (conceptId) => UI.onConceptSelected(conceptId),
        (conceptId) => {
          Renderer.hoveredConcept = conceptId;
          Renderer.markDirty();
        }
      );
    }
  }

  // ── Initialize game screen UI (buttons, keyboard shortcuts) ────────────────
  UI.initGameScreen();

  // ── Initial UI refresh ─────────────────────────────────────────────────────
  UI.updateAllUI();

  // ── Center map on player capital ───────────────────────────────────────────
  const playerCiv = GameEngine.getPlayerCiv ? GameEngine.getPlayerCiv() : null;
  if (playerCiv?.capital && typeof Renderer !== 'undefined' && Renderer.centerOnHex) {
    Renderer.centerOnHex(playerCiv.capital.q, playerCiv.capital.r);
  }

  // ── Start render loop ──────────────────────────────────────────────────────
  // Passes state accessors so the renderer always reads live data.
  if (typeof Renderer !== 'undefined' && Renderer.startRenderLoop) {
    Renderer.startRenderLoop(
      // Map state accessor
      () => GameEngine.state,
      // Idea space state accessor
      () => {
        if (typeof IdeaSpace === 'undefined') return null;
        const connections = IdeaSpace.getConnections();
        return {
          nodes:         CONCEPTS,
          connections:   connections,
          discoveredSet: IdeaSpace.discoveredConcepts,
        };
      }
    );
  }

  // ── Welcome message ────────────────────────────────────────────────────────
  const faction = (typeof FACTIONS !== 'undefined') ? FACTIONS[factionId] : null;
  const civName = faction ? faction.name : factionId;
  if (GameEngine.addMessage) {
    GameEngine.addMessage(
      `Welcome, ${civName}! Your civilization begins. Build, research, and discover.`,
      'success'
    );
  }
  UI.updateEventLog();

  // ── Subscribe to IdeaSpace win-condition events ────────────────────────────
  window.addEventListener('ideaspace:winCondition', (e) => {
    const { concept } = e.detail;
    const stats = _gatherEndStats();
    UI.showEndModal(playerCiv?.id, 'tech', stats);

    if (GameEngine.addMessage) {
      GameEngine.addMessage(`🏆 ${civName} discovered ${concept.name} — TECH VICTORY!`, 'success');
    }
  });
}

// =============================================================================
// UI.handleEndTurn — exposed on the UI object so initGameScreen and keyboard
// shortcuts both call the same function.
// =============================================================================

/**
 * Advance the game by one turn for the player.
 * Processes engine logic, refreshes UI, and handles end-game conditions.
 */
UI.handleEndTurn = function () {
  if (typeof GameEngine === 'undefined' || !GameEngine.state) return;
  if (GameEngine.state.phase !== 'player') return;

  // Disable the end-turn button while processing to prevent double-clicks
  const btnEndTurn = document.getElementById('btn-end-turn');
  if (btnEndTurn) btnEndTurn.disabled = true;

  let results = {};
  try {
    results = GameEngine.endPlayerTurn() || {};
  } catch (err) {
    console.error('GameEngine.endPlayerTurn error:', err);
    UI.showNotification('An error occurred ending the turn.', 'danger');
  }

  // Refresh the entire UI
  UI.updateAllUI();

  // Tell the renderer to redraw
  if (typeof Renderer !== 'undefined' && Renderer.markDirty) {
    Renderer.markDirty();
  }

  // Re-enable the end-turn button
  if (btnEndTurn) btnEndTurn.disabled = false;

  // Show event modals for any events that fired this turn
  // We stagger them so they don't stack all at once.
  const events = results.events || [];
  events.forEach((evt, idx) => {
    setTimeout(() => {
      UI.showEventModal(evt, evt.appliedEffects || evt.effect || {});
    }, idx * 200 + 100);
  });

  // Check win/lose condition
  const winner = GameEngine.state.winner;
  if (winner) {
    const delay = events.length * 200 + 600;
    setTimeout(() => {
      const stats = _gatherEndStats();
      UI.showEndModal(winner.winner, winner.type, stats);
    }, delay);
  }
};

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/**
 * Gather final game statistics for the end modal.
 * @private
 * @returns {Object}
 */
function _gatherEndStats() {
  const state     = typeof GameEngine !== 'undefined' ? GameEngine.state : null;
  const playerCiv = typeof GameEngine !== 'undefined' && GameEngine.getPlayerCiv
    ? GameEngine.getPlayerCiv() : null;

  if (!state || !playerCiv) return {};

  // Count current tiles
  let tiles = 0;
  if (state.map) {
    for (const tile of state.map.values()) {
      if (tile.owner === playerCiv.id) tiles++;
    }
  }

  const discoveries = typeof IdeaSpace !== 'undefined'
    ? IdeaSpace.discoveredConcepts.size
    : 0;

  return {
    turnsReached:        state.turn ?? 0,
    conceptsDiscovered:  discoveries,
    peakTiles:           playerCiv.peakTiles ?? tiles,
    finalCompute:        playerCiv.resources?.compute ?? 0,
  };
}
