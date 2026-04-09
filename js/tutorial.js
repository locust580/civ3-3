// =============================================================================
// Silicon Civilizations — Tutorial Engine (tutorial.js)
// Self-contained interactive tutorial with speech-bubble overlay, action
// detection via CustomEvents + DOM polling, and faction-specific hints.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Step builder — returns all steps for the given factionId
// ---------------------------------------------------------------------------
function buildSteps(factionId) {
  const faction = (typeof FACTIONS !== 'undefined' && FACTIONS[factionId]) || {};
  const factionName = faction.name || 'Commander';
  const factionSubtitle = faction.subtitle || '';

  // Faction-specific resource tip (step 3 subtext)
  const resourceTips = {
    ancients:     'Your Mythological Research bonus means ancient combinations cost far less than other factions.',
    calculists:   'Your +2 Research bonus makes math-branch syntheses almost guaranteed to succeed early on.',
    electricians: 'Your +3 Energy bonus gives you a strong power lead — build Silicon Extractors to match it.',
    retronaughts: 'Your +2 Compute bonus accelerates Vacuum Tube era combinations. Stockpile it early.',
    cybernetix:   'Your +3 Data bonus synergises with network concepts — treat Data like a second Research resource.',
    neural:       'Your +2 Research and +2 Compute bonuses make you the fastest faction at reaching Deep Learning.',
    dystopians:   'Your +3 Military bonus is unique — pair it with Networks concepts for a control-economy advantage.',
    utopians:     'Your +3 Research bonus is the highest of any faction. Build Research Nodes first and snowball.',
  };

  // Faction-specific branch proficiency tip (step 13 subtext)
  const branchTips = {
    ancients:     'Your Archaeotech:5 makes mythological concepts very cheap to combine — start there.',
    calculists:   'Your Logic:4 and Engineering:3 make you a natural bridge between ancient math and computing.',
    electricians: 'Your Engineering:5 dramatically reduces the cost of electrical-branch syntheses.',
    retronaughts: 'Your Electronics:4 gives you a head-start on Vacuum Tube era combos.',
    cybernetix:   'Your Networks:4 means internet-era combinations rarely fail for you.',
    neural:       'Your AI:5 proficiency makes deep learning combinations very reliable.',
    dystopians:   'Your Military:4 and Networks:3 combination enables powerful control-economy synergies.',
    utopians:     'Your Cognitive Science:4 is unmatched — lean into it to reach collaborative discoveries faster.',
  };

  // Faction-specific strategy tip (step 18 text)
  const strategyTips = {
    ancients:     'Strategy tip: Your ancient tradition is rich in mythological combinations. Bronze Automaton + Greek Clockwork is an early power move. Branch toward Engineering to unlock electrical concepts.',
    calculists:   'Strategy tip: Your Logic + Engineering proficiency makes you a natural bridge between ancient math and modern computing. Rush Formal Logic then branch into Electrical concepts.',
    electricians: 'Strategy tip: Your Engineering:5 makes electrical concepts very cheap. Rush Vacuum Tube → Logic Gate → Transistor → Integrated Circuit for a strong Computation foundation.',
    retronaughts: 'Strategy tip: You start with both Vacuum Tube and Boolean Logic — Logic Gate is one synthesis away! Rush Integrated Circuit → Microprocessor for a huge early compute lead.',
    cybernetix:   'Strategy tip: Your ARPANET start gives you a Networks foothold. Combine with Encryption to reach Internet, then World Wide Web. A data economy is your fastest path to AGI.',
    neural:       'Strategy tip: You start with Machine Learning! Deep Learning is just one synthesis away with a Microprocessor. The AI branch leads straight to AGI — your win condition.',
    dystopians:   'Strategy tip: Your military focus and Networks proficiency make a control economy powerful. Prioritize Defense Arrays early, then build toward AI to weaponize it.',
    utopians:     'Strategy tip: Your Cognitive Science proficiency is your greatest asset. Collaborative concept-sharing is your special ability — discover quickly and expand your knowledge graph.',
  };

  const resourceTip  = resourceTips[factionId]  || 'Manage your resources carefully — each feeds into your synthesis pipeline.';
  const branchTip    = branchTips[factionId]     || 'Invest in the branches that match your starter concepts.';
  const strategyTip  = strategyTips[factionId]   || 'Build steadily, synthesize often, and adapt to what your opponents are doing.';

  return [
    // Step 1 — Welcome (click-next)
    {
      text: `Welcome, <strong>${factionName}</strong>! <em>${factionSubtitle}</em>. Your mission: advance your technological civilization to supremacy.`,
      subtext: 'You can skip this tutorial at any time.',
      target: '#player-faction-badge',
      requiresAction: null,
      position: 'below',
    },

    // Step 2 — Map overview (click-next)
    {
      text: 'This is your territory — the hex map. Your hexes are highlighted in your civilization\'s color. Unexplored regions are cloaked in fog.',
      subtext: 'Pan with click+drag, zoom with the scroll wheel.',
      target: '#map-container',
      requiresAction: null,
      position: 'right',
    },

    // Step 3 — Resources (click-next)
    {
      text: 'Your resources are shown here. Energy ⚡ powers buildings, Silicon 💎 is your core material, Research 🔬 fuels discoveries.',
      subtext: resourceTip,
      target: '#resource-bar',
      requiresAction: null,
      position: 'below',
    },

    // Step 4 — Force hex selection
    {
      text: 'Select a tile you own. Click on any hex in your territory to inspect it.',
      subtext: 'Your tiles are shown in your faction\'s color.',
      target: '#map-container',
      requiresAction: 'hex_selected',
      position: 'right',
    },

    // Step 5 — Tile info (click-next)
    {
      text: 'The right panel shows tile details — its terrain type, what resources it produces, and actions you can take here.',
      subtext: null,
      target: '#panel-right',
      requiresAction: null,
      position: 'left',
    },

    // Step 6 — Force build menu
    {
      text: 'Let\'s build something. Click <strong>Build</strong> on your selected tile to open the build menu.',
      subtext: null,
      target: '#panel-right',
      requiresAction: 'build_menu_opened',
      position: 'left',
    },

    // Step 7 — Force place Research Node
    {
      text: 'Build a <strong>Research Node</strong>. It generates 2 Research Points per turn — the fuel for your Idea Lab.',
      subtext: 'Research Nodes can be built on any tile you own.',
      target: '#build-panel',
      requiresAction: 'building_placed',
      position: 'left',
    },

    // Step 8 — Research points (click-next)
    {
      text: 'Research Points are now flowing in each turn. Watch this value grow as you build more nodes.',
      subtext: null,
      target: '#resource-bar',
      requiresAction: null,
      position: 'below',
    },

    // Step 9 — Force End Turn
    {
      text: 'Click <strong>End Turn</strong> to advance time. Your resources are collected, and your opponents take their turns.',
      subtext: 'Shortcut: press Space.',
      target: '#btn-end-turn',
      requiresAction: 'end_turn',
      position: 'above',
    },

    // Step 10 — Event log (click-next)
    {
      text: 'The Event Log records everything that happened — opponent moves, events, discoveries. Check it for strategic information.',
      subtext: null,
      target: '#event-log',
      requiresAction: null,
      position: 'above',
    },

    // Step 11 — Force open Idea Lab
    {
      text: 'Time to visit the Idea Lab! This is where you\'ll make discoveries that advance your civilization. Click to open it.',
      subtext: 'Shortcut: press I.',
      target: '#btn-open-idea-lab',
      requiresAction: 'idea_lab_opened',
      position: 'below',
    },

    // Step 12 — Concept Space intro (click-next)
    {
      text: 'This is the <strong>Concept Space</strong> — a constellation of technological ideas spanning history. Concepts are organized from Ancient (bottom) to Modern (top), and Physical (left) to Abstract (right).',
      subtext: 'Pan by click+dragging. Zoom with scroll wheel.',
      target: '#concept-space-canvas',
      requiresAction: null,
      position: 'right',
    },

    // Step 13 — Branch proficiency (click-next)
    {
      text: 'These bars show your <strong>Research Branch Proficiency</strong>. Higher proficiency in a branch means cheaper, more reliable syntheses within that tradition.',
      subtext: branchTip,
      target: '#branch-bars-overlay',
      requiresAction: null,
      position: 'right',
    },

    // Step 14 — Force select first concept
    {
      text: 'Click a discovered concept from the list (or click a bright node on the constellation) to add it to the Synthesis Chamber.',
      subtext: 'Discovered concepts glow brightly. Undiscovered ones are dimmed.',
      target: '#concept-list',
      requiresAction: 'concept_selected_1',
      position: 'right',
    },

    // Step 15 — Force select second concept
    {
      text: 'Now select a <strong>second concept</strong>. The success chance and cost preview will update to show how compatible these concepts are.',
      subtext: null,
      target: '#mix-slot-1',
      requiresAction: 'concept_selected_2',
      position: 'above',
    },

    // Step 16 — Force synthesize
    {
      text: 'Click <strong>Synthesize!</strong> If successful, a new concept is discovered. If it fails, you\'ll still gather insight — try again with more Research Points or improved proficiency.',
      subtext: null,
      target: '#btn-synthesize',
      requiresAction: 'synthesis_attempted',
      position: 'above',
    },

    // Step 17 — Post-synthesis (click-next)
    {
      text: 'Each new concept unlocks new connections in the constellation. Some concepts are only discoverable through combination!',
      subtext: 'Look for "Research Leads" below the concept list for hints on what to combine next.',
      target: '#concept-space-canvas',
      requiresAction: null,
      position: 'right',
    },

    // Step 18 — Faction strategy tip (click-next)
    {
      text: strategyTip,
      subtext: null,
      target: '#player-faction-badge',
      requiresAction: null,
      position: 'below',
    },

    // Step 19 — Military basics (click-next)
    {
      text: 'You can also train units. <strong>Scouts</strong> explore fog, <strong>Warriors</strong> defend and attack, and advanced units require concept discoveries.',
      subtext: 'Select an owned tile and look for "Train Unit" in the right panel.',
      target: '#unit-panel',
      requiresAction: null,
      position: 'left',
    },

    // Step 20 — Final (click-next, centered)
    {
      text: `You're ready to lead your civilization! Remember:<br><br>
        Build structures → Generate resources → Synthesize concepts → Advance your tradition → Achieve tech or military victory.`,
      subtext: `Good luck, ${factionName}!`,
      target: null,
      requiresAction: null,
      position: 'center',
    },
  ];
}

