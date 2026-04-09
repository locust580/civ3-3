// =============================================================================
// Silicon Civilizations — UI Module
// Handles all DOM interactions, screen management, and wires together the
// game engine, renderer, and idea space.
//
// Load order: data.js → mapgen.js → ideaspace.js → engine.js → renderer.js
//             → ui.js → main.js
//
// Exposes: window.UI
// =============================================================================

const UI = {

  // ── STATE ───────────────────────────────────────────────────────────────────

  /** @type {string} current active screen id (without 'screen-' prefix) */
  currentScreen: 'intro',

  /** @type {string|null} faction id selected on the faction screen */
  selectedFactionId: null,

  /** @type {boolean} whether the Idea Lab overlay is visible */
  ideaLabOpen: false,

  /** @type {{q:number,r:number}|null} currently selected hex */
  selectedHex: null,

  // ── SCREEN MANAGEMENT ───────────────────────────────────────────────────────

  /**
   * Hide all .screen elements and show the one with id="screen-<screenId>".
   * @param {string} screenId
   */
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`screen-${screenId}`);
    if (target) {
      target.classList.add('active');
    } else {
      console.warn(`UI.showScreen: no element with id "screen-${screenId}"`);
    }
    this.currentScreen = screenId;
  },

  // ── INTRO SCREEN ────────────────────────────────────────────────────────────

  /**
   * Wire up intro screen buttons and start the background circuit animation.
   */
  initIntroScreen() {
    // Trigger the animated-circuit CSS class on the background element so the
    // CSS transitions/keyframes can run.
    const circuitBg = document.getElementById('circuit-bg');
    if (circuitBg) {
      circuitBg.classList.add('animated');
    }

    // Stagger-animate individual circuit lines if any have the .circuit-line class.
    document.querySelectorAll('.circuit-line, .circuit-node').forEach((el, i) => {
      el.style.animationDelay = `${i * 0.15}s`;
    });

    // #btn-new-game is wired in main.js (it also calls initFactionScreen).
    // #btn-how-to-play is also wired in main.js.
    // We keep this method here for any intro-specific extras.
  },

  // ── FACTION SELECTION ───────────────────────────────────────────────────────

  /**
   * Populate #faction-grid with one card per faction from FACTIONS.
   */
  initFactionScreen() {
    const grid = document.getElementById('faction-grid');
    if (!grid) return;

    grid.innerHTML = '';

    for (const [id, faction] of Object.entries(FACTIONS)) {
      const card = document.createElement('div');
      card.className = 'faction-card';
      card.dataset.factionId = id;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `Select faction: ${faction.name}`);

      // Inline color for border; CSS handles the glow on hover/active
      card.style.borderColor = faction.color;
      card.style.setProperty('--faction-color', faction.color);

      // Build mini branch proficiency bars (scale 0–5 for a compact display)
      const branchProf = (typeof FACTION_BRANCH_PROFICIENCY !== 'undefined')
        ? FACTION_BRANCH_PROFICIENCY[id] || {}
        : {};

      const miniBarsHtml = Object.entries(RESEARCH_BRANCHES).map(([branchId, branch]) => {
        const val = branchProf[branchId] || 0;
        const pct = (val / 10) * 100;
        return `<div class="mini-bar-row" title="${branch.label}: ${val}/10">
          <div class="mini-bar-track">
            <div class="mini-bar-fill" style="width:${pct}%;background:${branch.color}"></div>
          </div>
        </div>`;
      }).join('');

      card.innerHTML = `
        <div class="faction-card-header" style="color:${faction.color}">
          <span class="faction-card-name">${faction.name}</span>
        </div>
        <div class="faction-card-subtitle">${faction.subtitle}</div>
        <div class="faction-mini-bars">${miniBarsHtml}</div>
      `;

      // Click and keyboard activation
      const activate = () => this.selectFaction(id);
      card.addEventListener('click', activate);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });

      grid.appendChild(card);
    }
  },

  /**
   * Mark a faction as selected, populate the detail panel, and enable
   * the "Lead This Civilization" button.
   * @param {string} factionId
   */
  selectFaction(factionId) {
    const faction = (typeof FACTIONS !== 'undefined') ? FACTIONS[factionId] : null;
    if (!faction) {
      console.warn(`UI.selectFaction: unknown faction "${factionId}"`);
      return;
    }

    this.selectedFactionId = factionId;

    // Update active state on all cards
    document.querySelectorAll('.faction-card').forEach(card => {
      card.classList.toggle('active', card.dataset.factionId === factionId);
    });

    // Show the detail content, hide the placeholder
    const placeholder = document.querySelector('.faction-detail-placeholder');
    const content     = document.getElementById('faction-detail-content');
    if (placeholder) placeholder.style.display = 'none';
    if (content)     content.classList.remove('hidden');

    // Set CSS custom property on the detail panel for color theming
    const detail = document.getElementById('faction-detail');
    if (detail) {
      detail.style.setProperty('--faction-color', faction.color);
      detail.style.setProperty('--faction-bg', faction.bgColor || '#111');
    }

    // Color badge
    const badge = document.getElementById('fd-color-badge');
    if (badge) badge.style.background = faction.color;

    // Name / subtitle / lore
    this._setText('fd-name',     faction.name);
    this._setText('fd-subtitle', faction.subtitle);
    this._setText('fd-lore',     faction.lore);

    // Stats section — derive home branch from highest starting proficiency
    const branchProf = (typeof FACTION_BRANCH_PROFICIENCY !== 'undefined')
      ? FACTION_BRANCH_PROFICIENCY[factionId] || {}
      : {};

    const homeBranch = Object.entries(branchProf)
      .sort((a, b) => b[1] - a[1])[0];
    const homeBranchLabel = (homeBranch && RESEARCH_BRANCHES[homeBranch[0]])
      ? RESEARCH_BRANCHES[homeBranch[0]].label
      : '—';
    this._setText('fd-home-branch', homeBranchLabel);

    // Derive a simple playstyle descriptor from the faction's top branches
    const topTwo = Object.entries(branchProf)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([b]) => RESEARCH_BRANCHES[b] ? RESEARCH_BRANCHES[b].label : b)
      .join(' / ');
    this._setText('fd-playstyle', topTwo || '—');

    // Starting bonus
    const bonusStr = Object.entries(faction.startBonus || {})
      .map(([res, val]) => `+${val} ${res}`)
      .join(', ') || 'None';
    this._setText('fd-bonus', bonusStr);

    // Special ability — split on the em dash that separates name from description
    const specialParts = (faction.specialAbility || '').split(' — ');
    this._setText('fd-special-name', specialParts[0] || faction.specialAbility || '—');
    this._setText('fd-special-desc', specialParts.slice(1).join(' — ') || '');

    // Full branch proficiency bars
    this.updateBranchBars('fd-branch-bars', branchProf);

    // Starter concepts list
    this._renderStarterConcepts(factionId, faction);

    // Enable start button
    const btn = document.getElementById('btn-start-game');
    if (btn) btn.disabled = false;
  },

  /**
   * Render starter concept pills below the branch bars.
   * @private
   */
  _renderStarterConcepts(factionId, faction) {
    // Remove any existing starter concept section, then rebuild
    const existingSection = document.getElementById('fd-starter-concepts');
    if (existingSection) existingSection.remove();

    const content = document.getElementById('faction-detail-content');
    if (!content) return;

    const section = document.createElement('div');
    section.id = 'fd-starter-concepts';
    section.className = 'starter-concepts-section';
    section.innerHTML = '<div class="starter-concepts-title">Starter Concepts</div>';

    const list = document.createElement('div');
    list.className = 'starter-concepts-list';

    for (const cId of (faction.starterConcepts || [])) {
      const concept = (typeof CONCEPTS !== 'undefined') ? CONCEPTS[cId] : null;
      if (!concept) continue;
      const clusterMeta = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[concept.cluster] : null;
      const color = clusterMeta ? clusterMeta.color : '#888';

      const pill = document.createElement('span');
      pill.className = 'concept-pill starter-pill';
      pill.style.borderColor = color;
      pill.style.color = color;
      pill.textContent = concept.name;
      pill.title = concept.description || '';
      list.appendChild(pill);
    }

    section.appendChild(list);
    content.appendChild(section);
  },

  // ── GAME SCREEN ─────────────────────────────────────────────────────────────

  /**
   * Wire up in-game buttons and keyboard shortcuts.
   * Called once after transitioning to the game screen.
   */
  initGameScreen() {
    // End turn button
    const btnEndTurn = document.getElementById('btn-end-turn');
    if (btnEndTurn) {
      btnEndTurn.addEventListener('click', () => {
        if (typeof UI.handleEndTurn === 'function') UI.handleEndTurn();
      });
    }

    // Idea Lab button (in the top bar; the overlay button is wired in main.js)
    const btnOpenIdea = document.getElementById('btn-open-idea-lab');
    if (btnOpenIdea) {
      btnOpenIdea.addEventListener('click', () => this.openIdeaLab());
    }

    // Map tooltip mouse-tracking
    const mapContainer = document.getElementById('map-container');
    if (mapContainer) {
      mapContainer.addEventListener('mousemove', (e) => {
        const tooltip = document.getElementById('map-tooltip');
        if (tooltip && !tooltip.classList.contains('hidden')) {
          tooltip.style.left = (e.offsetX + 14) + 'px';
          tooltip.style.top  = (e.offsetY + 10) + 'px';
        }
      });
      mapContainer.addEventListener('mouseleave', () => {
        const tooltip = document.getElementById('map-tooltip');
        if (tooltip) tooltip.classList.add('hidden');
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Only active while the game screen is visible
      if (this.currentScreen !== 'game') return;

      // Space → end turn (handled in main.js too, but scoped here for game screen)
      if (e.key === ' ' && !this.ideaLabOpen) {
        // Guard: only if game state exists and it's the player's turn
        if (typeof GameEngine !== 'undefined' && GameEngine.state?.phase === 'player') {
          e.preventDefault();
          if (typeof UI.handleEndTurn === 'function') UI.handleEndTurn();
        }
        return;
      }

      // i / I → toggle idea lab
      if (e.key === 'i' || e.key === 'I') {
        if (typeof GameEngine !== 'undefined' && GameEngine.state) {
          this.ideaLabOpen ? this.closeIdeaLab() : this.openIdeaLab();
        }
        return;
      }

      // Escape → close overlays / modals
      if (e.key === 'Escape') {
        if (this.ideaLabOpen) { this.closeIdeaLab(); return; }
        this.hideAllModals();
        return;
      }

      // Arrow keys → pan map
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        if (typeof Renderer !== 'undefined' && typeof Renderer.pan === 'function') {
          e.preventDefault();
          const PAN = 40;
          const dirs = {
            ArrowLeft:  { dx: -PAN, dy: 0 },
            ArrowRight: { dx:  PAN, dy: 0 },
            ArrowUp:    { dx: 0,   dy: -PAN },
            ArrowDown:  { dx: 0,   dy:  PAN },
          };
          const d = dirs[e.key];
          Renderer.pan(d.dx, d.dy);
        }
      }
    });
  },

  // ── FULL UI REFRESH ─────────────────────────────────────────────────────────

  /**
   * Refresh every in-game UI panel.
   */
  updateAllUI() {
    this.updateTopBar();
    this.updateLeftPanel();
    this.updateRightPanel();
    this.updateCivList();
    this.updateEventLog();
    if (this.ideaLabOpen) this.updateIdeaLab();
  },

  // ── TOP BAR ─────────────────────────────────────────────────────────────────

  /**
   * Update the turn counter, faction badge, and resource bar.
   */
  updateTopBar() {
    if (typeof GameEngine === 'undefined' || !GameEngine.state) return;
    const state = GameEngine.state;
    const playerCiv = GameEngine.getPlayerCiv ? GameEngine.getPlayerCiv() : null;

    // Turn number
    this._setText('turn-number', state.turn ?? '—');

    if (!playerCiv) return;
    const faction = (typeof FACTIONS !== 'undefined') ? FACTIONS[playerCiv.factionId] : null;

    // Faction badge
    if (faction) {
      this._setText('topbar-faction-name', faction.name);
      const iconEl = document.getElementById('topbar-faction-icon');
      if (iconEl) iconEl.style.color = faction.color;
    }

    // Resource bar — each resource value + (income/turn shown as title tooltip)
    const RESOURCE_DESCRIPTIONS = {
      energy:    'Powers all buildings and units. Deficit destroys units.',
      silicon:   'Core construction material for all buildings and most units.',
      research:  'Spent in the Idea Lab to synthesize or directly research concepts.',
      data:      'Fuels advanced computations and unlocks late-game buildings.',
      compute:   'Your civilization\'s processing power — the primary victory metric.',
      rareEarth: 'Required for advanced-tier buildings and elite units.',
      quantum:   'Unlocks quantum-era technologies. Rare and precious.',
      copper:    'Secondary construction material used with silicon in many buildings.',
      military:  'Represents your army production capacity.',
    };
    const res  = playerCiv.resources      || {};
    const inc  = playerCiv.resourceIncome || {};

    const resMap = {
      'res-energy':    { key: 'energy',    icon: '⚡' },
      'res-silicon':   { key: 'silicon',   icon: '💎' },
      'res-research':  { key: 'research',  icon: '🔬' },
      'res-data':      { key: 'data',      icon: '💾' },
      'res-compute':   { key: 'compute',   icon: '⚙️' },
      'res-rareearth': { key: 'rareEarth', icon: '🌍' },
      'res-quantum':   { key: 'quantum',   icon: '⚛️' },
    };

    for (const [elemId, info] of Object.entries(resMap)) {
      const el = document.getElementById(elemId);
      if (!el) continue;
      const val = Math.floor(res[info.key] || 0);
      const income = inc[info.key] != null ? inc[info.key] : null;
      el.textContent = val;
      // Show income as a tooltip on the parent .resource-item
      const parent = el.closest('.resource-item');
      if (parent && income !== null) {
        const sign = income >= 0 ? '+' : '';
        const desc = RESOURCE_DESCRIPTIONS[info.key] || info.key;
        parent.title = `${info.key}: ${val}  (${sign}${income}/turn)\n${desc}`;
        // Also add a small income badge if the container allows it
        let badge = parent.querySelector('.res-income');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'res-income';
          parent.appendChild(badge);
        }
        badge.textContent = `${sign}${income}`;
        badge.style.color = income >= 0 ? '#6f6' : '#f66';
      }
    }
  },

  // ── LEFT PANEL ──────────────────────────────────────────────────────────────

  /**
   * Update the empire stats block (tiles, units, discoveries, score).
   */
  updateLeftPanel() {
    if (typeof GameEngine === 'undefined' || !GameEngine.state) return;
    const playerCiv = GameEngine.getPlayerCiv ? GameEngine.getPlayerCiv() : null;
    if (!playerCiv) return;

    // Count owned tiles
    let tileCount = 0;
    let unitCount = 0;
    if (GameEngine.state.map) {
      for (const tile of GameEngine.state.map.values()) {
        if (tile.owner === playerCiv.id) {
          tileCount++;
          unitCount += (tile.units || []).filter(u => u.civId === playerCiv.id).length;
        }
      }
    }

    const discoveries = (typeof IdeaSpace !== 'undefined')
      ? IdeaSpace.discoveredConcepts.size
      : (playerCiv.discoveredConcepts ? playerCiv.discoveredConcepts.length : 0);

    const score = Math.floor(playerCiv.resources?.compute || 0);

    this._setText('stat-tiles',       tileCount);
    this._setText('stat-units',       unitCount);
    this._setText('stat-discoveries', discoveries);
    this._setText('stat-score',       score);
  },

  // ── CIV LIST ────────────────────────────────────────────────────────────────

  /**
   * Render all rival civilizations in #civ-list.
   */
  updateCivList() {
    const list = document.getElementById('civ-list');
    if (!list) return;
    if (typeof GameEngine === 'undefined' || !GameEngine.state) {
      list.innerHTML = '<p class="tile-placeholder">No game in progress.</p>';
      return;
    }

    const playerCiv = GameEngine.getPlayerCiv ? GameEngine.getPlayerCiv() : null;
    const civsObj = GameEngine.state.civs || {};
    const civs = Object.values(civsObj);

    list.innerHTML = '';

    for (const civ of civs) {
      if (!playerCiv || civ.id === playerCiv.id) continue; // skip player

      const faction = (typeof FACTIONS !== 'undefined') ? FACTIONS[civ.factionId] : null;
      const factionName = faction ? faction.name : civ.id;
      const factionColor = faction ? faction.color : '#888';
      const isDead = civ.alive === false;

      // Diplomacy status
      const diploStatus = (playerCiv.diplomacy && playerCiv.diplomacy[civ.id])
        ? playerCiv.diplomacy[civ.id]
        : 'neutral';

      const diploLabel = { war: 'At War', peace: 'At Peace', neutral: 'Neutral' }[diploStatus] || diploStatus;
      const diploClass = { war: 'diplo-war', peace: 'diplo-peace', neutral: 'diplo-neutral' }[diploStatus] || '';

      // Compute comparison
      const theirCompute  = Math.floor(civ.resources?.compute  || 0);
      const playerCompute = Math.floor(playerCiv.resources?.compute || 0);
      const compareSign   = theirCompute > playerCompute ? '▲' : theirCompute < playerCompute ? '▼' : '=';
      const compareColor  = theirCompute > playerCompute ? '#f66' : theirCompute < playerCompute ? '#6f6' : '#aaa';

      const item = document.createElement('div');
      item.className = `civ-list-item${isDead ? ' civ-dead' : ''}`;
      item.innerHTML = `
        <div class="civ-list-header">
          <span class="civ-color-swatch" style="background:${factionColor}"></span>
          <span class="civ-name">${factionName}</span>
          <span class="civ-diplo ${diploClass}">${diploLabel}</span>
        </div>
        <div class="civ-list-stats">
          <span class="civ-compute" style="color:${compareColor}" title="Their compute vs yours">
            Compute: ${theirCompute} ${compareSign}
          </span>
        </div>
        ${isDead ? '<div class="civ-dead-label">Eliminated</div>' : `
        <div class="civ-list-actions">
          ${diploStatus !== 'war'
            ? `<button class="btn-sm btn-declare-war" data-civ="${civ.id}">Declare War</button>`
            : `<button class="btn-sm btn-propose-peace" data-civ="${civ.id}">Propose Peace</button>`
          }
        </div>`}
      `;

      // Wire diplomacy buttons
      const warBtn   = item.querySelector('.btn-declare-war');
      const peaceBtn = item.querySelector('.btn-propose-peace');

      if (warBtn) {
        warBtn.addEventListener('click', () => {
          if (typeof GameEngine !== 'undefined' && GameEngine.declareWar) {
            GameEngine.declareWar(playerCiv.id, civ.id);
            this.updateAllUI();
            this.showNotification(`You declared war on ${factionName}!`, 'danger');
          }
        });
      }
      if (peaceBtn) {
        peaceBtn.addEventListener('click', () => {
          if (typeof GameEngine !== 'undefined' && GameEngine.proposePeace) {
            GameEngine.proposePeace(playerCiv.id, civ.id);
            this.updateAllUI();
            this.showNotification(`Peace proposed to ${factionName}.`, 'info');
          }
        });
      }

      list.appendChild(item);
    }

    if (list.children.length === 0) {
      list.innerHTML = '<p class="tile-placeholder">No rival civilizations.</p>';
    }
  },

  // ── EVENT LOG ───────────────────────────────────────────────────────────────

  /**
   * Render the last 10 messages from GameEngine.state.messageLog, newest first.
   */
  updateEventLog() {
    const logEl = document.getElementById('event-log');
    if (!logEl) return;

    const messages = (typeof GameEngine !== 'undefined' && GameEngine.state?.messageLog)
      ? GameEngine.state.messageLog
      : [];

    const recent = messages.slice(-10).reverse();
    logEl.innerHTML = '';

    for (const msg of recent) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';

      // Colour by type
      const colMap = {
        info:    '#ccc',
        warning: '#ffcc44',
        danger:  '#ff5555',
        success: '#55ff88',
      };
      const type  = msg.type || 'info';
      const color = colMap[type] || colMap.info;

      entry.style.color = color;
      entry.textContent = `[T${msg.turn ?? '?'}] ${msg.text || msg}`;
      logEl.appendChild(entry);
    }

    if (logEl.children.length === 0) {
      logEl.innerHTML = '<p class="tile-placeholder">No events yet.</p>';
    }
  },

  // ── HEX SELECTION ───────────────────────────────────────────────────────────

  /**
   * Called by Renderer when the player clicks a hex.
   * @param {number} q
   * @param {number} r
   */
  onHexSelected(q, r) {
    this.selectedHex = { q, r };

    // Let the renderer know which hex is selected so it can draw the highlight
    if (typeof Renderer !== 'undefined') {
      Renderer.selectedHex = { q, r };
      Renderer.markDirty();
    }

    this.updateRightPanel();
  },

  /**
   * Called by Renderer on hex hover — update the map tooltip.
   * @param {number} q
   * @param {number} r
   */
  onHexHovered(q, r) {
    // existing: update Renderer.hoveredHex
    if (typeof Renderer !== 'undefined') {
      Renderer.hoveredHex = (q !== null && r !== null) ? { q, r } : null;
      Renderer.markDirty();
    }

    // NEW: show hover tooltip for building or unit on this tile
    const tooltip = document.getElementById('map-tooltip');
    if (!tooltip) return;

    if (q === null || r === null) {
      tooltip.classList.add('hidden');
      return;
    }

    const state = GameEngine?.state;
    if (!state) { tooltip.classList.add('hidden'); return; }

    const tile = state.map?.get ? state.map.get(`${q},${r}`) : null;
    if (!tile) { tooltip.classList.add('hidden'); return; }

    // Build tooltip content
    let html = '';

    // Tile name header
    const tileData = typeof TILE_TYPES !== 'undefined' ? TILE_TYPES[tile.type] : null;
    if (tileData) {
      html += `<div class="tt-tile-name">${tileData.name}</div>`;
    }

    // Building info
    if (tile.building) {
      const allBuildings = {};
      if (typeof BUILDINGS !== 'undefined') Object.assign(allBuildings, BUILDINGS);
      if (typeof BRANCH_RESEARCH_BUILDINGS !== 'undefined') Object.assign(allBuildings, BRANCH_RESEARCH_BUILDINGS);
      const bld = allBuildings[tile.building];
      if (bld) {
        html += `<div class="tt-section">`;
        html += `<div class="tt-name">${bld.name}</div>`;
        html += `<div class="tt-desc">${bld.description || ''}</div>`;
        if (bld.production && Object.keys(bld.production).length > 0) {
          const prod = Object.entries(bld.production)
            .map(([k, v]) => `+${v} ${k}`).join(', ');
          html += `<div class="tt-stat">Produces: <span class="tt-value">${prod}</span></div>`;
        }
        if (bld.defense) {
          html += `<div class="tt-stat">Defense: <span class="tt-value">+${bld.defense}</span></div>`;
        }
        if (bld.branchBoost) {
          const b = bld.branchBoost;
          html += `<div class="tt-stat">Branch: <span class="tt-value">+${b.amount} ${b.branch}</span></div>`;
        }
        if (bld.requires?.length) {
          html += `<div class="tt-requires">Requires: ${bld.requires.join(', ')}</div>`;
        }
        html += `</div>`;
      }
    }

    // Unit info
    if (tile.units?.length > 0) {
      for (const unit of tile.units.slice(0, 2)) {
        const unitDef = typeof UNIT_TYPES !== 'undefined' ? UNIT_TYPES[unit.type] : null;
        if (!unitDef) continue;
        const civs = state.civs;
        const ownerCiv = civs?.[unit.civId];
        const ownerName = ownerCiv ? (typeof FACTIONS !== 'undefined' ? FACTIONS[ownerCiv.factionId]?.name : ownerCiv.factionId) : 'Unknown';
        html += `<div class="tt-section">`;
        html += `<div class="tt-name">${unitDef.name}</div>`;
        html += `<div class="tt-desc">${unitDef.description || ''}</div>`;
        html += `<div class="tt-stat">Owner: <span class="tt-value">${ownerName}</span></div>`;
        html += `<div class="tt-stat">ATK <span class="tt-value">${unitDef.attack}</span>  DEF <span class="tt-value">${unitDef.defense}</span>  MOV <span class="tt-value">${unitDef.movement}</span></div>`;
        const hp = unit.hp ?? unitDef.health ?? 10;
        const maxHp = unit.maxHp ?? unitDef.health ?? 10;
        html += `<div class="tt-stat">HP: <span class="tt-value">${hp}/${maxHp}</span></div>`;
        html += `</div>`;
      }
      if (tile.units.length > 2) {
        html += `<div class="tt-more">+${tile.units.length - 2} more units</div>`;
      }
    }

    if (!html) {
      // Just terrain info
      if (tileData?.description) {
        html += `<div class="tt-desc">${tileData.description}</div>`;
        const res = tileData.baseResources;
        if (res && Object.keys(res).length > 0) {
          html += `<div class="tt-stat">Yields: <span class="tt-value">${Object.entries(res).map(([k,v])=>+v+' '+k).join(', ')}</span></div>`;
        }
      }
    }

    if (!html) { tooltip.classList.add('hidden'); return; }

    tooltip.innerHTML = html;
    tooltip.classList.remove('hidden');
  },

  // ── RIGHT PANEL ─────────────────────────────────────────────────────────────

  /**
   * Render tile information and available actions in the right panel.
   */
  updateRightPanel() {
    const detailEl     = document.getElementById('tile-detail');
    const buildPanel   = document.getElementById('build-panel');
    const tileInfoEl   = document.getElementById('tile-info');

    if (!this.selectedHex) {
      if (tileInfoEl) tileInfoEl.innerHTML = '<p class="tile-placeholder">Click a hex to inspect it.</p>';
      if (detailEl)   detailEl.classList.add('hidden');
      if (buildPanel) buildPanel.classList.add('hidden');
      return;
    }

    const { q, r } = this.selectedHex;
    const tile = (typeof GameEngine !== 'undefined' && GameEngine.state?.map)
      ? GameEngine.state.map.get(`${q},${r}`)
      : null;

    if (!tile) {
      if (tileInfoEl) tileInfoEl.innerHTML = '<p class="tile-placeholder">Tile not found.</p>';
      if (detailEl)   detailEl.classList.add('hidden');
      if (buildPanel) buildPanel.classList.add('hidden');
      return;
    }

    // ── Tile type & yields ─────────────────────────────────────────────────
    const tileType = (typeof TILE_TYPES !== 'undefined') ? TILE_TYPES[tile.type] : null;
    const typeName = tileType ? tileType.name : tile.type;

    // Yields: base + building production
    const baseYields = tileType ? { ...(tileType.baseResources || {}) } : {};
    if (tile.building) {
      const bldg = (typeof BUILDINGS !== 'undefined') ? BUILDINGS[tile.building] : null;
      if (bldg?.production) {
        for (const [k, v] of Object.entries(bldg.production)) {
          baseYields[k] = (baseYields[k] || 0) + v;
        }
      }
    }

    // Owner
    const playerCiv = typeof GameEngine !== 'undefined' && GameEngine.getPlayerCiv
      ? GameEngine.getPlayerCiv() : null;
    const ownerCiv = tile.owner
      ? Object.values(GameEngine.state?.civs || {}).find(c => c.id === tile.owner)
      : null;
    const ownerFaction = ownerCiv && (typeof FACTIONS !== 'undefined') ? FACTIONS[ownerCiv.factionId] : null;
    const ownerName = ownerFaction ? ownerFaction.name : (tile.owner || 'Unclaimed');
    const ownerColor = ownerFaction ? ownerFaction.color : 'rgba(160,155,140,0.5)';

    // Structure
    const allBuildings = {
      ...(typeof BUILDINGS !== 'undefined' ? BUILDINGS : {}),
      ...(typeof BRANCH_RESEARCH_BUILDINGS !== 'undefined' ? BRANCH_RESEARCH_BUILDINGS : {}),
    };
    const bldg = tile.building ? allBuildings[tile.building] : null;
    const bldgName = bldg ? bldg.name : tile.building;

    // Units on tile
    const units = tile.units || [];
    const unitDescs = units.map(u => {
      const uType = (typeof UNIT_TYPES !== 'undefined') ? UNIT_TYPES[u.type] : null;
      return uType ? uType.name : u.type;
    });

    // ── Build the tile-info section HTML ────────────────────────────────────
    if (tileInfoEl) {
      // Resource rows
      const resLabels = {
        energy: 'Energy', silicon: 'Silicon', research: 'Research',
        data: 'Data', compute: 'Compute', rareEarth: 'Rare Earth', quantum: 'Quantum',
      };
      const resColors = {
        energy: 'var(--color-energy)', silicon: 'var(--color-silicon)',
        research: 'var(--color-research)', data: 'var(--color-data)',
        compute: 'var(--color-compute)', rareEarth: 'var(--color-rareearth)',
        quantum: 'var(--color-quantum)',
      };

      const resRowsHtml = Object.entries(baseYields)
        .filter(([, v]) => v !== 0)
        .map(([k, v]) => {
          const label = resLabels[k] || k;
          const color = resColors[k] || '#c8c0a0';
          const sign  = v > 0 ? '+' : '';
          return `<div class="resource-row">
            <span class="resource-label">${label}</span>
            <span class="resource-value" style="color:${color}">${sign}${v}</span>
          </div>`;
        }).join('');

      const buildingHtml = bldgName
        ? `<div class="tile-building-info">${bldgName}</div>`
        : '';

      const unitHtml = unitDescs.length > 0
        ? `<div class="tile-building-info" style="color:#c8c8e0;margin-top:4px;">${unitDescs.join(', ')}</div>`
        : '';

      tileInfoEl.innerHTML = `
        <div class="tile-type-name">${typeName}</div>
        ${tileType?.description ? `<div class="tile-description">${tileType.description}</div>` : ''}
        ${resRowsHtml ? `<div class="tile-resources">${resRowsHtml}</div>` : ''}
        <span class="tile-owner-badge" style="color:${ownerColor};border-color:${ownerColor}">${ownerName}</span>
        ${buildingHtml}
        ${unitHtml}
      `;
    } else {
      // Fallback: update legacy element IDs if they exist
      this._setText('tile-type-name', typeName);
      this._setText('tile-yields', this._formatResources(baseYields) || '—');
      this._setText('tile-owner', ownerName);
      const structureText = bldgName || 'None';
      this._setText('tile-structure', structureText);
      this._setText('tile-unit', unitDescs.length > 0 ? unitDescs.join(', ') : 'None');
    }

    // ── Action buttons ──────────────────────────────────────────────────────
    const actionsEl = document.getElementById('unit-actions');
    if (actionsEl) actionsEl.innerHTML = '';

    if (playerCiv) {
      const isPlayerTile = tile.owner === playerCiv.id;

      // Build button: player owns tile, no existing building
      if (isPlayerTile && !tile.building) {
        this.showBuildMenu(q, r);
        if (buildPanel) buildPanel.classList.remove('hidden');
      } else {
        if (buildPanel) buildPanel.classList.add('hidden');
      }

      // Train unit button
      if (isPlayerTile && actionsEl) {
        const btnTrain = document.createElement('button');
        btnTrain.className = 'tile-action-btn train';
        btnTrain.textContent = 'Train Unit';
        btnTrain.addEventListener('click', () => this._showTrainMenu(q, r));
        actionsEl.appendChild(btnTrain);
      }

      // Claim tile button: unowned and adjacent to player territory
      if (!tile.owner && actionsEl) {
        const isAdjacent = typeof GameEngine !== 'undefined' && GameEngine.state?.map
          ? (typeof hexNeighbors !== 'undefined'
              ? hexNeighbors(q, r).some(nb => {
                  const nbTile = GameEngine.state.map.get(`${nb.q},${nb.r}`);
                  return nbTile && nbTile.owner === playerCiv.id;
                })
              : false)
          : false;

        if (isAdjacent) {
          const btnClaim = document.createElement('button');
          btnClaim.className = 'tile-action-btn claim';
          btnClaim.textContent = 'Claim Territory';
          btnClaim.addEventListener('click', () => {
            if (typeof GameEngine !== 'undefined' && GameEngine.expandTerritory) {
              GameEngine.expandTerritory(playerCiv.id, q, r);
              this.updateAllUI();
              if (typeof Renderer !== 'undefined') Renderer.markDirty();
            }
          });
          actionsEl.appendChild(btnClaim);
        }
      }

      // Attack button: enemy units on this tile
      if (actionsEl) {
        const enemyUnits = units.filter(u => u.civId && u.civId !== playerCiv.id);
        if (enemyUnits.length > 0) {
          const btnAttack = document.createElement('button');
          btnAttack.className = 'tile-action-btn attack';
          btnAttack.textContent = 'Launch Attack';
          btnAttack.addEventListener('click', () => {
            if (typeof GameEngine !== 'undefined' && GameEngine.moveUnit) {
              const playerUnit = playerCiv.units && playerCiv.units.find(u => {
                const d = typeof hexDistance !== 'undefined' ? hexDistance(u.q, u.r, q, r) : 999;
                return d <= 1 && !u.attacked;
              });
              const result = playerUnit
                ? GameEngine.moveUnit(playerCiv.id, playerUnit.id, q, r)
                : null;
              if (result && result.combat) this.showCombatModal(result);
              this.updateAllUI();
              if (typeof Renderer !== 'undefined') Renderer.markDirty();
            }
          });
          actionsEl.appendChild(btnAttack);
        }
      }

      if (actionsEl && actionsEl.children.length === 0) {
        actionsEl.innerHTML = '<p class="tile-placeholder">No actions available.</p>';
      }
    }
  },

  // ── BUILD MENU ──────────────────────────────────────────────────────────────

  /**
   * Populate #build-menu with buildings the player can construct at (q, r).
   * Buildings are grouped into CIV-style categories.
   * @param {number} q
   * @param {number} r
   */
  showBuildMenu(q, r) {
    const buildMenu = document.getElementById('build-menu');
    if (!buildMenu) return;

    buildMenu.innerHTML = '';

    const playerCiv = typeof GameEngine !== 'undefined' && GameEngine.getPlayerCiv
      ? GameEngine.getPlayerCiv() : null;
    if (!playerCiv) return;

    const allBuildings = {
      ...(typeof BUILDINGS !== 'undefined' ? BUILDINGS : {}),
      ...(typeof BRANCH_RESEARCH_BUILDINGS !== 'undefined' ? BRANCH_RESEARCH_BUILDINGS : {}),
    };

    const playerRes    = playerCiv.resources  || {};
    const playerConcepts = playerCiv.concepts || (
      typeof IdeaSpace !== 'undefined'
        ? Array.from(IdeaSpace.discoveredConcepts)
        : []
    );

    // Categorise buildings
    const CATEGORIES = {
      basic:    { label: 'Basic Infrastructure', ids: [] },
      research: { label: 'Research',             ids: [] },
      military: { label: 'Military',             ids: [] },
      advanced: { label: 'Advanced',             ids: [] },
    };

    for (const bId of Object.keys(allBuildings)) {
      const bldg = allBuildings[bId];
      const category = bldg.category || (
        /research|lab|compute/i.test(bId) ? 'research' :
        /military|barracks|fort|wall/i.test(bId) ? 'military' :
        (bldg.requires && bldg.requires.length > 0) ? 'advanced' : 'basic'
      );
      const cat = CATEGORIES[category] || CATEGORIES.basic;
      cat.ids.push(bId);
    }

    let anyRendered = false;

    for (const [, cat] of Object.entries(CATEGORIES)) {
      if (cat.ids.length === 0) continue;

      const header = document.createElement('div');
      header.className = 'build-category-header';
      header.textContent = cat.label;
      buildMenu.appendChild(header);

      for (const bId of cat.ids) {
        const bldg = allBuildings[bId];

        const missingReqs = (bldg.requires || []).filter(req => !playerConcepts.includes(req));
        const costEntries = Object.entries(bldg.cost || {});
        const canAfford   = costEntries.every(([res, need]) => (playerRes[res] || 0) >= need);
        const isDisabled  = !canAfford || missingReqs.length > 0;

        // Cost HTML with affordability colors
        const costPartsHtml = costEntries.map(([res, n]) => {
          const have     = playerRes[res] || 0;
          const cls      = have >= n ? 'cost-affordable' : 'cost-not-affordable';
          return `<span class="${cls}">${n} ${res}</span>`;
        }).join('<span style="color:rgba(180,175,160,0.5)"> / </span>') || '<span class="cost-affordable">Free</span>';

        // Branch boost HTML
        let branchBoostHtml = '';
        if (bldg.branchBoost) {
          const branch = (typeof RESEARCH_BRANCHES !== 'undefined') ? RESEARCH_BRANCHES[bldg.branchBoost.branch] : null;
          const label  = branch ? branch.label : bldg.branchBoost.branch;
          branchBoostHtml = `<div class="build-item-branch-boost">+${bldg.branchBoost.amount} ${label}</div>`;
        }

        // Missing requirements HTML
        let reqHtml = '';
        if (missingReqs.length > 0) {
          const conceptNames = missingReqs.map(rid => {
            const c = (typeof CONCEPTS !== 'undefined') ? CONCEPTS[rid] : null;
            return c ? c.name : rid;
          });
          reqHtml = `<div class="build-item-requires">Requires: ${conceptNames.join(', ')}</div>`;
        }

        const item = document.createElement('div');
        item.className = `build-item${isDisabled ? ' disabled' : ''}`;
        item.title = bldg.description || '';
        item.innerHTML = `
          <div class="build-item-name">${bldg.name}</div>
          ${bldg.description ? `<div class="build-item-desc">${bldg.description}</div>` : ''}
          <div class="build-item-cost">${costPartsHtml}</div>
          ${branchBoostHtml}
          ${reqHtml}
        `;

        if (!isDisabled) {
          item.addEventListener('click', () => {
            if (typeof GameEngine !== 'undefined' && GameEngine.buildOnTile) {
              const ok = GameEngine.buildOnTile(playerCiv.id, q, r, bId);
              if (ok) {
                this.showNotification(`${bldg.name} constructed.`, 'success');
                // Brief animation
                item.classList.add('just-built');
                setTimeout(() => item.classList.remove('just-built'), 500);
                this.updateAllUI();
                if (typeof Renderer !== 'undefined') Renderer.markDirty();
              } else {
                this.showNotification(`Cannot build ${bldg.name} here.`, 'warning');
              }
            }
          });
        }

        buildMenu.appendChild(item);
        anyRendered = true;
      }
    }

    if (!anyRendered) {
      buildMenu.innerHTML = '<p class="tile-placeholder">No buildings available.</p>';
    }
  },

  /**
   * Show a CIV-style train-unit menu in the unit actions panel.
   * @private
   */
  _showTrainMenu(q, r) {
    const actionsEl = document.getElementById('unit-actions');
    if (!actionsEl) return;

    const playerCiv = typeof GameEngine !== 'undefined' && GameEngine.getPlayerCiv
      ? GameEngine.getPlayerCiv() : null;
    if (!playerCiv) return;

    const playerRes      = playerCiv.resources || {};
    const playerConcepts = playerCiv.concepts || (
      typeof IdeaSpace !== 'undefined'
        ? Array.from(IdeaSpace.discoveredConcepts)
        : []
    );

    // Replace content with a CIV-style unit list
    actionsEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'build-category-header';
    header.textContent = 'Select Unit to Train';
    actionsEl.appendChild(header);

    for (const [uId, uType] of Object.entries(typeof UNIT_TYPES !== 'undefined' ? UNIT_TYPES : {})) {
      const missingReqs = (uType.requires || []).filter(req => !playerConcepts.includes(req));
      const costEntries = Object.entries(uType.cost || {});
      const canAfford   = costEntries.every(([res, n]) => (playerRes[res] || 0) >= n);
      const isDisabled  = !canAfford || missingReqs.length > 0;

      // Build stats string from unit properties
      const statParts = [];
      if (uType.attack  != null) statParts.push(`ATK ${uType.attack}`);
      if (uType.defense != null) statParts.push(`DEF ${uType.defense}`);
      if (uType.move    != null) statParts.push(`MOV ${uType.move}`);
      const statsStr = statParts.join('  ');

      const costStr = costEntries.map(([res, n]) => `${n} ${res}`).join(', ') || 'Free';

      let reqHtml = '';
      if (missingReqs.length > 0) {
        const conceptNames = missingReqs.map(rid => {
          const c = (typeof CONCEPTS !== 'undefined') ? CONCEPTS[rid] : null;
          return c ? c.name : rid;
        });
        reqHtml = `<div class="build-item-requires">Requires: ${conceptNames.join(', ')}</div>`;
      }

      const item = document.createElement('div');
      item.className = `unit-type-item${isDisabled ? ' disabled' : ''}`;
      item.title = uType.description || '';
      item.innerHTML = `
        <div class="unit-type-name">${uType.name}</div>
        ${statsStr ? `<div class="unit-type-stats">${statsStr}</div>` : ''}
        <div class="unit-type-cost">${costStr}</div>
        ${reqHtml}
      `;

      if (!isDisabled) {
        item.addEventListener('click', () => {
          if (typeof GameEngine !== 'undefined' && GameEngine.trainUnit) {
            const ok = GameEngine.trainUnit(playerCiv.id, q, r, uId);
            if (ok) {
              this.showNotification(`${uType.name} deployed.`, 'success');
              item.classList.add('just-trained');
              setTimeout(() => item.classList.remove('just-trained'), 500);
              this.updateAllUI();
            } else {
              this.showNotification(`Cannot train ${uType.name} here.`, 'warning');
            }
          }
        });
      }

      actionsEl.appendChild(item);
    }

    if (actionsEl.querySelectorAll('.unit-type-item').length === 0) {
      actionsEl.innerHTML += '<p class="tile-placeholder">No units available.</p>';
    }
  },

  // ── IDEA LAB ────────────────────────────────────────────────────────────────

  /**
   * Open the Idea Lab overlay and initialize the concept space canvas.
   */
  openIdeaLab() {
    const overlay = document.getElementById('idea-lab-overlay');
    if (overlay) overlay.classList.remove('hidden');
    this.ideaLabOpen = true;

    // Initialize / resize the concept-space canvas via Renderer if available
    if (typeof Renderer !== 'undefined' && Renderer.initConceptSpace) {
      const csContainer = document.getElementById('concept-space-container');
      const csCanvas    = document.getElementById('concept-space-canvas');
      if (csContainer && csCanvas) {
        csCanvas.width  = csContainer.clientWidth  || 600;
        csCanvas.height = csContainer.clientHeight || 500;
        Renderer.initConceptSpace(csCanvas);
      }
    }

    this.updateIdeaLab();

    // Accessibility: move focus to the overlay
    const closeBtn = document.getElementById('btn-close-idea-lab');
    if (closeBtn) closeBtn.focus();
  },

  /**
   * Hide the Idea Lab overlay.
   */
  closeIdeaLab() {
    const overlay = document.getElementById('idea-lab-overlay');
    if (overlay) overlay.classList.add('hidden');
    this.ideaLabOpen = false;
  },

  /**
   * Refresh all dynamic content inside the Idea Lab.
   */
  updateIdeaLab() {
    if (typeof IdeaSpace === 'undefined') return;

    const playerCiv = typeof GameEngine !== 'undefined' && GameEngine.getPlayerCiv
      ? GameEngine.getPlayerCiv() : null;
    const researchPts = playerCiv?.resources?.research ?? 0;

    // Research points display
    this._setText('rp-display', Math.floor(researchPts));

    // Concept count
    const totalDiscovered = IdeaSpace.discoveredConcepts.size;
    this._setText('concept-count', totalDiscovered);

    // Branch proficiency bars in overlay header
    const branchProf = playerCiv?.branchProficiency || {};
    this.updateBranchBars('overlay-branch-bars', branchProf);

    // Discovered concept list (filtered by search)
    const searchInput = document.getElementById('concept-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    this._renderConceptList(query);

    // Mix slots
    this._renderMixSlots();

    // Combo preview
    this._renderComboPreview(branchProf, researchPts);

    // Hints
    this._renderHints();

    // Synthesize button state
    const btnSynth = document.getElementById('btn-synthesize');
    if (btnSynth) {
      const canSynth = IdeaSpace.mixSlots[0] && IdeaSpace.mixSlots[1];
      btnSynth.disabled = !canSynth;
    }

    // Research panel
    this._renderResearchPanel();
  },

  /**
   * Render 7 branch proficiency bars in the given container.
   * @param {string} containerId
   * @param {Object} branchProficiency  e.g. { archaeotech: 5, logic: 2, ... }
   */
  updateBranchBars(containerId, branchProficiency) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    for (const [branchId, branch] of Object.entries(
      typeof RESEARCH_BRANCHES !== 'undefined' ? RESEARCH_BRANCHES : {}
    )) {
      const val = branchProficiency[branchId] ?? 0;
      const pct = Math.min(100, (val / 10) * 100);

      const row = document.createElement('div');
      row.className = 'branch-bar-row';
      row.title = `${branch.label}: ${val}/10`;

      row.innerHTML = `
        <span class="branch-bar-icon" aria-hidden="true">${branch.icon || ''}</span>
        <span class="branch-bar-label">${branch.label}</span>
        <div class="branch-bar-track">
          <div class="branch-bar-fill" style="width:${pct}%;background:${branch.color}"></div>
        </div>
        <span class="branch-bar-value">${val}</span>
      `;

      container.appendChild(row);
    }
  },

  /**
   * Render the concept pill list, optionally filtered by a search query.
   * @private
   */
  _renderConceptList(query) {
    const listEl = document.getElementById('concept-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    const discovered = Array.from(
      typeof IdeaSpace !== 'undefined' ? IdeaSpace.discoveredConcepts : []
    );

    const filtered = discovered.filter(cId => {
      if (!query) return true;
      const concept = (typeof CONCEPTS !== 'undefined') ? CONCEPTS[cId] : null;
      return concept && concept.name.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = '<p class="tile-placeholder">No concepts match.</p>';
      return;
    }

    // Group by cluster
    const byCluster = {};
    for (const cId of filtered) {
      const concept = (typeof CONCEPTS !== 'undefined') ? CONCEPTS[cId] : null;
      if (!concept) continue;
      const cluster = concept.cluster || 'unknown';
      if (!byCluster[cluster]) byCluster[cluster] = [];
      byCluster[cluster].push({ id: cId, concept });
    }

    for (const [cluster, entries] of Object.entries(byCluster)) {
      const clusterMeta = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[cluster] : null;
      const color = clusterMeta ? clusterMeta.color : '#888';

      for (const { id: cId, concept } of entries) {
        const pill = document.createElement('button');
        pill.className = 'concept-pill';
        pill.style.borderColor = color;
        pill.style.color       = color;

        // Highlight if in a mix slot
        const slots = typeof IdeaSpace !== 'undefined' ? IdeaSpace.mixSlots : [null, null];
        if (slots.includes(cId)) pill.classList.add('in-slot');

        pill.textContent = concept.name;
        pill.title       = `${concept.description || ''}\n\nEffects: ${this._formatResources(concept.effects || {})}`;

        pill.addEventListener('click', () => this.onConceptSelected(cId));
        listEl.appendChild(pill);
      }
    }
  },

  /**
   * Render the two mix slots based on IdeaSpace.mixSlots state.
   * @private
   */
  _renderMixSlots() {
    for (let slot = 0; slot < 2; slot++) {
      const slotEl   = document.getElementById(`slot-concept-${slot}`);
      if (!slotEl) continue;

      const cId    = typeof IdeaSpace !== 'undefined' ? IdeaSpace.mixSlots[slot] : null;
      const concept = (cId && typeof CONCEPTS !== 'undefined') ? CONCEPTS[cId] : null;

      if (concept) {
        const clusterMeta = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[concept.cluster] : null;
        const color = clusterMeta ? clusterMeta.color : '#888';
        slotEl.textContent = concept.name;
        slotEl.style.color = color;
        slotEl.style.borderColor = color;
        slotEl.classList.add('slot-filled');
      } else {
        slotEl.textContent = 'Click a concept →';
        slotEl.style.color = '';
        slotEl.style.borderColor = '';
        slotEl.classList.remove('slot-filled');
      }
    }
  },

  /**
   * Render the combination preview (success chance, cost, cross-branch warning).
   * @private
   */
  _renderComboPreview(branchProficiency, researchPoints) {
    const preview = document.getElementById('combo-preview');
    if (!preview) return;

    const slots   = typeof IdeaSpace !== 'undefined' ? IdeaSpace.mixSlots : [null, null];
    const [idA, idB] = slots;

    if (!idA || !idB) {
      preview.classList.add('hidden');
      return;
    }

    preview.classList.remove('hidden');

    const stats = IdeaSpace.getCombinationStats(idA, idB, branchProficiency);

    const chanceEl  = document.getElementById('combo-chance');
    const costEl    = document.getElementById('combo-cost');
    const warnEl    = document.getElementById('combo-distance-warn');

    if (chanceEl) {
      const pct = Math.round(stats.successChance * 100);
      chanceEl.textContent = `${pct}%`;
      chanceEl.style.color = pct >= 70 ? '#6f6' : pct >= 40 ? '#fa0' : '#f66';
    }

    if (costEl) {
      const affordable = researchPoints >= stats.actualCost;
      costEl.textContent = `${stats.actualCost}`;
      costEl.style.color = affordable ? '#6f6' : '#f66';
    }

    if (warnEl) {
      if (stats.distance >= 3) {
        warnEl.classList.remove('hidden');
      } else {
        warnEl.classList.add('hidden');
      }
    }

    // If no known combo recipe, note it
    const noComboNote = document.getElementById('combo-no-recipe');
    if (!stats.combo) {
      if (!noComboNote) {
        const note = document.createElement('div');
        note.id = 'combo-no-recipe';
        note.className = 'combo-warn';
        note.textContent = '⚠️ No known synthesis pathway.';
        preview.appendChild(note);
      }
    } else {
      if (noComboNote) noComboNote.remove();
    }
  },

  /**
   * Render the hint list.
   * @private
   */
  _renderHints() {
    const hintList = document.getElementById('hint-list');
    if (!hintList) return;

    if (typeof IdeaSpace === 'undefined') {
      hintList.innerHTML = '<p class="tile-placeholder">No hints available.</p>';
      return;
    }

    const hints = IdeaSpace.getHints();
    hintList.innerHTML = '';

    if (hints.length === 0) {
      hintList.innerHTML = '<p class="tile-placeholder">No leads yet — keep discovering!</p>';
      return;
    }

    for (const hint of hints.slice(0, 8)) { // cap at 8 hints for readability
      const item = document.createElement('div');
      item.className = 'hint-item';

      const resultConcept = (typeof CONCEPTS !== 'undefined') ? CONCEPTS[hint.conceptId] : null;
      const clusterMeta   = resultConcept && CLUSTER_META ? CLUSTER_META[resultConcept.cluster] : null;
      const color         = clusterMeta ? clusterMeta.color : '#888';

      const ingNames = hint.ingredients.map(iId => {
        const known = typeof IdeaSpace !== 'undefined' && IdeaSpace.discoveredConcepts.has(iId);
        const c = (typeof CONCEPTS !== 'undefined') ? CONCEPTS[iId] : null;
        const name = c ? c.name : iId;
        return known ? `<span class="hint-ing known">${name}</span>` : `<span class="hint-ing unknown">???</span>`;
      });

      item.innerHTML = `
        <span class="hint-result" style="color:${color}">${hint.name}</span>
        <span class="hint-eq"> = </span>
        ${ingNames.join('<span class="hint-plus"> + </span>')}
      `;

      hintList.appendChild(item);
    }
  },

  // ── CONCEPT SELECTION ───────────────────────────────────────────────────────

  /**
   * Handle concept selection from either the concept list or the canvas.
   * @param {string} conceptId
   */
  onConceptSelected(conceptId) {
    if (typeof IdeaSpace === 'undefined') return;

    const slots = IdeaSpace.mixSlots;

    if (!slots[0]) {
      IdeaSpace.selectForMix(conceptId, 0);
    } else if (!slots[1]) {
      // Don't allow same concept in both slots
      if (slots[0] === conceptId) {
        this.showNotification('This concept is already in slot A.', 'warning', 2000);
        return;
      }
      IdeaSpace.selectForMix(conceptId, 1);
    } else {
      // Both slots full — replace slot 0, shift current slot 0 out
      // (silently overwrite slot 0 for smooth UX; advanced users can clear manually)
      IdeaSpace.mixSlots[0] = conceptId;
      if (IdeaSpace.mixSlots[1] === conceptId) {
        IdeaSpace.mixSlots[1] = null;
      }
    }

    // Notify renderer
    if (typeof Renderer !== 'undefined') Renderer.markDirty();

    this.updateIdeaLab();
  },

  // ── SYNTHESIZE ──────────────────────────────────────────────────────────────

  /**
   * Attempt a concept combination and handle the result.
   */
  onSynthesizeClicked() {
    if (typeof IdeaSpace === 'undefined' || typeof GameEngine === 'undefined') return;

    const playerCiv = GameEngine.getPlayerCiv ? GameEngine.getPlayerCiv() : null;
    if (!playerCiv) return;

    const branchProf   = playerCiv.branchProficiency || {};
    const researchPts  = playerCiv.resources?.research ?? 0;
    const currentTurn  = GameEngine.state?.turn ?? 0;

    const result = IdeaSpace.attemptCombination(branchProf, researchPts, currentTurn);

    // Deduct research cost from player civ
    if (result.actualCost > 0 && GameEngine.deductResearch) {
      GameEngine.deductResearch(playerCiv.id, result.actualCost);
    } else if (result.actualCost > 0 && playerCiv.resources) {
      playerCiv.resources.research = Math.max(0, (playerCiv.resources.research || 0) - result.actualCost);
    }

    // Show result in #synthesis-result
    const resultEl = document.getElementById('synthesis-result');
    if (resultEl) {
      resultEl.textContent = result.message;
      resultEl.className = `synthesis-result synthesis-result--${result.success ? 'success' : 'failure'}`;
      // Auto-clear after 4 seconds
      clearTimeout(this._synthResultTimer);
      this._synthResultTimer = setTimeout(() => {
        if (resultEl) resultEl.textContent = '';
      }, 4000);
    }

    if (result.success && !result.alreadyKnown) {
      // Get the concept definition (may be a dynamic newConcept)
      const conceptDef = result.newConceptDef
        || ((typeof CONCEPTS !== 'undefined') ? CONCEPTS[result.result] : null);

      if (conceptDef) {
        this.showDiscoveryModal(conceptDef);
      }

      // Notify engine of the discovery so it can apply stat effects
      if (GameEngine.onConceptDiscovered) {
        GameEngine.onConceptDiscovered(playerCiv.id, result.result, conceptDef);
      }

      // Add to game log
      if (GameEngine.addMessage) {
        GameEngine.addMessage(
          `Discovery: ${conceptDef?.name || result.result}!`,
          'success'
        );
      }
    } else if (!result.success) {
      // Animate failure on the canvas
      if (typeof Renderer !== 'undefined' && Renderer.animateFailedCombo) {
        Renderer.animateFailedCombo(IdeaSpace.mixSlots[0], IdeaSpace.mixSlots[1]);
      }
    }

    // Clear mix slots after attempt
    IdeaSpace.clearMixSlots();

    this.updateAllUI();
    if (typeof Renderer !== 'undefined') Renderer.markDirty();
  },

  /**
   * Show the discovery modal for a newly found concept.
   * @param {Object} conceptDef
   */
  showDiscoveryModal(conceptDef) {
    if (!conceptDef) return;

    const clusterMeta = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[conceptDef.cluster] : null;

    this._setText('disc-concept-name', conceptDef.name);
    this._setText('disc-concept-desc', conceptDef.description || '');

    // Effects list
    const effectsEl = document.getElementById('disc-concept-effects');
    if (effectsEl) {
      effectsEl.innerHTML = Object.entries(conceptDef.effects || {})
        .map(([res, val]) => `<div class="effect-row">+${val} ${res}</div>`)
        .join('');
    }

    // Color the modal header by cluster
    const discContent = document.querySelector('.discovery-content');
    if (discContent && clusterMeta) {
      discContent.style.setProperty('--cluster-color', clusterMeta.color);
      discContent.style.borderColor = clusterMeta.color;
    }

    this.showModal('discovery-modal');

    // Trigger canvas animation
    if (typeof Renderer !== 'undefined' && Renderer.animateDiscovery) {
      Renderer.animateDiscovery(conceptDef.id);
    }
  },

  // ── MODALS ──────────────────────────────────────────────────────────────────

  /**
   * Show the event modal for a world event.
   * @param {Object} event  EVENTS entry
   * @param {Object} effects  applied effects map
   */
  showEventModal(event, effects) {
    if (!event) return;

    this._setText('event-icon',  event.icon || '📋');
    this._setText('event-title', event.name || 'Event');
    this._setText('event-desc',  event.description || '');

    const effectsEl = document.getElementById('event-effects-list');
    if (effectsEl) {
      effectsEl.innerHTML = '';
      for (const [key, val] of Object.entries(effects || {})) {
        const row = document.createElement('div');
        row.className = 'effect-row';
        row.textContent = `${key}: ${val}`;
        effectsEl.appendChild(row);
      }
    }

    // Border colour by event type
    const modalContent = document.querySelector('.event-modal-content');
    if (modalContent) {
      modalContent.style.borderColor =
        event.type === 'disaster' ? '#f44' :
        event.type === 'windfall' ? '#4f4' : '#888';
    }

    this.showModal('event-modal');
  },

  /**
   * Show the combat result modal.
   * @param {Object} combatResult
   */
  showCombatModal(combatResult) {
    if (!combatResult) return;

    const detailsEl = document.getElementById('combat-details');
    if (detailsEl) {
      const attackerFaction = (typeof FACTIONS !== 'undefined' && combatResult.attackerFaction)
        ? FACTIONS[combatResult.attackerFaction] : null;
      const defenderFaction = (typeof FACTIONS !== 'undefined' && combatResult.defenderFaction)
        ? FACTIONS[combatResult.defenderFaction] : null;

      detailsEl.innerHTML = `
        <div class="combat-row">
          <span class="combat-attacker" style="color:${attackerFaction?.color || '#f88'}">
            ${attackerFaction?.name || 'Attacker'}
          </span>
          <span class="combat-vs">vs</span>
          <span class="combat-defender" style="color:${defenderFaction?.color || '#88f'}">
            ${defenderFaction?.name || 'Defender'}
          </span>
        </div>
        <div class="combat-row">
          Damage dealt: <strong>${combatResult.damageDealt ?? '—'}</strong>
        </div>
        <div class="combat-row combat-outcome">
          ${combatResult.outcome || (combatResult.attackerWon ? '⚔️ Attacker wins!' : '🛡️ Defender holds!')}
        </div>
      `;
    }

    this.showModal('combat-modal');
  },

  /**
   * Show the victory or defeat end-game modal.
   * @param {string}  winnerCivId
   * @param {string}  type  e.g. 'tech', 'conquest', 'defeat'
   * @param {Object}  stats
   */
  showEndModal(winnerCivId, type, stats) {
    const playerCiv = typeof GameEngine !== 'undefined' && GameEngine.getPlayerCiv
      ? GameEngine.getPlayerCiv() : null;
    const isVictory = playerCiv && winnerCivId === playerCiv.id;

    const faction = playerCiv && FACTIONS ? FACTIONS[playerCiv.factionId] : null;
    const factionName = faction ? faction.name : 'Your civilization';
    const factionColor = faction ? faction.color : '#fff';

    // Icon and title
    const iconEl  = document.getElementById('end-icon');
    const titleEl = document.getElementById('end-title');
    const msgEl   = document.getElementById('end-message');

    if (iconEl)  iconEl.textContent  = isVictory ? '🏆' : '💀';
    if (titleEl) {
      titleEl.textContent = isVictory ? 'Victory!' : 'Defeat';
      titleEl.style.color = isVictory ? factionColor : '#f44';
    }

    if (msgEl) {
      if (isVictory) {
        const victoryMessages = {
          tech:     `${factionName} has transcended silicon and circuit, achieving technological singularity.`,
          conquest: `${factionName} has crushed all opposition and dominates the digital world.`,
        };
        msgEl.textContent = victoryMessages[type] || `${factionName} has achieved victory!`;
      } else {
        const winnerFaction = (typeof GameEngine !== 'undefined')
          ? Object.values(GameEngine.state?.civs || {}).find(c => c.id === winnerCivId)
          : null;
        const winnerFactionData = winnerFaction && FACTIONS ? FACTIONS[winnerFaction.factionId] : null;
        msgEl.textContent = `${winnerFactionData?.name || 'Another civilization'} has prevailed. Your civilization has fallen.`;
      }
    }

    // Stats
    const statsEl = document.getElementById('end-stats');
    if (statsEl && stats) {
      statsEl.innerHTML = `
        <div class="end-stat-row"><span>Turns survived</span><span>${stats.turnsReached ?? stats.turn ?? '—'}</span></div>
        <div class="end-stat-row"><span>Concepts discovered</span><span>${stats.conceptsDiscovered ?? '—'}</span></div>
        <div class="end-stat-row"><span>Peak tiles owned</span><span>${stats.peakTiles ?? '—'}</span></div>
        <div class="end-stat-row"><span>Final compute</span><span>${Math.floor(stats.finalCompute ?? 0)}</span></div>
      `;
    }

    this.showModal('end-modal');
  },

  /** Show a modal by id (removes 'hidden' class). */
  showModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('hidden');
  },

  /** Hide a modal by id (adds 'hidden' class). */
  hideModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('hidden');
  },

  /** Hide all elements with class .modal. */
  hideAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  },

  // ── NOTIFICATIONS ────────────────────────────────────────────────────────────

  /**
   * Show a temporary toast notification in the top-right corner.
   * @param {string} text
   * @param {'info'|'warning'|'danger'|'success'} type
   * @param {number} duration  milliseconds before auto-dismiss
   */
  showNotification(text, type = 'info', duration = 3000) {
    // Find or create the notifications container
    let container = document.getElementById('notification-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notification-container';
      container.style.cssText = [
        'position:fixed',
        'top:70px',
        'right:16px',
        'z-index:9999',
        'display:flex',
        'flex-direction:column',
        'gap:8px',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `notification notification--${type}`;

    const colorMap = {
      info:    '#3399ff',
      warning: '#ffcc44',
      danger:  '#ff4444',
      success: '#44ff88',
    };
    const color = colorMap[type] || colorMap.info;

    toast.style.cssText = [
      'background:#1a1a2e',
      `border-left:3px solid ${color}`,
      `color:${color}`,
      'padding:8px 14px',
      'border-radius:4px',
      'font-size:0.85rem',
      'max-width:280px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.6)',
      'pointer-events:auto',
      'opacity:1',
      'transition:opacity 0.3s ease',
      'line-height:1.4',
    ].join(';');
    toast.textContent = text;

    container.appendChild(toast);

    // Auto-dismiss
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
    }, duration);
  },

  // ── PRIVATE HELPERS ──────────────────────────────────────────────────────────

  /**
   * Render the direct research panel in #research-panel.
   * @private
   */
  _renderResearchPanel() {
    const container = document.getElementById('research-panel');
    if (!container) return;

    const playerCiv = GameEngine.getPlayerCiv ? GameEngine.getPlayerCiv() : null;
    if (!playerCiv) return;

    const rp = playerCiv.resources?.research || 0;
    const bp = playerCiv.branchProficiency || {};
    const available = IdeaSpace.getResearchableConepts(bp, rp);

    if (available.length === 0) {
      container.innerHTML = '<div class="research-empty">All accessible concepts known. Advance branch proficiency to unlock more.</div>';
      return;
    }

    // Group by branch
    const byBranch = {};
    for (const item of available) {
      const key = item.branch || 'other';
      if (!byBranch[key]) byBranch[key] = [];
      byBranch[key].push(item);
    }

    let html = '';
    for (const [branch, items] of Object.entries(byBranch)) {
      const branchMeta = (typeof RESEARCH_BRANCHES !== 'undefined') ? RESEARCH_BRANCHES[branch] : null;
      const branchColor = branchMeta?.color || '#888';
      const branchLabel = branchMeta?.label || branch;
      html += `<div class="research-branch-group">
        <div class="research-branch-header" style="color:${branchColor}">${branchLabel}</div>`;
      for (const { concept, cost, affordable } of items) {
        html += `<div class="research-item ${affordable ? 'affordable' : 'unaffordable'}" data-concept-id="${concept.id}">
          <div class="research-item-name">${concept.name}</div>
          <div class="research-item-desc">${concept.description || ''}</div>
          <div class="research-item-cost">${affordable ? '' : '⚠ '}${cost} RP</div>
        </div>`;
      }
      html += `</div>`;
    }
    container.innerHTML = html;

    // Wire click handlers
    container.querySelectorAll('.research-item.affordable').forEach(el => {
      el.addEventListener('click', () => {
        const conceptId = el.dataset.conceptId;
        const result = IdeaSpace.researchDirect(conceptId, bp, rp);
        if (result.success) {
          playerCiv.resources.research = Math.max(0, rp - result.actualCost);
          UI.showNotification(`Researched: ${result.concept.name}`, 'success');
          if (typeof Renderer !== 'undefined') {
            Renderer.animateDiscovery(conceptId, () => {});
            Renderer._needsFit = true;
            Renderer.markDirty();
          }
          UI.updateIdeaLab();
          UI.updateTopBar();
        } else {
          UI.showNotification(result.message, 'warning');
        }
      });
    });
  },

  /**
   * Safely set the textContent of an element by id.
   * @private
   */
  _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  },

  /**
   * Format a resource object as a compact human-readable string.
   * e.g. { silicon: 2, energy: 1 } → "2 silicon, 1 energy"
   * @private
   */
  _formatResources(resources) {
    if (!resources || typeof resources !== 'object') return '';
    return Object.entries(resources)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`)
      .join(', ');
  },
};

// Expose globally
if (typeof window !== 'undefined') {
  window.UI = UI;
}