// ---------------------------------------------------------------------------
// Tutorial object
// ---------------------------------------------------------------------------
const Tutorial = {
  active: false,
  currentStep: 0,
  steps: [],
  _pollInterval: null,
  _actionPending: false,  // true when requiresAction is set and not yet completed
  _firedActions: new Set(), // actions fired this step (reset each step)

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Start the tutorial for the given factionId. */
  start(factionId) {
    if (this.active) return;

    this.active = true;
    this.currentStep = 0;
    this.steps = buildSteps(factionId || 'ancients');
    this._firedActions = new Set();

    this._createOverlay();
    this._bindEvents();
    this._startPolling();
    this._render();

    // Announce to other game systems
    window.dispatchEvent(new CustomEvent('tutorial:started', { detail: { factionId } }));
  },

  /** Skip the tutorial completely. */
  skip() {
    if (!this.active) return;
    this._teardown();
    window.dispatchEvent(new CustomEvent('tutorial:skipped'));
  },

  /** Advance to the next step (called by "Next" button or after action). */
  next() {
    if (!this.active) return;

    this._clearHighlights();
    this._firedActions = new Set();
    this._actionPending = false;

    this.currentStep++;

    if (this.currentStep >= this.steps.length) {
      this._teardown();
      window.dispatchEvent(new CustomEvent('tutorial:completed'));
      return;
    }

    this._render();
  },

  /**
   * Called by game code to signal that a required action was completed.
   * Also dispatched via CustomEvent 'tutorial:action'.
   */
  actionCompleted(actionType) {
    if (!this.active) return;
    const step = this.steps[this.currentStep];
    if (!step) return;
    if (step.requiresAction && step.requiresAction === actionType) {
      if (!this._firedActions.has(actionType)) {
        this._firedActions.add(actionType);
        this._showNextBtn();
      }
    }
  },

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Render the current tutorial bubble. */
  _render() {
    const step = this.steps[this.currentStep];
    if (!step) return;

    const overlay = document.getElementById('tutorial-overlay');
    const bubble  = document.getElementById('tutorial-bubble');
    const textEl  = document.getElementById('tutorial-text');
    const subEl   = document.getElementById('tutorial-subtext');
    const nextBtn = document.getElementById('tutorial-next-btn');
    const counter = document.getElementById('tutorial-step-counter');

    if (!overlay || !bubble) return;

    // Populate text
    textEl.innerHTML = step.text || '';
    subEl.innerHTML  = step.subtext || '';
    subEl.style.display = step.subtext ? 'block' : 'none';

    // Step counter
    counter.textContent = `Step ${this.currentStep + 1} of ${this.steps.length}`;

    // Show / hide Next button
    if (!step.requiresAction) {
      nextBtn.classList.remove('hidden');
    } else {
      nextBtn.classList.add('hidden');
      this._actionPending = true;
    }

    // Reset fired actions for this step
    this._firedActions = new Set();

    // Show overlay
    overlay.classList.remove('hidden');
    overlay.classList.add('active');

    // Position bubble
    const targetEl = step.target ? document.querySelector(step.target) : null;
    this._positionBubble(targetEl, step.position || 'center');

    // Highlight target
    if (targetEl) {
      this._highlight(step.target);
    }
  },

  // -------------------------------------------------------------------------
  // Overlay creation
  // -------------------------------------------------------------------------

  /** Create the #tutorial-overlay DOM if it doesn't already exist. */
  _createOverlay() {
    if (document.getElementById('tutorial-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.classList.add('hidden');
    overlay.innerHTML = `
      <div id="tutorial-bubble">
        <div id="tutorial-text"></div>
        <div id="tutorial-subtext"></div>
        <div id="tutorial-arrow"></div>
        <div id="tutorial-controls">
          <button id="tutorial-next-btn" class="hidden">Next &#8594;</button>
          <button id="tutorial-skip-btn">Skip Tutorial</button>
        </div>
      </div>
      <div id="tutorial-step-counter"></div>
    `;

    document.body.appendChild(overlay);
  },

  // -------------------------------------------------------------------------
  // Positioning
  // -------------------------------------------------------------------------

  /**
   * Position the bubble relative to targetEl using the given position hint.
   * Falls back to center if targetEl is null or off-screen.
   */
  _positionBubble(targetEl, position) {
    const bubble  = document.getElementById('tutorial-bubble');
    const arrowEl = document.getElementById('tutorial-arrow');
    if (!bubble) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;       // gap between bubble edge and target
    const arrowSize = 10;    // px

    // Reset arrow classes
    arrowEl.className = 'tutorial-arrow';

    // If no target or centered, place in the middle of the screen
    if (!targetEl || position === 'center') {
      bubble.style.left = `${(vw - bubble.offsetWidth) / 2}px`;
      bubble.style.top  = `${(vh - bubble.offsetHeight) / 2}px`;
      arrowEl.style.display = 'none';
      return;
    }

    arrowEl.style.display = '';
    const rect = targetEl.getBoundingClientRect();
    const bw   = bubble.offsetWidth  || 280;
    const bh   = bubble.offsetHeight || 120;

    let top, left;
    let arrowStyle = '';

    switch (position) {
      case 'above':
        top  = rect.top - bh - margin - arrowSize;
        left = rect.left + rect.width / 2 - bw / 2;
        arrowStyle = `bottom:-${arrowSize}px; left:${bw/2 - arrowSize}px; border-left:${arrowSize}px solid transparent; border-right:${arrowSize}px solid transparent; border-top:${arrowSize}px solid #00FFFF;`;
        break;

      case 'below':
        top  = rect.bottom + margin + arrowSize;
        left = rect.left + rect.width / 2 - bw / 2;
        arrowStyle = `top:-${arrowSize}px; left:${bw/2 - arrowSize}px; border-left:${arrowSize}px solid transparent; border-right:${arrowSize}px solid transparent; border-bottom:${arrowSize}px solid #00FFFF;`;
        break;

      case 'left':
        top  = rect.top + rect.height / 2 - bh / 2;
        left = rect.left - bw - margin - arrowSize;
        arrowStyle = `right:-${arrowSize}px; top:${bh/2 - arrowSize}px; border-top:${arrowSize}px solid transparent; border-bottom:${arrowSize}px solid transparent; border-left:${arrowSize}px solid #00FFFF;`;
        break;

      case 'right':
        top  = rect.top + rect.height / 2 - bh / 2;
        left = rect.right + margin + arrowSize;
        arrowStyle = `left:-${arrowSize}px; top:${bh/2 - arrowSize}px; border-top:${arrowSize}px solid transparent; border-bottom:${arrowSize}px solid transparent; border-right:${arrowSize}px solid #00FFFF;`;
        break;

      default: // center
        top  = (vh - bh) / 2;
        left = (vw - bw) / 2;
        arrowEl.style.display = 'none';
    }

    // Clamp within viewport
    left = Math.max(margin, Math.min(left, vw - bw - margin));
    top  = Math.max(margin, Math.min(top,  vh - bh - margin));

    bubble.style.left = `${left}px`;
    bubble.style.top  = `${top}px`;

    if (arrowStyle) {
      arrowEl.setAttribute('style', `position:absolute; width:0; height:0; ${arrowStyle}`);
    }

    // Place highlight ring on target element
    this._placeHighlightRing(targetEl);
  },

  // -------------------------------------------------------------------------
  // Highlights
  // -------------------------------------------------------------------------

  /** Add .tutorial-highlight class to elements matching selector. */
  _highlight(selector) {
    if (!selector) return;
    document.querySelectorAll(selector).forEach(el => {
      el.classList.add('tutorial-highlight');
    });
  },

  /** Remove all highlights. */
  _clearHighlights() {
    document.querySelectorAll('.tutorial-highlight').forEach(el => {
      el.classList.remove('tutorial-highlight');
    });
    // Also remove the floating ring
    const ring = document.getElementById('tutorial-highlight-ring');
    if (ring) ring.remove();
  },

  /**
   * Place a glowing border ring overlay on top of the target element.
   * This is a positioned div separate from the element so we never alter
   * its layout.
   */
  _placeHighlightRing(targetEl) {
    let ring = document.getElementById('tutorial-highlight-ring');
    if (!ring) {
      ring = document.createElement('div');
      ring.id = 'tutorial-highlight-ring';
      ring.className = 'tutorial-highlight-target';
      document.body.appendChild(ring);
    }

    const rect = targetEl.getBoundingClientRect();
    const pad  = 4;
    ring.style.left   = `${rect.left   - pad}px`;
    ring.style.top    = `${rect.top    - pad}px`;
    ring.style.width  = `${rect.width  + pad * 2}px`;
    ring.style.height = `${rect.height + pad * 2}px`;
    ring.style.display = 'block';
  },

  // -------------------------------------------------------------------------
  // Next button visibility
  // -------------------------------------------------------------------------

  /** Show the "Next →" button (called when a required action fires). */
  _showNextBtn() {
    const btn = document.getElementById('tutorial-next-btn');
    if (btn) {
      btn.classList.remove('hidden');
      // Brief pulse animation to draw attention
      btn.style.animation = 'none';
      // Force reflow
      void btn.offsetWidth;
      btn.style.animation = 'tutorial-pulse 0.6s ease 2';
    }
    this._actionPending = false;
  },

  // -------------------------------------------------------------------------
  // Event binding
  // -------------------------------------------------------------------------

  _bindEvents() {
    // "Next" button
    document.addEventListener('click', this._onNextClick.bind(this));
    document.addEventListener('click', this._onSkipClick.bind(this));

    // CustomEvent from game code
    window.addEventListener('tutorial:action', this._onTutorialAction.bind(this));
  },

  _onNextClick(e) {
    if (e.target && e.target.id === 'tutorial-next-btn') {
      this.next();
    }
  },

  _onSkipClick(e) {
    if (e.target && e.target.id === 'tutorial-skip-btn') {
      this.skip();
    }
  },

  _onTutorialAction(e) {
    if (e.detail && e.detail.type) {
      this.actionCompleted(e.detail.type);
    }
  },

  // -------------------------------------------------------------------------
  // DOM Polling
  // -------------------------------------------------------------------------

  /**
   * Poll the DOM every 500 ms to detect state changes that indicate the player
   * completed a required action, for cases where game code doesn't dispatch
   * the CustomEvent directly.
   */
  _startPolling() {
    if (this._pollInterval) clearInterval(this._pollInterval);

    this._pollInterval = setInterval(() => {
      if (!this.active) {
        clearInterval(this._pollInterval);
        return;
      }

      const step = this.steps[this.currentStep];
      if (!step || !step.requiresAction) return;
      if (!this._actionPending) return;

      const needed = step.requiresAction;

      switch (needed) {
        case 'hex_selected': {
          // #tile-info has visible tile data (not just the placeholder prompt)
          const tileInfo = document.getElementById('tile-info');
          if (tileInfo) {
            const text = tileInfo.textContent.trim();
            const isPlaceholder = tileInfo.querySelector('.tile-placeholder') !== null;
            if (text.length > 0 && !isPlaceholder) {
              this._firePollAction('hex_selected');
            }
          }
          break;
        }

        case 'build_menu_opened': {
          // #build-panel exists and is not hidden
          const bp = document.getElementById('build-panel');
          if (bp && !bp.classList.contains('hidden') && bp.style.display !== 'none') {
            this._firePollAction('build_menu_opened');
          }
          break;
        }

        case 'building_placed': {
          // A toast / notification about a building appears, or a building count
          // increments. We look for a success toast or a .building-placed-indicator.
          const toast = document.querySelector('.toast-building-placed, .build-success, [data-building-placed]');
          if (toast) {
            this._firePollAction('building_placed');
          }
          break;
        }

        case 'end_turn': {
          // Turn number changed — look for a change in #turn-counter
          const turnEl = document.getElementById('turn-counter');
          if (turnEl) {
            const current = parseInt(turnEl.textContent) || 0;
            if (!this._lastTurnNumber) {
              this._lastTurnNumber = current;
            } else if (current > this._lastTurnNumber) {
              this._lastTurnNumber = current;
              this._firePollAction('end_turn');
            }
          }
          break;
        }

        case 'idea_lab_opened': {
          // Idea Lab overlay is visible
          const lab = document.getElementById('idea-lab-overlay') ||
                      document.getElementById('idea-lab-panel')   ||
                      document.querySelector('.idea-lab');
          if (lab && !lab.classList.contains('hidden') && lab.style.display !== 'none') {
            this._firePollAction('idea_lab_opened');
          }
          break;
        }

        case 'concept_selected_1': {
          // First mix slot has a concept loaded
          const slot = document.getElementById('mix-slot-0') ||
                       document.querySelector('.mix-slot:first-child');
          if (slot && slot.dataset.conceptId) {
            this._firePollAction('concept_selected_1');
          }
          break;
        }

        case 'concept_selected_2': {
          // Second mix slot has a concept loaded
          const slot = document.getElementById('mix-slot-1') ||
                       document.querySelector('.mix-slot:nth-child(2)');
          if (slot && slot.dataset.conceptId) {
            this._firePollAction('concept_selected_2');
          }
          break;
        }

        case 'synthesis_attempted': {
          // Synthesize button was disabled (post-click) or a result panel appeared
          const result = document.getElementById('synthesis-result') ||
                         document.querySelector('.synthesis-result, [data-synthesis-done]');
          if (result && !result.classList.contains('hidden')) {
            this._firePollAction('synthesis_attempted');
          }
          break;
        }
      }
    }, 500);
  },

  /** Fire a polled action (deduplicated per step). */
  _firePollAction(type) {
    if (this._firedActions.has(type)) return;
    this._firedActions.add(type);
    this.actionCompleted(type);
    // Also dispatch the event so any other listeners know
    window.dispatchEvent(new CustomEvent('tutorial:action', { detail: { type } }));
  },

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /** Remove the tutorial overlay and clean up all side-effects. */
  _teardown() {
    this.active = false;
    this._actionPending = false;

    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }

    this._clearHighlights();

    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.classList.remove('active');
    }

    // Remove the dynamic ring element if present
    const ring = document.getElementById('tutorial-highlight-ring');
    if (ring) ring.remove();

    window.removeEventListener('tutorial:action', this._onTutorialAction);
  },
};

// ---------------------------------------------------------------------------
// Expose globally
// ---------------------------------------------------------------------------
window.Tutorial = Tutorial;

// ---------------------------------------------------------------------------
// Convenience: auto-inject styles so tutorial.js is truly self-contained.
// (Styles are also documented at the bottom of this file for reference.)
// ---------------------------------------------------------------------------
(function injectTutorialStyles() {
  if (document.getElementById('tutorial-styles')) return;
  const style = document.createElement('style');
  style.id = 'tutorial-styles';
  style.textContent = `
    /* =========================================================
       Tutorial Overlay CSS — auto-injected by tutorial.js
       ========================================================= */

    #tutorial-overlay {
      position: fixed;
      inset: 0;
      z-index: 500;
      pointer-events: none;
    }
    #tutorial-bubble {
      pointer-events: auto;
    }
    .tutorial-highlight-target {
      pointer-events: none;
    }

    #tutorial-bubble {
      position: absolute;
      background: linear-gradient(135deg, #0d0d1a 0%, #1a1a2e 100%);
      border: 1px solid #00FFFF;
      border-radius: 8px;
      padding: 16px 20px;
      max-width: 320px;
      min-width: 220px;
      box-shadow: 0 0 20px rgba(0,255,255,0.3), inset 0 0 40px rgba(0,255,255,0.03);
      font-family: 'Courier New', monospace;
      color: #e0e0ff;
      z-index: 501;
    }

    #tutorial-text {
      font-size: 13px;
      line-height: 1.6;
      margin-bottom: 8px;
    }

    #tutorial-subtext {
      font-size: 11px;
      color: rgba(180,180,255,0.7);
      font-style: italic;
      margin-bottom: 12px;
    }

    .tutorial-arrow {
      position: absolute;
      width: 0;
      height: 0;
    }

    #tutorial-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    #tutorial-next-btn {
      background: #00FFFF;
      color: #0a0a1a;
      border: none;
      padding: 6px 14px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      cursor: pointer;
      border-radius: 4px;
      font-weight: bold;
      transition: background 0.15s;
    }
    #tutorial-next-btn:hover { background: #00dddd; }

    #tutorial-skip-btn {
      background: none;
      border: none;
      color: rgba(180,180,255,0.5);
      font-size: 11px;
      cursor: pointer;
      text-decoration: underline;
      font-family: 'Courier New', monospace;
    }
    #tutorial-skip-btn:hover {
      color: rgba(180,180,255,0.9);
    }

    #tutorial-step-counter {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255,255,255,0.4);
      font-size: 11px;
      font-family: 'Courier New', monospace;
      pointer-events: none;
      white-space: nowrap;
    }

    /* Glowing border ring placed over the target element */
    .tutorial-highlight-target {
      position: fixed;
      border: 2px solid #00FFFF;
      box-shadow: 0 0 15px rgba(0,255,255,0.6);
      border-radius: 4px;
      pointer-events: none;
      z-index: 500;
      transition: all 0.3s ease;
    }

    /* Class added directly to matching elements (optional, for CSS overrides) */
    .tutorial-highlight {
      outline: 2px solid rgba(0,255,255,0.5);
      outline-offset: 3px;
    }

    /* Hidden utility */
    .hidden { display: none !important; }

    /* Pulse keyframe for "Next" button when action completes */
    @keyframes tutorial-pulse {
      0%   { transform: scale(1);    box-shadow: 0 0 0   rgba(0,255,255,0); }
      50%  { transform: scale(1.07); box-shadow: 0 0 12px rgba(0,255,255,0.8); }
      100% { transform: scale(1);    box-shadow: 0 0 0   rgba(0,255,255,0); }
    }
  `;
  document.head.appendChild(style);
}());

/* =============================================================================
   HTML TO ADD TO index.html (just before closing </body>):
   =============================================================================

   <!-- TUTORIAL OVERLAY (created dynamically by tutorial.js but needs this base) -->
   <div id="tutorial-overlay" class="hidden">
     <div id="tutorial-bubble">
       <div id="tutorial-text"></div>
       <div id="tutorial-subtext"></div>
       <div id="tutorial-arrow"></div>
       <div id="tutorial-controls">
         <button id="tutorial-next-btn" class="hidden">Next &#8594;</button>
         <button id="tutorial-skip-btn">Skip Tutorial</button>
       </div>
     </div>
     <div id="tutorial-step-counter"></div>
   </div>
   <script src="js/tutorial.js"></script>

   =============================================================================
   INTEGRATION IN OTHER FILES:
   =============================================================================

   // In ui.js / engine.js — dispatch events when player performs actions:
   window.dispatchEvent(new CustomEvent('tutorial:action', { detail: { type: 'hex_selected' } }));
   window.dispatchEvent(new CustomEvent('tutorial:action', { detail: { type: 'build_menu_opened' } }));
   window.dispatchEvent(new CustomEvent('tutorial:action', { detail: { type: 'building_placed' } }));
   window.dispatchEvent(new CustomEvent('tutorial:action', { detail: { type: 'end_turn' } }));
   window.dispatchEvent(new CustomEvent('tutorial:action', { detail: { type: 'idea_lab_opened' } }));
   window.dispatchEvent(new CustomEvent('tutorial:action', { detail: { type: 'concept_selected_1' } }));
   window.dispatchEvent(new CustomEvent('tutorial:action', { detail: { type: 'concept_selected_2' } }));
   window.dispatchEvent(new CustomEvent('tutorial:action', { detail: { type: 'synthesis_attempted' } }));

   // Start the tutorial on new game:
   Tutorial.start('retronaughts');  // pass the chosen factionId

   // Listen for tutorial completion:
   window.addEventListener('tutorial:completed', () => { ... });
   window.addEventListener('tutorial:skipped',   () => { ... });

   =============================================================================
*/
