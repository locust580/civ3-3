// =============================================================================
// Silicon Civilizations — Renderer
// Handles ALL canvas rendering: hex map, concept space, and UI updates.
// Depends on data.js and mapgen.js being loaded first (TILE_TYPES, BUILDINGS,
// CONCEPTS, CLUSTER_META, hexToPixel, pixelToHex must be globally available).
// Exports a single global `Renderer` object.
// =============================================================================

const Renderer = {

  // ─── MAP CANVAS STATE ──────────────────────────────────────────────────────
  mapCanvas: null,
  mapCtx: null,
  mapOffsetX: 0,
  mapOffsetY: 0,
  mapZoom: 1.0,
  hexSize: 38,         // base hex size in pixels (flat-top)
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  selectedHex: null,   // { q, r } of selected hex
  hoveredHex: null,    // { q, r } of hovered hex

  // ─── CONCEPT SPACE CANVAS STATE ────────────────────────────────────────────
  csCanvas: null,
  csCtx: null,
  csOffsetX: 0,
  csOffsetY: 0,
  csZoom: 1.0,
  csRotationX: 0,      // pseudo-3D tilt (-0.3 to 0.3)
  csRotationY: 0,
  csIsDragging: false,
  csDragStart: { x: 0, y: 0 },
  hoveredConcept: null,
  selectedConcepts: [], // up to 2 selected concept ids for mixing

  // ─── RENDER LOOP INTERNALS ─────────────────────────────────────────────────
  _dirty: true,
  _rafId: null,
  _ideaLabOpen: false,
  _getGameState: null,
  _getIdeaSpaceState: null,

  // Pre-computed star field for concept space (fixed positions per session)
  _stars: null,

  // Active discovery animations: { conceptId, startTime, duration, onComplete }
  _discoveryAnims: [],

  // Active unit move animations: { unitId, fromX, fromY, toX, toY, startTime, duration, civColor, unitType }
  _unitMoveAnims: [],

  // ─── Z-DEPTH PER CLUSTER (for pseudo-3D) ──────────────────────────────────
  _clusterZDepth: {
    mythological: 0.2,
    mathematical: 0.5,
    mechanical:   0.3,
    electrical:   0.4,
    digital:      0.6,
    networked:    0.7,
    ai:           0.8,
    quantum:      0.9,
    steampunk:    0.25,
  },

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize both canvases and generate the star field for concept space.
   * @param {HTMLCanvasElement} mapCanvasEl
   * @param {HTMLCanvasElement} csCanvasEl
   */
  init(mapCanvasEl, csCanvasEl) {
    // Map canvas
    if (mapCanvasEl) {
      this.mapCanvas = mapCanvasEl;
      this.mapCtx = mapCanvasEl.getContext('2d');
      // Center initial offset so the map starts visible
      this.mapOffsetX = mapCanvasEl.width  / 2;
      this.mapOffsetY = mapCanvasEl.height / 2;
    }

    // Concept space canvas
    if (csCanvasEl) {
      this.csCanvas = csCanvasEl;
      this.csCtx = csCanvasEl.getContext('2d');
      this.csOffsetX = csCanvasEl.width  / 2;
      this.csOffsetY = csCanvasEl.height / 2;
    }

    // Generate a fixed star field (~200 stars)
    this._stars = this._generateStars(220);

    this._dirty = true;
    this._needsFit = true;
  },

  fitToDiscovered(discoveredSet) {
    if (!this.csCanvas || !discoveredSet || discoveredSet.size === 0) return;
    const W = this.csCanvas.width;
    const H = this.csCanvas.height;

    // Gather discovered concept positions in data space (x,y from CONCEPTS)
    const discovered = [];
    const allConcepts = (typeof CONCEPTS !== 'undefined') ? CONCEPTS : {};
    for (const id of discoveredSet) {
      const c = allConcepts[id];
      if (c && c.x != null && c.y != null) discovered.push(c);
    }
    if (discovered.length === 0) return;

    // Find bounding box in data space
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of discovered) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, -c.y); // note: y is flipped (higher y = ancient = bottom)
      maxY = Math.max(maxY, -c.y);
    }

    // Add padding
    const padFraction = 0.4;
    const rangeX = Math.max(0.3, maxX - minX);
    const rangeY = Math.max(0.3, maxY - minY);

    // Target zoom: fit the bounding box into 60% of the canvas with padding
    const baseScale = Math.min(W, H) * 0.65; // matches _csNodeScreenPos scale at zoom=1
    const targetZoom = Math.min(
      (W * 0.6) / (rangeX * baseScale + 1),
      (H * 0.6) / (rangeY * baseScale + 1),
      2.5  // cap zoom
    );

    // Target offset: center the bounding box
    const midDataX = (minX + maxX) / 2;
    const midDataY = (minY + maxY) / 2;  // already negated
    this.csZoom = Math.max(0.6, Math.min(2.5, targetZoom));
    this.csOffsetX = W / 2 - midDataX * Math.min(W, H) * 0.65 * this.csZoom;
    this.csOffsetY = H / 2 + midDataY * Math.min(W, H) * 0.65 * this.csZoom;
    this._dirty = true;
  },

  // ==========================================================================
  // MAP RENDERING
  // ==========================================================================

  /**
   * Full render pass for the hex map.
   * @param {Object} gameState - current game state (mapTiles, civs, playerCivId, turn …)
   */
  renderMap(gameState) {
    const ctx = this.mapCtx;
    const canvas = this.mapCanvas;
    if (!ctx || !canvas) return;

    const W = canvas.width;
    const H = canvas.height;

    // --- Background -----------------------------------------------------------
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, W, H);
    this._drawMapBackground(ctx, W, H);

    if (!gameState || (!gameState.mapTiles && !gameState.map)) return;

    const mapTiles = gameState.mapTiles || gameState.map;
    const { civs, playerCivId } = gameState;

    // Effective hex size after zoom
    const size = this.hexSize * this.mapZoom;

    // --- Draw every tile -------------------------------------------------------
    for (const [, tile] of mapTiles) {
      const px = this._hexScreenX(tile.q, tile.r, size);
      const py = this._hexScreenY(tile.q, tile.r, size);

      // Culling: skip tiles entirely outside the viewport (with margin)
      if (px < -size * 2 || px > canvas.width + size * 2) continue;
      if (py < -size * 2 || py > canvas.height + size * 2) continue;

      const isExplored = this._isTileExplored(tile, playerCivId);
      const isSelected = this.selectedHex &&
        this.selectedHex.q === tile.q && this.selectedHex.r === tile.r;
      const isHovered  = this.hoveredHex  &&
        this.hoveredHex.q  === tile.q && this.hoveredHex.r  === tile.r;

      this.drawHexTerrain(ctx, tile, isExplored, isSelected, isHovered, size);

      // Territory color overlay
      if (tile.owner && isExplored) {
        const civ = civs && civs[tile.owner];
        if (civ) {
          this._drawTerritoryOverlay(ctx, tile.q, tile.r, civ.color || '#ffffff', size);
        }
      }
    }

    // --- Territory borders ---------------------------------------------------
    if (civs) {
      this.drawTerritoryBorders(ctx, gameState, size);
    }

    // --- Buildings -----------------------------------------------------------
    for (const [, tile] of mapTiles) {
      if (!tile.building) continue;
      const isExplored = this._isTileExplored(tile, playerCivId);
      if (!isExplored) continue;
      const px = this._hexScreenX(tile.q, tile.r, size);
      const py = this._hexScreenY(tile.q, tile.r, size);
      if (px < -size * 2 || px > canvas.width + size * 2) continue;
      if (py < -size * 2 || py > canvas.height + size * 2) continue;
      this.drawBuilding(ctx, px, py, tile.building, this.mapZoom);
    }

    // --- Units ---------------------------------------------------------------
    for (const [, tile] of mapTiles) {
      if (!tile.units || tile.units.length === 0) continue;
      const isExplored = this._isTileExplored(tile, playerCivId);
      if (!isExplored) continue;
      const px = this._hexScreenX(tile.q, tile.r, size);
      const py = this._hexScreenY(tile.q, tile.r, size);
      if (px < -size * 2 || px > canvas.width + size * 2) continue;
      if (py < -size * 2 || py > canvas.height + size * 2) continue;
      for (let i = 0; i < tile.units.length; i++) {
        const unit = tile.units[i];
        const civ  = civs && civs[unit.civId];
        const civColor = civ ? (civ.color || '#aaaaaa') : '#aaaaaa';
        // Offset multiple units slightly so they don't stack perfectly
        const offsetX = tile.units.length > 1 ? (i - (tile.units.length - 1) / 2) * size * 0.35 : 0;
        this.drawUnit(ctx, px + offsetX, py, unit, civColor, size, tile.units.length);
      }
    }

    // --- Capital markers -----------------------------------------------------
    if (civs) {
      for (const [civId, civ] of Object.entries(civs)) {
        const capQ = civ.capitalQ !== undefined ? civ.capitalQ : (civ.capital ? civ.capital.q : undefined);
        const capR = civ.capitalR !== undefined ? civ.capitalR : (civ.capital ? civ.capital.r : undefined);
        if (capQ === undefined || capR === undefined) continue;
        const isExplored = this._isTileExploredByCoord(capQ, capR, mapTiles, playerCivId);
        if (!isExplored) continue;
        const px = this._hexScreenX(capQ, capR, size);
        const py = this._hexScreenY(capQ, capR, size);
        if (px < -size * 2 || px > canvas.width + size * 2) continue;
        if (py < -size * 2 || py > canvas.height + size * 2) continue;
        this.drawCapitalMarker(ctx, px, py, civ.color || '#ffffff', size);
      }
    }

    // --- Enemy location hints (faint markers visible through fog) ---
    if (civs) {
      for (const [civId, civ] of Object.entries(civs)) {
        if (civId === playerCivId) continue;
        if (civ.isDefeated) continue;
        const capQ = civ.capital?.q;
        const capR = civ.capital?.r;
        if (capQ === undefined) continue;
        const isFullyKnown = this._isTileExploredByCoord(capQ, capR, mapTiles, playerCivId);
        if (isFullyKnown) continue; // already shown via capital marker

        const px = this._hexScreenX(capQ, capR, size);
        const py = this._hexScreenY(capQ, capR, size);
        if (px < -size*3 || px > canvas.width+size*3) continue;
        if (py < -size*3 || py > canvas.height+size*3) continue;

        // Draw a faint pulsing diamond marker
        const pulse = 0.4 + 0.2 * Math.sin(Date.now() * 0.002 + civId.charCodeAt(0));
        ctx.save();
        ctx.globalAlpha = pulse * 0.35;
        ctx.strokeStyle = civ.color || '#ff4444';
        ctx.lineWidth = 1.5;
        const mr = size * 0.5;
        ctx.beginPath();
        ctx.moveTo(px, py - mr);
        ctx.lineTo(px + mr * 0.6, py);
        ctx.lineTo(px, py + mr);
        ctx.lineTo(px - mr * 0.6, py);
        ctx.closePath();
        ctx.stroke();
        // Small "?" text
        ctx.globalAlpha = pulse * 0.5;
        ctx.fillStyle = civ.color || '#ff4444';
        ctx.font = `bold ${Math.max(8, size * 0.3)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', px, py);
        ctx.restore();
      }
      this._dirty = true;
    }

    // --- Selected hex highlight (drawn on top) --------------------------------
    if (this.selectedHex) {
      const px = this._hexScreenX(this.selectedHex.q, this.selectedHex.r, size);
      const py = this._hexScreenY(this.selectedHex.q, this.selectedHex.r, size);
      this.drawHex(ctx, this.selectedHex.q, this.selectedHex.r,
        'rgba(0,230,255,0.10)', '#00e5ff', 2.5, size);
    }

    // --- Hovered hex highlight -----------------------------------------------
    if (this.hoveredHex && !(
      this.selectedHex &&
      this.selectedHex.q === this.hoveredHex.q &&
      this.selectedHex.r === this.hoveredHex.r
    )) {
      this.drawHex(ctx, this.hoveredHex.q, this.hoveredHex.r,
        'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.4)', 1.5, size);
    }

    // --- Moving unit animations ---
    const now = Date.now();
    this._unitMoveAnims = (this._unitMoveAnims || []).filter(anim => {
      const t = Math.min(1, (now - anim.startTime) / anim.duration);
      // Ease in-out
      const ease = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
      const cx = anim.fromX + (anim.toX - anim.fromX) * ease;
      const cy = anim.fromY + (anim.toY - anim.fromY) * ease;

      // Draw moving unit as a glowing dot trailing a line
      ctx.save();
      // Trail line
      ctx.beginPath();
      ctx.moveTo(anim.fromX, anim.fromY);
      ctx.lineTo(cx, cy);
      ctx.strokeStyle = anim.civColor;
      ctx.globalAlpha = (1 - ease) * 0.5;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Moving unit dot
      const r = size * 0.18;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = anim.civColor;
      ctx.shadowColor = anim.civColor;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();

      if (t < 1) this._dirty = true;
      return t < 1; // keep in array until done
    });
  },

  // ---------------------------------------------------------------------------
  // drawHex — low-level flat-top hex primitive
  // ---------------------------------------------------------------------------

  /**
   * Draw a single flat-top hexagon at axial position (q, r).
   * Angles: 0°, 60°, 120°, 180°, 240°, 300° from center.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} q
   * @param {number} r
   * @param {string|null} fillColor   - CSS color or null to skip fill
   * @param {string|null} strokeColor - CSS color or null to skip stroke
   * @param {number} strokeWidth
   * @param {number} [sizeOverride]   - override this.hexSize*zoom if provided
   */
  drawHex(ctx, q, r, fillColor, strokeColor, strokeWidth, sizeOverride) {
    const size = sizeOverride !== undefined ? sizeOverride : this.hexSize * this.mapZoom;
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angleDeg = 60 * i;                  // flat-top: 0° is to the right
      const angleRad = (Math.PI / 180) * angleDeg;
      const cornerX  = cx + size * Math.cos(angleRad);
      const cornerY  = cy + size * Math.sin(angleRad);
      if (i === 0) ctx.moveTo(cornerX, cornerY);
      else         ctx.lineTo(cornerX, cornerY);
    }
    ctx.closePath();

    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    if (strokeColor && strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = strokeWidth;
      ctx.stroke();
    }
  },

  // ---------------------------------------------------------------------------
  // drawHexTerrain — terrain fill, fog, textures
  // ---------------------------------------------------------------------------

  /**
   * Fill a hex with terrain-specific canvas illustrations.
   */
  drawHexTerrain(ctx, tile, isExplored, isSelected, isHovered, size) {
    const q = tile.q, r = tile.r;

    // VOID / UNEXPLORED: handled by _drawFogHex (animated fog)
    if (tile.type === 'void_zone') {
      this._drawVoidHex(ctx, q, r, size, Date.now());
      return;
    }

    if (!isExplored) {
      this._drawFogHex(ctx, q, r, size);
      return;
    }

    // Clip to hex shape
    this._clipToHex(ctx, q, r, size);

    // Draw terrain-specific content
    switch(tile.type) {
      case 'circuit_plains':   this._drawCircuitPlains(ctx, q, r, size); break;
      case 'silicon_valley':   this._drawSiliconValley(ctx, q, r, size); break;
      case 'data_swamp':       this._drawDataSwamp(ctx, q, r, size); break;
      case 'energy_geysers':   this._drawEnergyGeysers(ctx, q, r, size); break;
      case 'quantum_fields':   this._drawQuantumFields(ctx, q, r, size); break;
      case 'memory_mountains': this._drawMemoryMountains(ctx, q, r, size); break;
      case 'thermal_wastes':   this._drawThermalWastes(ctx, q, r, size); break;
      case 'logic_forest':     this._drawLogicForest(ctx, q, r, size); break;
      case 'cooling_lake':     this._drawCoolingLake(ctx, q, r, size); break;
      case 'rare_earth':       this._drawRareEarth(ctx, q, r, size); break;
      case 'ancient_ruins':    this._drawAncientRuins(ctx, q, r, size); break;
      default: this._drawGenericTerrain(ctx, q, r, size, '#2a2a3a');
    }

    ctx.restore(); // pop clip

    // Selection/hover highlight on top
    if (isSelected) {
      this.drawHex(ctx, q, r, 'rgba(0,220,255,0.12)', '#00e5ff', 2.5, size);
    } else if (isHovered) {
      this.drawHex(ctx, q, r, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.3)', 1, size);
    }
  },

  /** Save ctx and clip subsequent drawing to the hex polygon at (q,r). */
  _clipToHex(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      const x = cx + size * Math.cos(a);
      const y = cy + size * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();
  },

  _drawCircuitPlains(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    // Background
    ctx.fillStyle = '#162216';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    // PCB trace grid
    const step = size * 0.28;
    ctx.strokeStyle = '#1a6b1a';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(cx - size, cy + i * step); ctx.lineTo(cx + size, cy + i * step); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + i * step, cy - size); ctx.lineTo(cx + i * step, cy + size); ctx.stroke();
    }
    // Vias at intersections
    ctx.fillStyle = '#c8a000';
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        ctx.beginPath();
        ctx.arc(cx + i * step, cy + j * step, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Right-angle trace segments
    const seed = q * 7 + r * 13;
    ctx.strokeStyle = '#2a9b2a';
    ctx.lineWidth = 1.5;
    for (let t = 0; t < 3; t++) {
      const ax = cx + ((seed * (t + 1) * 17) % 5 - 2) * step;
      const ay = cy + ((seed * (t + 1) * 31) % 5 - 2) * step;
      const bx = cx + ((seed * (t + 1) * 43) % 5 - 2) * step;
      const by = cy + ((seed * (t + 1) * 59) % 5 - 2) * step;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  },

  _drawSiliconValley(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#2a1a3a';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    // Ground strip
    ctx.fillStyle = '#3a2a4a';
    ctx.fillRect(cx - size, cy + size * 0.45, size * 2, size * 0.55);
    // Crystal formations
    const seed = q * 7 + r * 13;
    const colors = ['#6a3a9a', '#7a4aaa', '#8a5aba', '#9a5acc'];
    for (let i = 0; i < 5; i++) {
      const off = ((seed * (i + 1) * 11) % 11 - 5) * size * 0.1;
      const h = size * (0.4 + (Math.abs(seed * (i + 1) * 7) % 5) * 0.1);
      const w = size * 0.09;
      const bx = cx + off;
      const by = cy + size * 0.45;
      const color = colors[Math.abs(seed * (i + 1)) % colors.length];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(bx, by - h);
      ctx.lineTo(bx + w, by);
      ctx.lineTo(bx - w, by);
      ctx.closePath();
      ctx.fill();
      // Highlight edge
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by - h);
      ctx.lineTo(bx + w, by);
      ctx.stroke();
    }
  },

  _drawDataSwamp(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#0a1a18';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    const seed = q * 7 + r * 13;
    // Puddle ellipses
    ctx.fillStyle = '#0d2a28';
    for (let i = 0; i < 4; i++) {
      const px = cx + ((seed * (i + 1) * 13) % 9 - 4) * size * 0.09;
      const py = cy + ((seed * (i + 1) * 17) % 9 - 4) * size * 0.09;
      const rx = size * (0.18 + (Math.abs(seed * (i + 1) * 3) % 5) * 0.04);
      const ry = rx * 0.55;
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Data bubbles
    for (let i = 0; i < 10; i++) {
      const bx = cx + ((seed * (i + 3) * 7) % 17 - 8) * size * 0.06;
      const by = cy + ((seed * (i + 3) * 11) % 17 - 8) * size * 0.06;
      ctx.beginPath();
      ctx.arc(bx, by, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,255,170,0.35)';
      ctx.fill();
    }
    // Data stream lines
    ctx.strokeStyle = '#00cc88';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    for (let i = 0; i < 3; i++) {
      const lx = cx + ((seed * (i + 1) * 23) % 7 - 3) * size * 0.13;
      ctx.beginPath();
      ctx.moveTo(lx, cy + size * 0.5);
      ctx.lineTo(lx, cy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  },

  _drawEnergyGeysers(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#1a0a00';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    const seed = q * 7 + r * 13;
    // Cracks
    ctx.strokeStyle = '#3a1a00';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (seed * (i + 1) * 37 % 360) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * size * 0.65, cy + Math.sin(a) * size * 0.65);
      ctx.stroke();
    }
    // Geyser vent — animated pulsing
    const pulse = 0.85 + 0.15 * Math.sin(Date.now() * 0.003);
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.11 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = '#ff4400';
    ctx.fill();
    // Energy bursts
    const burstColors = ['#ff8800', '#ffaa00', '#ff6600'];
    for (let i = 0; i < 4; i++) {
      const a = (seed * (i + 1) * 53 % 360) * Math.PI / 180;
      const len = size * (0.3 + (Math.abs(seed * (i + 1) * 7) % 5) * 0.07);
      ctx.strokeStyle = burstColors[i % burstColors.length];
      ctx.lineWidth = Math.max(1, 2.5 - i * 0.5);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }
  },

  _drawQuantumFields(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#0f0020';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    // Probability wave rings
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, size * 0.22 * i, size * 0.12 * i, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(204,0,255,${0.18 - i * 0.04})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Orbit paths
    const t = Date.now() * 0.0005;
    for (let i = 0; i < 2; i++) {
      const angle = i * Math.PI / 2 + 0.5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.48, size * 0.22, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(136,0,255,0.5)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      // Particle on orbit
      const pAngle = t * (i === 0 ? 1 : -1.3) + i * Math.PI;
      const px = cx + Math.cos(pAngle + angle) * size * 0.48 * Math.cos(angle) - Math.sin(pAngle + angle) * size * 0.22 * Math.sin(angle);
      const py = cy + Math.cos(pAngle + angle) * size * 0.48 * Math.sin(angle) + Math.sin(pAngle + angle) * size * 0.22 * Math.cos(angle);
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff00ff';
      ctx.fill();
    }
    this._dirty = true;
  },

  _drawMemoryMountains(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#0f0f2a';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    const seed = q * 7 + r * 13;
    const baseY = cy + size * 0.35;
    // Mountains
    const peaks = [
      { ox: -0.35, h: 0.65 }, { ox: 0, h: 0.85 }, { ox: 0.35, h: 0.6 }, { ox: -0.18, h: 0.5 },
    ];
    for (const p of peaks) {
      const px = cx + p.ox * size;
      const ph = p.h * size;
      const shade = Math.floor(0x3a + (p.h * 30));
      ctx.fillStyle = `#${shade.toString(16).padStart(2,'0')}4a6a`;
      ctx.beginPath();
      ctx.moveTo(px - size * 0.22, baseY);
      ctx.lineTo(px, baseY - ph);
      ctx.lineTo(px + size * 0.22, baseY);
      ctx.closePath();
      ctx.fill();
      // Memory stripes
      ctx.strokeStyle = '#4a5a8a';
      ctx.lineWidth = 0.7;
      for (let s = 1; s <= 4; s++) {
        const sy2 = baseY - ph * (s / 5);
        const halfW = size * 0.22 * (1 - s / 5);
        ctx.beginPath();
        ctx.moveTo(px - halfW, sy2);
        ctx.lineTo(px + halfW, sy2);
        ctx.stroke();
      }
      // Snow tip
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.moveTo(px, baseY - ph);
      ctx.lineTo(px + size * 0.04, baseY - ph * 0.88);
      ctx.lineTo(px - size * 0.04, baseY - ph * 0.88);
      ctx.closePath();
      ctx.fill();
    }
  },

  _drawThermalWastes(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#1a0500';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    const seed = q * 7 + r * 13;
    // Cracked plate cracks
    ctx.strokeStyle = '#2a0800';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const a = (seed * (i + 1) * 41 % 360) * Math.PI / 180;
      const len = size * (0.3 + (Math.abs(seed * (i + 1) * 11) % 5) * 0.08);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a + 0.3) * size * 0.1, cy + Math.sin(a + 0.3) * size * 0.1);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }
    // Heat shimmer
    for (let i = 0; i < 4; i++) {
      const hx = cx + ((seed * (i + 1) * 19) % 9 - 4) * size * 0.12;
      ctx.strokeStyle = 'rgba(255,68,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, cy + size * 0.4);
      ctx.bezierCurveTo(hx + 4, cy + size * 0.15, hx - 4, cy - size * 0.1, hx + 2, cy - size * 0.35);
      ctx.stroke();
    }
    // Embers
    ctx.fillStyle = '#ff6600';
    for (let i = 0; i < 7; i++) {
      const ex = cx + ((seed * (i + 5) * 13) % 15 - 7) * size * 0.07;
      const ey = cy + ((seed * (i + 5) * 17) % 15 - 7) * size * 0.07;
      ctx.beginPath();
      ctx.arc(ex, ey, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  _drawLogicForest(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#051505';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    const seed = q * 7 + r * 13;
    const baseY = cy + size * 0.4;
    const treePositions = [
      { ox: -0.35, h: 0.55 }, { ox: 0, h: 0.72 }, { ox: 0.35, h: 0.5 },
      { ox: -0.18, h: 0.42 }, { ox: 0.2, h: 0.38 },
    ];
    const colors = ['#1a5a1a', '#1e641e', '#2a7a2a', '#216921', '#187818'];
    for (let i = 0; i < treePositions.length; i++) {
      const p = treePositions[i];
      const tx = cx + p.ox * size;
      const ty = baseY;
      const th = p.h * size;
      const tw = size * 0.18;
      const col = colors[i % colors.length];
      // Trunk
      ctx.fillStyle = '#2a1a0a';
      ctx.fillRect(tx - size * 0.025, ty, size * 0.05, size * 0.12);
      // Canopy
      if (i % 2 === 0) {
        // Triangle
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(tx, ty - th);
        ctx.lineTo(tx + tw, ty);
        ctx.lineTo(tx - tw, ty);
        ctx.closePath();
        ctx.fill();
      } else {
        // NAND-like: flat bottom + arc top
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(tx - tw, ty);
        ctx.lineTo(tx + tw, ty);
        ctx.arc(tx, ty - th * 0.55, th * 0.6, 0.1, Math.PI - 0.1);
        ctx.closePath();
        ctx.fill();
      }
      // Via dot at base
      ctx.beginPath();
      ctx.arc(tx, ty + size * 0.12, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#c8a000';
      ctx.fill();
    }
  },

  _drawCoolingLake(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#020a18';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    // Ripple circles
    for (let i = 1; i <= 5; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.12 * i, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(26,58,106,${0.55 - i * 0.08})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Cooling fins (narrow rects from edge pointing inward)
    ctx.fillStyle = '#1a3a6a';
    const finAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    for (const a of finAngles) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.fillRect(size * 0.6, -size * 0.05, size * 0.3, size * 0.1);
      ctx.restore();
    }
    // Shimmer dots
    const seed = q * 7 + r * 13;
    ctx.fillStyle = 'rgba(200,230,255,0.45)';
    for (let i = 0; i < 8; i++) {
      const sx = cx + ((seed * (i + 1) * 13) % 11 - 5) * size * 0.07;
      const sy = cy + ((seed * (i + 1) * 17) % 11 - 5) * size * 0.07;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  _drawRareEarth(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#0a1a0a';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    const seed = q * 7 + r * 13;
    const mineralColors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44'];
    const positions = [];
    for (let i = 0; i < 15; i++) {
      positions.push({
        x: cx + ((seed * (i + 1) * 13 + i * 37) % 17 - 8) * size * 0.065,
        y: cy + ((seed * (i + 1) * 17 + i * 53) % 17 - 8) * size * 0.065,
        c: mineralColors[Math.abs(seed * (i + 1)) % mineralColors.length],
      });
    }
    // Earth line connections (subtle)
    ctx.strokeStyle = 'rgba(40,30,20,0.6)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < positions.length - 1; i += 3) {
      ctx.beginPath();
      ctx.moveTo(positions[i].x, positions[i].y);
      ctx.lineTo(positions[i + 1].x, positions[i + 1].y);
      ctx.stroke();
    }
    // Diamond crystals
    for (const p of positions) {
      const ds = size * 0.055;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - ds);
      ctx.lineTo(p.x + ds, p.y);
      ctx.lineTo(p.x, p.y + ds);
      ctx.lineTo(p.x - ds, p.y);
      ctx.closePath();
      ctx.fill();
    }
  },

  _drawAncientRuins(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = '#1a1005';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    const seed = q * 7 + r * 13;
    const baseY = cy + size * 0.4;
    // Cracked floor lines
    ctx.strokeStyle = '#3a2a10';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const fx = cx + ((seed * (i + 1) * 11) % 9 - 4) * size * 0.12;
      const fa = (seed * (i + 2) * 37 % 180) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(fx, baseY);
      ctx.lineTo(fx + Math.cos(fa) * size * 0.35, baseY + Math.sin(fa) * size * 0.25);
      ctx.stroke();
    }
    // Broken columns
    const colOffsets = [-0.33, 0, 0.33];
    for (let i = 0; i < 3; i++) {
      const colX = cx + colOffsets[i] * size;
      const colH = size * (0.35 + (Math.abs(seed * (i + 1) * 7) % 5) * 0.06);
      const colW = size * 0.1;
      const notchH = size * 0.08;
      // Column body
      ctx.fillStyle = '#5a4a2a';
      ctx.fillRect(colX - colW / 2, baseY - colH, colW, colH);
      // Break notch
      ctx.fillStyle = '#1a1005';
      ctx.fillRect(colX - colW / 2, baseY - colH * 0.55, colW, notchH);
    }
    // Partial gear outline
    const gr = size * 0.17;
    ctx.strokeStyle = '#7a6a3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + size * 0.3, cy - size * 0.05, gr, 0.3, Math.PI * 1.4);
    ctx.stroke();
    // Gear teeth stubs
    for (let i = 0; i < 5; i++) {
      const ta = 0.3 + i * (Math.PI * 1.1 / 4);
      const tx = cx + size * 0.3 + Math.cos(ta) * gr;
      const ty = cy - size * 0.05 + Math.sin(ta) * gr;
      ctx.fillStyle = '#7a6a3a';
      ctx.fillRect(tx - 2, ty - 2, 4, 4);
    }
  },

  _drawGenericTerrain(ctx, q, r, size, color) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.fillStyle = color;
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  },

  _drawVoidHex(ctx, q, r, size, timestamp) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    ctx.save();
    // Clip to hex
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      const x = cx + size * Math.cos(a);
      const y = cy + size * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();
    // Near-black background
    ctx.fillStyle = '#000005';
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    // Animated fog wisps
    for (let i = 0; i < 8; i++) {
      const wx = cx + Math.sin(timestamp * 0.001 + q + r + i * 1.3) * size * 0.35;
      const wy = cy + Math.cos(timestamp * 0.00073 + q - r + i * 0.9) * size * 0.35;
      ctx.beginPath();
      ctx.ellipse(wx, wy, size * 0.28, size * 0.14, i * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(40,40,80,0.15)';
      ctx.fill();
    }
    // Occasional electricity
    const elecPhase = (timestamp / 2000 + q * 7 + r * 13) % 1;
    if (elecPhase < 0.15) {
      // Seeded random from floor of timestamp bucket
      const seed = q * 31 + r * 37 + Math.floor(timestamp / 2000);
      ctx.strokeStyle = 'rgba(100,150,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startX = cx - size * 0.4;
      const endX = cx + size * 0.4;
      ctx.moveTo(startX, cy);
      const steps = 4;
      for (let s = 1; s <= steps; s++) {
        const fx = startX + (endX - startX) * (s / (steps + 1));
        const fy = cy + (Math.abs(Math.sin(seed * s * 7.3 + 1.2)) * 2 - 1) * size * 0.22;
        ctx.lineTo(fx, fy);
      }
      ctx.lineTo(endX, cy);
      ctx.stroke();
    }
    ctx.restore();
    this._dirty = true;
  },

  _drawFogHex(ctx, q, r, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);
    // Fill dark with hex primitive
    this.drawHex(ctx, q, r, '#0a0a14', null, 0, size);
    // Subtle noise dots for fog texture
    const seed = q * 7 + r * 13;
    ctx.fillStyle = 'rgba(30,30,50,0.3)';
    for (let i = 0; i < 6; i++) {
      const dx = ((seed * (i + 1) * 17) % 11 - 5) * size * 0.09;
      const dy = ((seed * (i + 1) * 23) % 11 - 5) * size * 0.09;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  // ---------------------------------------------------------------------------
  // drawTerritoryBorders
  // ---------------------------------------------------------------------------

  /**
   * Draw thick borders on hex edges that separate different-owned tiles.
   * Only draws edges where ownership changes or a tile is unowned.
   */
  drawTerritoryBorders(ctx, gameState, size) {
    const mapTiles = gameState.mapTiles || gameState.map;
    const { civs, playerCivId } = gameState;
    if (!mapTiles) return;

    // Six edge directions for flat-top hex (same order as HEX_DIRECTIONS in mapgen.js)
    const dirs = [
      { q: 1, r: 0 },  { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
    ];
    // Corresponding edge vertex pairs (flat-top hexagon corners indexed 0-5 at 0°,60°,...300°)
    const edgeCorners = [
      [0, 5], [5, 4], [4, 3], [3, 2], [2, 1], [1, 0],
    ];

    for (const [, tile] of mapTiles) {
      if (!tile.owner) continue;
      const isExplored = this._isTileExplored(tile, playerCivId);
      if (!isExplored) continue;

      const civ = civs && civs[tile.owner];
      if (!civ) continue;
      const borderColor = civ.color || '#ffffff';

      const cx = this._hexScreenX(tile.q, tile.r, size);
      const cy = this._hexScreenY(tile.q, tile.r, size);

      // Precompute the 6 corner positions of this hex
      const corners = [];
      for (let i = 0; i < 6; i++) {
        const angleRad = (Math.PI / 180) * (60 * i);
        corners.push({
          x: cx + size * Math.cos(angleRad),
          y: cy + size * Math.sin(angleRad),
        });
      }

      const isPlayerCiv = (tile.owner === playerCivId);

      for (let d = 0; d < 6; d++) {
        const dir   = dirs[d];
        const nbKey = `${tile.q + dir.q},${tile.r + dir.r}`;
        const nbTile = mapTiles.get(nbKey);
        const nbOwner = nbTile ? nbTile.owner : null;

        const [ci, cj] = edgeCorners[d];

        if (isPlayerCiv) {
          // Player territory: draw on all outer edges (any neighbor not owned by player)
          if (nbOwner !== tile.owner) {
            ctx.beginPath();
            ctx.moveTo(corners[ci].x, corners[ci].y);
            ctx.lineTo(corners[cj].x, corners[cj].y);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth   = 3.5 * this.mapZoom;
            ctx.globalAlpha = 1.0;
            ctx.stroke();

            // Glow pass: wider line at low alpha
            ctx.beginPath();
            ctx.moveTo(corners[ci].x, corners[ci].y);
            ctx.lineTo(corners[cj].x, corners[cj].y);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth   = 6 * this.mapZoom;
            ctx.globalAlpha = 0.15;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          }
        } else {
          // Enemy territory: only draw on edges facing unowned (null) tiles
          if (nbOwner === null || nbOwner === undefined) {
            ctx.beginPath();
            ctx.moveTo(corners[ci].x, corners[ci].y);
            ctx.lineTo(corners[cj].x, corners[cj].y);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth   = 1.5 * this.mapZoom;
            ctx.globalAlpha = 0.6;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          }
        }
      }
    }
  },

  // ---------------------------------------------------------------------------
  // drawBuilding
  // ---------------------------------------------------------------------------

  /**
   * Draw a building canvas illustration at a tile center.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} centerX
   * @param {number} centerY
   * @param {string} buildingId
   * @param {number} scale  - mapZoom
   */
  drawBuilding(ctx, centerX, centerY, buildingId, scale) {
    const s = Math.max(0.4, scale) * this.hexSize * 0.28; // icon size
    ctx.save();
    ctx.translate(centerX, centerY);

    switch(buildingId) {
      case 'research_node':    this._drawBldResearchNode(ctx, s); break;
      case 'data_farm':        this._drawBldDataFarm(ctx, s); break;
      case 'silicon_extractor': this._drawBldSiliconExtractor(ctx, s); break;
      case 'power_plant':      this._drawBldPowerPlant(ctx, s); break;
      case 'copper_mine':      this._drawBldCopperMine(ctx, s); break;
      case 'defense_array':    this._drawBldDefenseArray(ctx, s); break;
      case 'military_forge':   this._drawBldMilitaryForge(ctx, s); break;
      case 'advanced_lab':     this._drawBldAdvancedLab(ctx, s); break;
      case 'quantum_lab':      this._drawBldQuantumLab(ctx, s); break;
      case 'neural_cluster':   this._drawBldNeuralCluster(ctx, s); break;
      case 'idea_accelerator': this._drawBldIdeaAccelerator(ctx, s); break;
      default: this._drawBldGeneric(ctx, s, buildingId); break;
    }
    ctx.restore();
  },

  _drawBldResearchNode(ctx, s) {
    // Magnifying glass: circle + handle
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.beginPath();
    ctx.arc(-s * 0.1, -s * 0.1, s * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    // Handle
    ctx.fillStyle = '#00ccff';
    ctx.fillRect(s * 0.28, s * 0.28, s * 0.35, s * 0.15);
    // Circuit traces inside lens
    ctx.strokeStyle = 'rgba(0,200,255,0.6)';
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.1 + i * s * 0.22);
      ctx.lineTo(s * 0.22, -s * 0.1 + i * s * 0.22);
      ctx.stroke();
    }
  },

  _drawBldDataFarm(ctx, s) {
    // Server racks
    const rackW = s * 1.2, rackH = s * 0.25;
    for (let i = 0; i < 3; i++) {
      const ry = -s * 0.55 + i * (rackH + s * 0.06);
      ctx.fillStyle = '#2a4a2a';
      ctx.fillRect(-rackW / 2, ry, rackW, rackH);
      ctx.strokeStyle = '#3a6a3a';
      ctx.lineWidth = 1;
      ctx.strokeRect(-rackW / 2, ry, rackW, rackH);
      // LEDs
      const ledColors = ['#00ff88', '#ff8800'];
      for (let j = 0; j < 4; j++) {
        ctx.beginPath();
        ctx.arc(-rackW * 0.35 + j * rackW * 0.22, ry + rackH * 0.5, s * 0.06, 0, Math.PI * 2);
        ctx.fillStyle = ledColors[j % 2];
        ctx.fill();
      }
    }
    // Cable
    ctx.strokeStyle = '#1a3a1a';
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(s * 0.2, s * 0.55, -s * 0.1, s * 0.65, s * 0.05, s * 0.75);
    ctx.stroke();
  },

  _drawBldSiliconExtractor(ctx, s) {
    // Drill bit (triangle pointing down)
    ctx.fillStyle = '#8844aa';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.5);
    ctx.lineTo(-s * 0.45, -s * 0.3);
    ctx.lineTo(s * 0.45, -s * 0.3);
    ctx.closePath();
    ctx.fill();
    // Hash marks on drill
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const ty = -s * 0.3 + i * s * 0.2;
      const hw = s * 0.45 * (1 - i * 0.25);
      ctx.beginPath(); ctx.moveTo(-hw, ty); ctx.lineTo(hw, ty); ctx.stroke();
    }
    // Diamond crystal below
    const ds = s * 0.18;
    ctx.fillStyle = '#cc88ff';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.65);
    ctx.lineTo(ds, s * 0.78);
    ctx.lineTo(0, s * 0.9);
    ctx.lineTo(-ds, s * 0.78);
    ctx.closePath();
    ctx.fill();
  },

  _drawBldPowerPlant(ctx, s) {
    // Rounded container
    ctx.fillStyle = '#2a1800';
    ctx.beginPath();
    ctx.roundRect(-s * 0.75, -s * 0.75, s * 1.5, s * 1.5, s * 0.15);
    ctx.fill();
    // Lightning bolt
    ctx.fillStyle = '#ff8800';
    ctx.beginPath();
    ctx.moveTo(s * 0.1, -s * 0.65);
    ctx.lineTo(-s * 0.28, s * 0.05);
    ctx.lineTo(s * 0.05, s * 0.05);
    ctx.lineTo(-s * 0.1, s * 0.65);
    ctx.lineTo(s * 0.28, -s * 0.05);
    ctx.lineTo(s * 0.0, -s * 0.05);
    ctx.closePath();
    ctx.fill();
    // Radiating lines
    ctx.strokeStyle = 'rgba(255,180,0,0.5)';
    ctx.lineWidth = 1;
    const radAngles = [Math.PI * 0.1, Math.PI * 0.4, Math.PI * 0.6, Math.PI * 0.9];
    for (const a of radAngles) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5);
      ctx.lineTo(Math.cos(a) * s * 0.8, Math.sin(a) * s * 0.8);
      ctx.stroke();
    }
  },

  _drawBldCopperMine(ctx, s) {
    // Circular mine shaft
    ctx.strokeStyle = '#cc5500';
    ctx.lineWidth = Math.max(1.5, s * 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    // Cross lines
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath(); ctx.moveTo(-s * 0.55, 0); ctx.lineTo(s * 0.55, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -s * 0.55); ctx.lineTo(0, s * 0.55); ctx.stroke();
    // Nuggets
    const nuggetPos = [[-0.7, -0.5], [0.72, -0.4], [-0.6, 0.6], [0.65, 0.55]];
    ctx.fillStyle = '#cc5500';
    for (const [nx, ny] of nuggetPos) {
      ctx.beginPath();
      ctx.arc(nx * s, ny * s, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  _drawBldDefenseArray(ctx, s) {
    // Shield pentagon
    ctx.fillStyle = '#1a2a4a';
    ctx.strokeStyle = '#4488ff';
    ctx.lineWidth = Math.max(1.5, s * 0.1);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.85);
    ctx.lineTo(s * 0.75, -s * 0.3);
    ctx.lineTo(s * 0.6, s * 0.65);
    ctx.lineTo(-s * 0.6, s * 0.65);
    ctx.lineTo(-s * 0.75, -s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Cross on shield
    ctx.strokeStyle = '#4488ff';
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.lineTo(0, s * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.5, s * 0.05); ctx.lineTo(s * 0.5, s * 0.05); ctx.stroke();
  },

  _drawBldMilitaryForge(ctx, s) {
    // Anvil: wide rect on narrow rect
    ctx.fillStyle = '#884444';
    ctx.fillRect(-s * 0.6, -s * 0.2, s * 1.2, s * 0.55); // top
    ctx.fillRect(-s * 0.28, s * 0.35, s * 0.56, s * 0.35); // base
    ctx.strokeStyle = '#aa6666';
    ctx.lineWidth = 1;
    ctx.strokeRect(-s * 0.6, -s * 0.2, s * 1.2, s * 0.55);
    // Flame lines above
    const flameColors = ['#ff4400', '#ff6600', '#ff8800'];
    ctx.lineWidth = Math.max(1, s * 0.07);
    for (let i = 0; i < 3; i++) {
      const fx = (i - 1) * s * 0.28;
      ctx.strokeStyle = flameColors[i];
      ctx.beginPath();
      ctx.moveTo(fx, -s * 0.25);
      ctx.bezierCurveTo(fx + s * 0.08, -s * 0.48, fx - s * 0.08, -s * 0.6, fx, -s * 0.78);
      ctx.stroke();
    }
  },

  _drawBldAdvancedLab(ctx, s) {
    // Erlenmeyer flask: neck + trapezoid body
    ctx.fillStyle = 'rgba(40,120,120,0.3)';
    ctx.strokeStyle = '#44aaaa';
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath();
    ctx.moveTo(-s * 0.12, -s * 0.8); // neck left
    ctx.lineTo(-s * 0.12, -s * 0.25); // neck -> body
    ctx.lineTo(-s * 0.62, s * 0.7);
    ctx.lineTo(s * 0.62, s * 0.7);
    ctx.lineTo(s * 0.12, -s * 0.25);
    ctx.lineTo(s * 0.12, -s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Opening at top
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, -s * 0.8);
    ctx.lineTo(s * 0.18, -s * 0.8);
    ctx.stroke();
    // Circuit traces going into flask
    ctx.strokeStyle = 'rgba(0,200,200,0.6)';
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.22, s * 0.2);
      ctx.lineTo(i * s * 0.35, s * 0.5);
      ctx.stroke();
    }
  },

  _drawBldQuantumLab(ctx, s) {
    // Center circle
    ctx.fillStyle = '#ff00ff';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    // Two elliptical orbits
    const orbitAngles = [Math.PI / 6, Math.PI * 5 / 6];
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = Math.max(1, s * 0.07);
    for (const a of orbitAngles) {
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.78, s * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Electron dots
    const ePositions = [[s * 0.78, 0], [-s * 0.39, s * 0.24]];
    ctx.fillStyle = '#ffffff';
    for (const [ex, ey] of ePositions) {
      ctx.beginPath();
      ctx.arc(ex, ey, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  _drawBldNeuralCluster(ctx, s) {
    // 3 layer neural network: 2 input, 2 hidden, 1 output
    const layers = [
      [{ x: -s * 0.7, y: -s * 0.28 }, { x: -s * 0.7, y: s * 0.28 }],
      [{ x: 0, y: -s * 0.28 }, { x: 0, y: s * 0.28 }],
      [{ x: s * 0.7, y: 0 }],
    ];
    // Connections
    ctx.strokeStyle = 'rgba(0,170,255,0.45)';
    ctx.lineWidth = 1;
    for (let li = 0; li < layers.length - 1; li++) {
      for (const a of layers[li]) {
        for (const b of layers[li + 1]) {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    // Nodes
    ctx.fillStyle = '#00aaff';
    for (const layer of layers) {
      for (const n of layer) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, s * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  _drawBldIdeaAccelerator(ctx, s) {
    // Lightbulb: circle top + rectangle base
    ctx.fillStyle = 'rgba(255,255,0,0.2)';
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath();
    ctx.arc(0, -s * 0.28, s * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Base rectangle
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(-s * 0.24, s * 0.24, s * 0.48, s * 0.32);
    // Filament lines inside bulb
    ctx.strokeStyle = '#ffdd00';
    ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, s * 0.05); ctx.lineTo(0, -s * 0.15); ctx.lineTo(s * 0.18, s * 0.05);
    ctx.stroke();
    // Radiating lines
    ctx.strokeStyle = 'rgba(255,255,0,0.5)';
    ctx.lineWidth = 1;
    const angles = [Math.PI * 0.05, Math.PI * 0.25, Math.PI * 0.75, Math.PI * 0.95,
                    -Math.PI * 0.15, -Math.PI * 0.5];
    for (const a of angles) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.6, -s * 0.28 + Math.sin(a) * s * 0.6);
      ctx.lineTo(Math.cos(a) * s * 0.85, -s * 0.28 + Math.sin(a) * s * 0.85);
      ctx.stroke();
    }
  },

  _drawBldGeneric(ctx, s, buildingId) {
    // Rounded rectangle
    ctx.fillStyle = '#666688';
    ctx.strokeStyle = '#8888aa';
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath();
    ctx.roundRect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4, s * 0.18);
    ctx.fill();
    ctx.stroke();
    // First 2 letters
    const label = (buildingId || '??').slice(0, 2).toUpperCase();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(6, Math.round(s * 0.75))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
  },

  // ---------------------------------------------------------------------------
  // drawUnit
  // ---------------------------------------------------------------------------

  /**
   * Draw a unit canvas illustration with health bar.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} centerX
   * @param {number} centerY
   * @param {Object} unit        - unit object { type, hp, maxHp, civId, ... }
   * @param {string} civColor
   * @param {number} hexSizePx   - effective hex size in pixels
   * @param {number} totalUnits  - total units on this tile (for count badge)
   */
  drawUnit(ctx, centerX, centerY, unit, civColor, hexSizePx, totalUnits) {
    if (!unit) return;

    const r = Math.max(6, hexSizePx * 0.22);
    ctx.save();
    ctx.translate(centerX, centerY);

    switch(unit.type) {
      case 'scout':          this._drawUnitScout(ctx, r, civColor); break;
      case 'warrior':        this._drawUnitWarrior(ctx, r, civColor); break;
      case 'siege':          this._drawUnitSiege(ctx, r, civColor); break;
      case 'cyber_warrior':  this._drawUnitCyberWarrior(ctx, r, civColor); break;
      case 'quantum_agent':  this._drawUnitQuantumAgent(ctx, r, civColor); break;
      default: this._drawUnitGeneric(ctx, r, civColor); break;
    }

    ctx.restore();

    // Health bar below unit
    const hp = unit.hp ?? 10, maxHp = unit.maxHp ?? 10;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    const bw = r * 2.2, bh = Math.max(3, r * 0.22);
    const bx = centerX - bw/2, by = centerY + r + 3;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = ratio > 0.6 ? '#00cc44' : ratio > 0.3 ? '#ccaa00' : '#cc2200';
    ctx.fillRect(bx, by, bw * ratio, bh);
  },

  _drawUnitScout(ctx, r, color) {
    // Isoceles triangle pointing right (drone)
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(r * 0.75, 0);
    ctx.lineTo(-r * 0.55, -r * 0.55);
    ctx.lineTo(-r * 0.55, r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Wing lines
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-r * 0.15, -r * 0.22); ctx.lineTo(-r * 0.55, -r * 0.75); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r * 0.15, r * 0.22);  ctx.lineTo(-r * 0.55, r * 0.75);  ctx.stroke();
  },

  _drawUnitWarrior(ctx, r, color) {
    // Hexagonal shield
    ctx.fillStyle = color;
    ctx.strokeStyle = this._shiftColor(color, -0.25) || '#333333';
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      const x = r * 0.82 * Math.cos(a);
      const y = r * 0.82 * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Crossed diagonal lines
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.45); ctx.lineTo(r * 0.45, r * 0.45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r * 0.45, -r * 0.45);  ctx.lineTo(-r * 0.45, r * 0.45); ctx.stroke();
  },

  _drawUnitSiege(ctx, r, color) {
    // Tank body
    ctx.fillStyle = color;
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.fillRect(-r * 0.72, -r * 0.38, r * 1.44, r * 0.7);
    ctx.strokeRect(-r * 0.72, -r * 0.38, r * 1.44, r * 0.7);
    // Barrel
    ctx.fillStyle = this._shiftColor(color, -0.15) || color;
    ctx.fillRect(r * 0.45, -r * 0.1, r * 0.65, r * 0.2);
    // Wheels
    ctx.fillStyle = '#333333';
    for (const wx of [-r * 0.42, r * 0.12]) {
      ctx.beginPath();
      ctx.arc(wx, r * 0.38, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  _drawUnitCyberWarrior(ctx, r, color) {
    // Diamond shape
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00ffff';
    ctx.fillStyle = color;
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.85);
    ctx.lineTo(r * 0.85, 0);
    ctx.lineTo(0, r * 0.85);
    ctx.lineTo(-r * 0.85, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Circuit lines through center
    ctx.strokeStyle = 'rgba(0,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-r * 0.5, 0); ctx.lineTo(r * 0.5, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r * 0.5); ctx.lineTo(0, r * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r * 0.25, -r * 0.25); ctx.lineTo(r * 0.25, r * 0.25); ctx.stroke();
  },

  _drawUnitQuantumAgent(ctx, r, color) {
    // Probability wave rings
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff00ff';
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.5 + i * 0.28), 0, Math.PI * 1.5);
      ctx.strokeStyle = `rgba(255,0,255,${0.35 - i * 0.1})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Center filled circle
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.stroke();
    ctx.shadowBlur = 0;
  },

  _drawUnitGeneric(ctx, r, color) {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.stroke();
  },

  // ---------------------------------------------------------------------------
  // drawCapitalMarker
  // ---------------------------------------------------------------------------

  /**
   * Draw a star marker for a civilization's capital city.
   */
  drawCapitalMarker(ctx, centerX, centerY, civColor, hexSizePx) {
    const outerR = Math.max(7, hexSizePx * 0.28);
    const innerR = outerR * 0.42;
    const points = 5;

    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle  = (i * Math.PI / points) - Math.PI / 2;
      const radius = i % 2 === 0 ? outerR : innerR;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.fillStyle   = civColor;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Small crown label below
    if (hexSizePx >= 20) {
      ctx.font         = `${Math.max(8, Math.round(hexSizePx * 0.22))}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle    = '#ffffff';
      ctx.shadowColor  = '#000000';
      ctx.shadowBlur   = 3;
      ctx.fillText('★', centerX, centerY + outerR + 2);
      ctx.shadowBlur   = 0;
    }
  },

  // ---------------------------------------------------------------------------
  // Coordinate helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert screen (canvas) coordinates to world coordinates.
   */
  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.mapOffsetX) / this.mapZoom,
      y: (screenY - this.mapOffsetY) / this.mapZoom,
    };
  },

  /**
   * Return the axial {q, r} of the hex at the given canvas position.
   */
  getHexAtScreen(screenX, screenY) {
    // We need to pass offsetX/offsetY and size to pixelToHex.
    // pixelToHex(px, py, size, offsetX, offsetY) from mapgen.js
    const size = this.hexSize * this.mapZoom;
    return pixelToHex(screenX, screenY, size, this.mapOffsetX, this.mapOffsetY);
  },

  /**
   * Pan the map by (dx, dy) pixels.
   */
  pan(dx, dy) {
    this.mapOffsetX += dx;
    this.mapOffsetY += dy;
    this._dirty = true;
  },

  /**
   * Zoom centered on a canvas point (centerX, centerY).
   * factor > 1 zooms in, factor < 1 zooms out.
   */
  zoom(factor, centerX, centerY) {
    const newZoom = Math.max(0.4, Math.min(2.5, this.mapZoom * factor));
    this.mapOffsetX = centerX - (centerX - this.mapOffsetX) * (newZoom / this.mapZoom);
    this.mapOffsetY = centerY - (centerY - this.mapOffsetY) * (newZoom / this.mapZoom);
    this.mapZoom    = newZoom;
    this._dirty     = true;
  },

  /**
   * Pan the map so a given hex is centered in the canvas.
   */
  centerOnHex(q, r) {
    if (!this.mapCanvas) return;
    const size = this.hexSize * this.mapZoom;
    // hexToPixel gives position relative to offset; we want center of canvas
    // Solve: cx + mapOffsetX = canvasW/2  => mapOffsetX = canvasW/2 - cx_world*zoom
    const worldX = this.hexSize * (1.5 * q);
    const worldY = this.hexSize * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
    this.mapOffsetX = this.mapCanvas.width  / 2 - worldX * this.mapZoom;
    this.mapOffsetY = this.mapCanvas.height / 2 - worldY * this.mapZoom;
    this._dirty = true;
  },

  // ---------------------------------------------------------------------------
  // setupMapEvents
  // ---------------------------------------------------------------------------

  /**
   * Attach mouse and touch event listeners to the map canvas.
   * @param {Function} onHexClick  - called with { q, r, tile }
   * @param {Function} onHexHover  - called with { q, r, tile } or null on leave
   */
  setupMapEvents(onHexClick, onHexHover) {
    const canvas = this.mapCanvas;
    if (!canvas) return;

    const self = this;

    // Mouse down — start drag or prepare click
    canvas.addEventListener('mousedown', (e) => {
      self.isDragging  = false;
      self._dragMoved  = false;
      self._mouseDown  = true;
      self.dragStart   = { x: e.clientX, y: e.clientY };
    });

    // Mouse move — pan or hover
    canvas.addEventListener('mousemove', (e) => {
      const rect   = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (self._mouseDown) {
        const dx = e.clientX - self.dragStart.x;
        const dy = e.clientY - self.dragStart.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          self.isDragging = true;
          self._dragMoved = true;
          self.pan(dx, dy);
          self.dragStart = { x: e.clientX, y: e.clientY };
        }
      }

      // Hover detection
      const hex = self.getHexAtScreen(mouseX, mouseY);
      const changed = !self.hoveredHex ||
        self.hoveredHex.q !== hex.q || self.hoveredHex.r !== hex.r;
      if (changed) {
        self.hoveredHex = hex;
        self._dirty = true;
        if (onHexHover) {
          onHexHover(hex);
        }
        self._updateMapTooltip(e.clientX, e.clientY, hex);
      }
    });

    // Mouse up — end drag, fire click if not dragged
    canvas.addEventListener('mouseup', (e) => {
      self._mouseDown = false;
      if (!self._dragMoved) {
        const rect   = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const hex    = self.getHexAtScreen(mouseX, mouseY);
        self.selectedHex = hex;
        self._dirty = true;
        if (onHexClick) {
          onHexClick(hex);
        }
      }
      self.isDragging = false;
      self._dragMoved = false;
    });

    // Mouse leave — clear hover
    canvas.addEventListener('mouseleave', () => {
      self._mouseDown = false;
      self.isDragging = false;
      self.hoveredHex = null;
      self._dirty = true;
      self._hideMapTooltip();
      if (onHexHover) onHexHover(null);
    });

    // Wheel — zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect    = canvas.getBoundingClientRect();
      const mouseX  = e.clientX - rect.left;
      const mouseY  = e.clientY - rect.top;
      const factor  = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      self.zoom(factor, mouseX, mouseY);
    }, { passive: false });

    // Touch support — basic single-touch pan + double-tap zoom
    let lastTouchX = 0, lastTouchY = 0;
    let lastTapTime = 0;

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
        const now = Date.now();
        if (now - lastTapTime < 300) {
          // double-tap: zoom in at touch point
          const rect  = canvas.getBoundingClientRect();
          const tx    = e.touches[0].clientX - rect.left;
          const ty    = e.touches[0].clientY - rect.top;
          self.zoom(1.4, tx, ty);
        }
        lastTapTime = now;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastTouchX;
        const dy = e.touches[0].clientY - lastTouchY;
        self.pan(dx, dy);
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
      }
    }, { passive: false });
  },

  // ==========================================================================
  // CONCEPT SPACE RENDERING
  // ==========================================================================

  /**
   * Full render pass for the concept space canvas.
   * @param {Object} ideaSpaceState   - { nodes, connections, discoveredSet, … }
   * @param {Object} playerBranchProficiency - branch -> proficiency level
   */
  renderConceptSpace(ideaSpaceState, playerBranchProficiency) {
    const ctx    = this.csCtx;
    const canvas = this.csCanvas;
    if (!ctx || !canvas) return;

    // Auto-fit to discovered concepts if flagged
    if (this._needsFit) {
      this.fitToDiscovered(ideaSpaceState?.discoveredSet);
      this._needsFit = false;
    }

    const W = canvas.width;
    const H = canvas.height;

    // --- Background -----------------------------------------------------------
    ctx.fillStyle = '#030308';
    ctx.fillRect(0, 0, W, H);

    // Star field
    this._drawStars(ctx);

    if (!ideaSpaceState) return;

    const { nodes, connections, discoveredSet } = ideaSpaceState;
    const discovered = discoveredSet instanceof Set ? discoveredSet :
      new Set(Array.isArray(discoveredSet) ? discoveredSet : []);

    // --- Cluster nebulae (drawn behind everything) ----------------------------
    this._drawAllClusterNebulae(ctx, nodes, discovered);

    // --- Axes and region labels -----------------------------------------------
    this._drawConceptSpaceAxes(ctx);
    this._drawConceptSpaceRegionLabels(ctx, nodes);

    // --- Connection lines ----------------------------------------------------
    if (connections && connections.length > 0) {
      this.drawConceptConnections(ctx, connections, discovered);
    }

    // --- Concept nodes -------------------------------------------------------
    if (nodes) {
      for (const node of Object.values(nodes)) {
        const isDiscovered = discovered.has(node.id);
        const isSelected   = this.selectedConcepts.includes(node.id);
        const isHovered    = this.hoveredConcept === node.id;
        const mixSlots     = this.selectedConcepts;
        this.drawConceptNode(ctx, node, isDiscovered, isSelected, isHovered, mixSlots);
      }
    }

    // --- Labels (on top of nodes) --------------------------------------------
    if (nodes && (this.csZoom > 0.7 || true)) {  // always show at least hovered
      for (const node of Object.values(nodes)) {
        const isDiscovered = discovered.has(node.id);
        const isHovered    = this.hoveredConcept === node.id;
        const isSelected   = this.selectedConcepts.includes(node.id);
        if (isDiscovered && (this.csZoom > 0.8 || isHovered || isSelected)) {
          this.drawConceptLabel(ctx, node, isDiscovered);
        } else if (!isDiscovered && (isHovered || isSelected)) {
          this.drawConceptLabel(ctx, node, false);
        }
      }
    }

    // --- Discovery animations ------------------------------------------------
    const now = performance.now();
    this._discoveryAnims = this._discoveryAnims.filter(anim => {
      const t = (now - anim.startTime) / anim.duration;
      if (t >= 1) {
        if (anim.onComplete) anim.onComplete();
        return false;
      }
      if (nodes && nodes[anim.conceptId]) {
        this._renderDiscoveryFrame(ctx, nodes[anim.conceptId], t);
      }
      return true;
    });
  },

  // ---------------------------------------------------------------------------
  // drawClusterNebula
  // ---------------------------------------------------------------------------

  /**
   * Draw a soft radial gradient "fog" around a cluster's centroid.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<Object>} clusterNodes  - nodes belonging to this cluster
   * @param {string} color               - cluster color
   */
  drawClusterNebula(ctx, clusterNodes, color) {
    if (!clusterNodes || clusterNodes.length === 0) return;

    // Compute centroid of discovered-or-all nodes
    let sumX = 0, sumY = 0;
    for (const n of clusterNodes) {
      const { sx, sy } = this._csNodeScreenPos(n);
      sumX += sx;
      sumY += sy;
    }
    const cx = sumX / clusterNodes.length;
    const cy = sumY / clusterNodes.length;

    // Radius covers the spread of all nodes in cluster
    let maxDist = 40;
    for (const n of clusterNodes) {
      const { sx, sy } = this._csNodeScreenPos(n);
      const d = Math.hypot(sx - cx, sy - cy);
      if (d > maxDist) maxDist = d;
    }
    const nebulaR = maxDist * 1.5;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, nebulaR);
    const rgb  = this._hexColorToRgb(color);
    if (rgb) {
      grad.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.13)`);
      grad.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.06)`);
      grad.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.00)`);
    } else {
      grad.addColorStop(0,   'rgba(100,100,150,0.10)');
      grad.addColorStop(1,   'rgba(100,100,150,0.00)');
    }

    ctx.beginPath();
    ctx.arc(cx, cy, nebulaR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  },

  // ---------------------------------------------------------------------------
  // drawConceptNode
  // ---------------------------------------------------------------------------

  /**
   * Draw a single concept node.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} node           - { id, name, canvasX, canvasY, cluster, tier }
   * @param {boolean} isDiscovered
   * @param {boolean} isSelected    - in mix slots
   * @param {boolean} isHovered
   * @param {Array<string>} mixSlots - currently selected concept ids
   */
  drawConceptNode(ctx, node, isDiscovered, isSelected, isHovered, mixSlots) {
    if (!node) return;

    const { sx, sy } = this._csNodeScreenPos(node);

    const tier    = node.tier || 1;
    const radius  = Math.max(4, tier * 1.5 + 3) * this.csZoom * (isHovered ? 1.25 : 1.0);

    const clusterMeta  = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[node.cluster] : null;
    const clusterColor = clusterMeta ? clusterMeta.color : '#888888';

    if (!isDiscovered) {
      // Tiny dim grey dot — no label
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(80,80,100,0.4)';
      ctx.fill();
      return;
    }

    // Simple circle with glow
    ctx.shadowBlur  = 10;
    ctx.shadowColor = clusterColor;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = clusterColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Selected: bright gold ring around node
    if (isSelected) {
      const slotIndex = mixSlots.indexOf(node.id);
      const goldColor = slotIndex === 0 ? '#FFD700' : '#FFA500';
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 4 * this.csZoom, 0, Math.PI * 2);
      ctx.strokeStyle = goldColor;
      ctx.lineWidth   = 2.5;
      ctx.stroke();
    }
  },

  // ---------------------------------------------------------------------------
  // drawConceptConnections
  // ---------------------------------------------------------------------------

  /**
   * Draw bezier curves connecting combinable concepts.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<Object>} connections  - [{ from, to }]
   * @param {Set<string>} discoveredSet
   */
  drawConceptConnections(ctx, connections, discoveredSet) {
    for (const conn of connections) {
      const fromId = conn.fromId !== undefined ? conn.fromId : conn.from;
      const toId   = conn.toId   !== undefined ? conn.toId   : conn.to;
      const nodeA = this._getConceptNode(fromId);
      const nodeB = this._getConceptNode(toId);
      if (!nodeA || !nodeB) continue;

      const aDisc = discoveredSet.has(fromId);
      const bDisc = discoveredSet.has(toId);

      if (!aDisc && !bDisc) continue;  // completely invisible

      const { sx: ax, sy: ay } = this._csNodeScreenPos(nodeA);
      const { sx: bx, sy: by } = this._csNodeScreenPos(nodeB);

      const clusterMeta = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[nodeA.cluster] : null;
      const lineColor   = clusterMeta ? clusterMeta.color : '#555577';

      ctx.lineWidth = 1; // always 1px regardless of zoom — thin, web-like

      if (aDisc && bDisc) {
        // Both discovered: straight solid line
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = lineColor + '66'; // alpha 0.4
        ctx.setLineDash([]);
        ctx.stroke();
      } else {
        // One discovered: dashed hint line
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = lineColor + '1f'; // alpha 0.12
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.setLineDash([]);
  },

  // ---------------------------------------------------------------------------
  // drawConceptLabel
  // ---------------------------------------------------------------------------

  /**
   * Draw the name label for a concept node.
   */
  drawConceptLabel(ctx, node, isDiscovered) {
    if (!node) return;

    const { sx, sy } = this._csNodeScreenPos(node);
    const tier        = node.tier || 1;
    const radius      = (tier * 2 + 4) * this.csZoom;

    const label    = isDiscovered ? node.name : '???';
    const fontSize = Math.max(8, Math.round(10 * this.csZoom));
    ctx.font         = `${fontSize}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';

    const clusterMeta  = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[node.cluster] : null;
    const clusterColor = clusterMeta ? clusterMeta.color : '#aaaaaa';

    ctx.fillStyle    = isDiscovered ? 'rgba(255,255,255,0.85)' : 'rgba(150,150,170,0.6)';
    ctx.shadowColor  = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur   = 4;
    ctx.fillText(label, sx, sy + radius + 3);
    ctx.shadowBlur   = 0;
  },

  // ---------------------------------------------------------------------------
  // getConceptAtPosition
  // ---------------------------------------------------------------------------

  /**
   * Return the concept id of the closest concept within 20px of (canvasX, canvasY).
   * @returns {string|null}
   */
  getConceptAtPosition(canvasX, canvasY) {
    if (typeof CONCEPTS === 'undefined') return null;

    let closest     = null;
    let closestDist = 20 / this.csZoom;  // 20px threshold in screen coords

    for (const node of Object.values(CONCEPTS)) {
      const { sx, sy } = this._csNodeScreenPos(node);
      const dist = Math.hypot(canvasX - sx, canvasY - sy);
      if (dist < closestDist) {
        closestDist = dist;
        closest     = node.id;
      }
    }
    return closest;
  },

  // ---------------------------------------------------------------------------
  // setupConceptSpaceEvents
  // ---------------------------------------------------------------------------

  /**
   * Attach mouse events to the concept space canvas.
   * @param {Function} onConceptClick  - called with conceptId or null
   * @param {Function} onConceptHover  - called with conceptId or null
   */
  setupConceptSpaceEvents(onConceptClick, onConceptHover) {
    const canvas = this.csCanvas;
    if (!canvas) return;

    const self = this;
    let mouseDown = false, dragMoved = false;
    let lastX = 0, lastY = 0;

    canvas.addEventListener('mousedown', (e) => {
      mouseDown = true;
      dragMoved = false;
      lastX     = e.clientX;
      lastY     = e.clientY;
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect  = canvas.getBoundingClientRect();
      const cx    = e.clientX - rect.left;
      const cy    = e.clientY - rect.top;

      if (mouseDown) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          dragMoved = true;
          self.csOffsetX += dx;
          self.csOffsetY += dy;
          lastX = e.clientX;
          lastY = e.clientY;
          self._dirty = true;
        }
      }

      const conceptId = self.getConceptAtPosition(cx, cy);
      if (conceptId !== self.hoveredConcept) {
        self.hoveredConcept = conceptId;
        self._dirty = true;
        if (onConceptHover) onConceptHover(conceptId);
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      mouseDown = false;
      if (!dragMoved) {
        const rect      = canvas.getBoundingClientRect();
        const cx        = e.clientX - rect.left;
        const cy        = e.clientY - rect.top;
        const conceptId = self.getConceptAtPosition(cx, cy);
        if (conceptId) {
          // Toggle in selectedConcepts (max 2)
          const idx = self.selectedConcepts.indexOf(conceptId);
          if (idx !== -1) {
            self.selectedConcepts.splice(idx, 1);
          } else {
            self.selectedConcepts.push(conceptId);
            if (self.selectedConcepts.length > 2) {
              self.selectedConcepts.shift();
            }
          }
          self._dirty = true;
        }
        if (onConceptClick) onConceptClick(conceptId);
      }
      dragMoved = false;
    });

    canvas.addEventListener('mouseleave', () => {
      mouseDown = false;
      self.hoveredConcept = null;
      self._dirty = true;
      if (onConceptHover) onConceptHover(null);
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect   = canvas.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.04 : 1 / 1.04;
      const newZ   = Math.max(0.5, Math.min(2.0, self.csZoom * factor));
      self.csOffsetX = mx - (mx - self.csOffsetX) * (newZ / self.csZoom);
      self.csOffsetY = my - (my - self.csOffsetY) * (newZ / self.csZoom);
      self.csZoom    = newZ;
      self._dirty    = true;
    }, { passive: false });
  },

  // ---------------------------------------------------------------------------
  // animateDiscovery
  // ---------------------------------------------------------------------------

  /**
   * Trigger a burst + expanding-ring animation when a new concept is discovered.
   * @param {string} conceptId
   * @param {Function} [onComplete]
   */
  animateDiscovery(conceptId, onComplete) {
    this._discoveryAnims.push({
      conceptId,
      startTime: performance.now(),
      duration:  1500,  // 1.5 seconds
      onComplete: onComplete || null,
    });
    this._needsFit = true;
    this._dirty = true;
  },

  // ---------------------------------------------------------------------------
  // animateFailedCombo
  // ---------------------------------------------------------------------------

  /**
   * Briefly flash both concept nodes red to indicate a failed synthesis.
   * @param {string} conceptAId
   * @param {string} conceptBId
   */
  animateFailedCombo(conceptAId, conceptBId) {
    // Simple implementation: push two short "failure" animations that render a
    // red shrinking ring on each node for 0.6 seconds.
    const now = performance.now();
    for (const conceptId of [conceptAId, conceptBId]) {
      if (!conceptId) continue;
      this._discoveryAnims.push({
        conceptId,
        startTime: now,
        duration: 600,
        _isFail: true,
        onComplete: null,
      });
    }
    this._dirty = true;
  },

  // ==========================================================================
  // UI RENDERING
  // ==========================================================================

  /**
   * Update the #resource-bar DOM element with current resources and income.
   * @param {Object} resources - { silicon, copper, energy, data, compute, research, … }
   * @param {Object} income    - same keys, per-turn delta
   */
  updateResourceBar(resources, income) {
    const bar = document.getElementById('resource-bar');
    if (!bar) return;

    // Resource display config: [key, label, emoji]
    const config = [
      ['silicon',  'Silicon',  '💎'],
      ['copper',   'Copper',   '🪨'],
      ['energy',   'Energy',   '⚡'],
      ['data',     'Data',     '💾'],
      ['compute',  'Compute',  '🖥️'],
      ['research', 'Research', '🔬'],
      ['rareEarth','Rare Earth','✨'],
      ['quantum',  'Quantum',  '🔮'],
      ['military', 'Military', '⚔️'],
    ];

    const parts = [];
    for (const [key, label, emoji] of config) {
      const val = resources ? (resources[key] || 0) : 0;
      const inc = income    ? (income[key]    || 0) : 0;

      const incStr = inc > 0
        ? `<span class="income positive">(+${this._fmt(inc)}/turn)</span>`
        : inc < 0
          ? `<span class="income negative">(${this._fmt(inc)}/turn)</span>`
          : '';

      parts.push(
        `<span class="resource-item" title="${label}">` +
        `${emoji} <strong>${this._fmt(val)}</strong> ${incStr}` +
        `</span>`
      );
    }
    bar.innerHTML = parts.join('');
  },

  /**
   * Render tile info into #tile-info-panel.
   * @param {Object} tile       - map tile object
   * @param {Object} civ        - owning civilization or null
   * @param {Object} gameState
   */
  renderTileInfo(tile, civ, gameState) {
    const panel = document.getElementById('tile-info-panel');
    if (!panel || !tile) return;

    const tileData = (typeof TILE_TYPES !== 'undefined') ? TILE_TYPES[tile.type] : null;
    if (!tileData) { panel.innerHTML = ''; return; }

    const ownerLine = civ
      ? `<div class="tile-owner" style="color:${civ.color||'#fff'}">${civ.name || civ.id}</div>`
      : '<div class="tile-owner unowned">Unowned</div>';

    const resources   = tileData.baseResources || {};
    const resLines    = Object.entries(resources)
      .map(([k, v]) => `<span class="res">${k}: ${v}</span>`)
      .join(' ');

    const buildingLine = tile.building
      ? (() => {
          const b = (typeof BUILDINGS !== 'undefined') ? BUILDINGS[tile.building] : null;
          return b ? `<div class="tile-building">${b.icon || ''} ${b.name}</div>` : '';
        })()
      : '';

    const unitCount = tile.units ? tile.units.length : 0;
    const unitLine  = unitCount > 0
      ? `<div class="tile-units">${unitCount} unit${unitCount > 1 ? 's' : ''}</div>`
      : '';

    panel.innerHTML =
      `<h3>${tileData.name}</h3>` +
      ownerLine +
      `<div class="tile-resources">${resLines}</div>` +
      `<p class="tile-desc">${tileData.description}</p>` +
      buildingLine +
      unitLine;
  },

  /**
   * Render the build menu into #build-menu.
   * @param {Array<string>}  availableBuildings   - list of building ids that can appear
   * @param {Object}         playerResources      - current player resources
   * @param {Array<string>}  playerDiscoveries    - concept ids the player has discovered
   */
  renderBuildMenu(availableBuildings, playerResources, playerDiscoveries) {
    const menu = document.getElementById('build-menu');
    if (!menu) return;

    if (!availableBuildings || availableBuildings.length === 0) {
      menu.innerHTML = '<p class="no-buildings">No buildings available.</p>';
      return;
    }

    const items = [];
    for (const id of availableBuildings) {
      const b = (typeof BUILDINGS !== 'undefined') ? BUILDINGS[id] : null;
      if (!b) continue;

      // Check if player can afford
      const costParts = [];
      let canAfford = true;
      for (const [res, amt] of Object.entries(b.cost || {})) {
        const have = (playerResources && playerResources[res]) || 0;
        const ok   = have >= amt;
        if (!ok) canAfford = false;
        const cls = ok ? 'cost-ok' : 'cost-bad';
        costParts.push(`<span class="${cls}">${res}: ${amt}</span>`);
      }

      // Check concept requirements
      let requiresMet = true;
      const reqParts  = [];
      for (const req of (b.requires || [])) {
        const have = playerDiscoveries && playerDiscoveries.includes(req);
        if (!have) requiresMet = false;
        const cls = have ? 'req-ok' : 'req-bad';
        reqParts.push(`<span class="${cls}">Requires: ${req}</span>`);
      }

      const disabled = (!canAfford || !requiresMet) ? ' disabled' : '';
      items.push(
        `<div class="build-item${disabled}" data-building="${id}">` +
        `<span class="build-icon">${b.icon || '🏗️'}</span>` +
        `<span class="build-name">${b.name}</span>` +
        `<div class="build-cost">${costParts.join(' ')}</div>` +
        `<div class="build-reqs">${reqParts.join(' ')}</div>` +
        `<div class="build-desc">${b.description}</div>` +
        `</div>`
      );
    }

    menu.innerHTML = items.join('') || '<p class="no-buildings">No buildings available.</p>';
  },

  // ==========================================================================
  // RENDER LOOP
  // ==========================================================================

  /**
   * Start the main requestAnimationFrame render loop.
   * @param {Function} getGameState      - returns current gameState or null
   * @param {Function} getIdeaSpaceState - returns current ideaSpaceState or null
   */
  startRenderLoop(getGameState, getIdeaSpaceState) {
    this._getGameState      = getGameState      || (() => null);
    this._getIdeaSpaceState = getIdeaSpaceState || (() => null);
    this._dirty = true;

    const self = this;

    function loop() {
      self._rafId = requestAnimationFrame(loop);

      // Always re-render if discovery animations are active
      if (self._discoveryAnims.length > 0) self._dirty = true;
      if (self._unitMoveAnims && self._unitMoveAnims.length > 0) self._dirty = true;

      if (!self._dirty) return;
      self._dirty = false;

      // Map
      const gs = self._getGameState();
      self.renderMap(gs);

      // Concept space — only when idea lab is visible
      const csCanvas = self.csCanvas;
      if (csCanvas && csCanvas.style.display !== 'none' &&
          csCanvas.parentElement && csCanvas.offsetParent !== null) {
        const iss = self._getIdeaSpaceState();
        const playerCiv = gs && gs.civs && gs.playerCivId ? gs.civs[gs.playerCivId] : null;
        const prof = playerCiv ? playerCiv.branchProficiency : {};
        self.renderConceptSpace(iss, prof);
      }
    }

    loop();
  },

  /**
   * Mark the renderer dirty so the next frame will redraw.
   */
  markDirty() {
    this._dirty = true;
  },

  animateUnitMove(unitId, fromQ, fromR, toQ, toR, civColor, unitType) {
    const size = this.hexSize * this.mapZoom;
    const fromX = this._hexScreenX(fromQ, fromR, size);
    const fromY = this._hexScreenY(fromQ, fromR, size);
    const toX   = this._hexScreenX(toQ,   toR,   size);
    const toY   = this._hexScreenY(toQ,   toR,   size);

    // Remove any existing anim for this unit
    this._unitMoveAnims = this._unitMoveAnims.filter(a => a.unitId !== unitId);

    this._unitMoveAnims.push({
      unitId, fromX, fromY, toX, toY,
      startTime: Date.now(),
      duration: 450,  // ms
      civColor: civColor || '#ffffff',
      unitType: unitType || 'warrior',
    });
    this._dirty = true;
  },

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /** Compute screen X for a hex at axial (q, r) using current pan+zoom. */
  _hexScreenX(q, r, size) {
    return size * (1.5 * q) + this.mapOffsetX;
  },

  /** Compute screen Y for a hex at axial (q, r) using current pan+zoom. */
  _hexScreenY(q, r, size) {
    return size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r) + this.mapOffsetY;
  },

  /** Check if a tile is explored by a given civ (or always visible if no playerCivId). */
  _isTileExplored(tile, playerCivId) {
    if (!playerCivId) return true;  // no fog if no player set
    if (!tile.explored) return false;
    return tile.explored.includes(playerCivId);
  },

  /** Check explored status by coordinate lookup. */
  _isTileExploredByCoord(q, r, mapTiles, playerCivId) {
    if (!mapTiles) return false;
    const tile = mapTiles.get(`${q},${r}`);
    if (!tile) return false;
    return this._isTileExplored(tile, playerCivId);
  },

  /** Draw the subtle background dot grid on the map canvas. */
  _drawMapBackground(ctx, W, H) {
    const spacing = 32;
    ctx.fillStyle = 'rgba(40,40,60,0.45)';
    for (let x = (this.mapOffsetX % spacing + spacing) % spacing; x < W; x += spacing) {
      for (let y = (this.mapOffsetY % spacing + spacing) % spacing; y < H; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  /** Draw a 20%-opacity civ-colored overlay on a territory hex. */
  _drawTerritoryOverlay(ctx, q, r, civColor, size) {
    const rgb = this._hexColorToRgb(civColor);
    if (!rgb) return;
    const fill = `rgba(${rgb.r},${rgb.g},${rgb.b},0.20)`;
    this.drawHex(ctx, q, r, fill, null, 0, size);
  },

  /** Draw a subtle texture pattern (dots or lines) on the tile based on type. */
  _drawHexTexture(ctx, q, r, type, size) {
    const cx = this._hexScreenX(q, r, size);
    const cy = this._hexScreenY(q, r, size);

    ctx.save();
    // Clip to hex shape so texture doesn't bleed
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angleRad = (Math.PI / 180) * (60 * i);
      const x = cx + (size - 1) * Math.cos(angleRad);
      const y = cy + (size - 1) * Math.sin(angleRad);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();

    const dotR   = Math.max(1, size * 0.06);
    const spread = size * 0.45;

    switch (type) {
      case 'circuit_plains': {
        // Grid of tiny dots — PCB trace feel
        ctx.fillStyle = 'rgba(100,180,100,0.18)';
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            ctx.beginPath();
            ctx.arc(cx + dx * spread * 0.6, cy + dy * spread * 0.6, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'data_swamp': {
        // Wavy horizontal lines
        ctx.strokeStyle = 'rgba(0,200,200,0.20)';
        ctx.lineWidth   = Math.max(1, size * 0.04);
        for (let dy = -1; dy <= 1; dy++) {
          ctx.beginPath();
          ctx.moveTo(cx - spread, cy + dy * spread * 0.45);
          ctx.bezierCurveTo(
            cx - spread * 0.4, cy + dy * spread * 0.45 - size * 0.07,
            cx + spread * 0.4, cy + dy * spread * 0.45 + size * 0.07,
            cx + spread,       cy + dy * spread * 0.45
          );
          ctx.stroke();
        }
        break;
      }
      case 'energy_geysers': {
        // Radiating lines
        ctx.strokeStyle = 'rgba(255,120,0,0.22)';
        ctx.lineWidth   = Math.max(1, size * 0.035);
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * spread * 0.8, cy + Math.sin(a) * spread * 0.8);
          ctx.stroke();
        }
        break;
      }
      case 'quantum_fields': {
        // Concentric faint rings
        ctx.strokeStyle = 'rgba(180,0,255,0.20)';
        ctx.lineWidth   = Math.max(1, size * 0.03);
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.arc(cx, cy, (spread / 3) * i, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'memory_mountains': {
        // Triangle peaks
        ctx.strokeStyle = 'rgba(150,150,200,0.22)';
        ctx.lineWidth   = Math.max(1, size * 0.04);
        const pts = [[-0.5, 0.3], [0, -0.4], [0.5, 0.3]];
        ctx.beginPath();
        ctx.moveTo(cx + pts[0][0]*spread, cy + pts[0][1]*spread);
        ctx.lineTo(cx + pts[1][0]*spread, cy + pts[1][1]*spread);
        ctx.lineTo(cx + pts[2][0]*spread, cy + pts[2][1]*spread);
        ctx.stroke();
        break;
      }
      case 'logic_forest': {
        // Small tree-like dots
        ctx.fillStyle = 'rgba(80,200,80,0.22)';
        const treePos = [[0, -0.38], [-0.32, 0.15], [0.32, 0.15]];
        for (const [dx, dy] of treePos) {
          ctx.beginPath();
          ctx.arc(cx + dx * spread, cy + dy * spread, dotR * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'silicon_valley': {
        // Diamond / crystal facet lines
        ctx.strokeStyle = 'rgba(200,180,220,0.20)';
        ctx.lineWidth   = Math.max(1, size * 0.035);
        ctx.beginPath();
        ctx.moveTo(cx,            cy - spread * 0.5);
        ctx.lineTo(cx + spread * 0.4, cy);
        ctx.lineTo(cx,            cy + spread * 0.5);
        ctx.lineTo(cx - spread * 0.4, cy);
        ctx.closePath();
        ctx.stroke();
        break;
      }
      default:
        // Minimal center dot
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
  },

  /** Draw axis text labels and faint guide lines in the concept space canvas. */
  _drawConceptSpaceAxes(ctx) {
    if (!this.csCanvas) return;
    const W = this.csCanvas.width;
    const H = this.csCanvas.height;
    const style = "rgba(255,255,255,0.25)";
    const font  = "10px 'Courier New'";
    ctx.font         = font;
    ctx.fillStyle    = style;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    // Faint guide lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([6, 8]);
    // Horizontal line at 70% height
    ctx.beginPath(); ctx.moveTo(0, H * 0.7); ctx.lineTo(W, H * 0.7); ctx.stroke();
    // Vertical center line
    ctx.beginPath(); ctx.moveTo(W * 0.5, 0); ctx.lineTo(W * 0.5, H); ctx.stroke();
    ctx.setLineDash([]);
    // Edge labels
    ctx.fillStyle = style;
    ctx.textAlign = 'center';
    ctx.fillText('ANCIENT', W / 2, H - 5);
    ctx.fillText('MODERN / FUTURE', W / 2, 5);
    // Left: rotated
    ctx.save();
    ctx.translate(5, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('PHYSICAL / HARDWARE', 0, 0);
    ctx.restore();
    // Right: rotated
    ctx.save();
    ctx.translate(W - 5, H / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('ABSTRACT / THEORY', 0, 0);
    ctx.restore();
  },

  /** Draw large dim cluster name labels at each cluster's centroid. */
  _drawConceptSpaceRegionLabels(ctx, nodes) {
    if (!nodes || !this.csCanvas) return;
    const W = this.csCanvas.width;
    const H = this.csCanvas.height;
    // Group by cluster
    const groups = {};
    for (const node of Object.values(nodes)) {
      if (!node.cluster) continue;
      if (!groups[node.cluster]) groups[node.cluster] = [];
      groups[node.cluster].push(node);
    }
    ctx.font         = "14px 'Courier New'";
    ctx.fillStyle    = 'rgba(255,255,255,0.10)';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const margin = 50;
    for (const [cluster, clusterNodes] of Object.entries(groups)) {
      let sumX = 0, sumY = 0, count = 0;
      for (const n of clusterNodes) {
        const { sx, sy } = this._csNodeScreenPos(n);
        if (sx >= 0 && sx <= W && sy >= 0 && sy <= H) {
          sumX += sx; sumY += sy; count++;
        }
      }
      if (count === 0) continue;
      const cx = sumX / count;
      const cy = sumY / count;
      // Only draw if centroid is within canvas bounds + margin
      if (cx < -margin || cx > W + margin || cy < -margin || cy > H + margin) continue;
      const meta = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[cluster] : null;
      const label = meta ? (meta.name || cluster) : cluster;
      ctx.fillText(label.toUpperCase(), cx, cy);
    }
  },

  /**
   * Draw all cluster nebulae for the concept space.
   */
  _drawAllClusterNebulae(ctx, nodes, discovered) {
    if (!nodes) return;
    // Group nodes by cluster
    const groups = {};
    for (const node of Object.values(nodes)) {
      if (!node.cluster) continue;
      if (!groups[node.cluster]) groups[node.cluster] = [];
      groups[node.cluster].push(node);
    }
    for (const [cluster, clusterNodes] of Object.entries(groups)) {
      const meta  = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[cluster] : null;
      const color = meta ? meta.color : '#888888';
      // Only draw if at least one node in cluster is discovered
      const anyDisc = clusterNodes.some(n => discovered.has(n.id));
      if (anyDisc) {
        this.drawClusterNebula(ctx, clusterNodes, color);
      }
    }
  },

  /**
   * Compute screen position for a concept node, applying pan/zoom and pseudo-3D tilt.
   * Concept coordinates are normalized (-1 to 1); we map to canvas pixels.
   */
  _csNodeScreenPos(node) {
    if (!node) return { sx: 0, sy: 0 };

    const z = this._clusterZDepth[node.cluster] || 0.5;

    // Base normalized -> canvas pixel (scale by csZoom, center on csOffset)
    const canvasW = this.csCanvas ? this.csCanvas.width  : 800;
    const canvasH = this.csCanvas ? this.csCanvas.height : 600;
    const scale   = Math.min(canvasW, canvasH) * 0.65 * this.csZoom;

    // Use x/y from CONCEPTS data (normalized -1..1 range)
    const baseX = (node.x || 0) * scale + this.csOffsetX;
    const baseY = (node.y || 0) * scale + this.csOffsetY;

    // Pseudo-3D offset based on z-depth and rotation angles
    const sx = baseX + z * this.csRotationY * 200;
    const sy = baseY + z * this.csRotationX * 200;

    return { sx, sy };
  },

  /**
   * Look up a CONCEPTS node by id.
   * Handles both external "nodes" object passed to renderConceptSpace and the
   * global CONCEPTS constant as a fallback (for getConceptAtPosition etc.).
   */
  _getConceptNode(id) {
    if (typeof CONCEPTS !== 'undefined' && CONCEPTS[id]) return CONCEPTS[id];
    return null;
  },

  /** Generate a fixed array of star positions [{ x01, y01 }] for the concept space. */
  _generateStars(count) {
    const stars = [];
    // Use a deterministic sequence so stars don't move when re-initing
    for (let i = 0; i < count; i++) {
      const x = Math.abs(Math.sin(i * 127.13 + 1.23)) % 1;
      const y = Math.abs(Math.sin(i * 311.77 + 5.67)) % 1;
      const brightness = 0.3 + Math.abs(Math.sin(i * 74.3)) * 0.7;
      const size       = 0.5 + Math.abs(Math.sin(i * 33.1)) * 1.0;
      stars.push({ x, y, brightness, size });
    }
    return stars;
  },

  /** Draw the fixed star field. */
  _drawStars(ctx) {
    if (!this._stars || !this.csCanvas) return;
    const W = this.csCanvas.width;
    const H = this.csCanvas.height;
    for (const s of this._stars) {
      const alpha = s.brightness * 0.7;
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  /** Render one frame of the discovery animation at normalized time t in [0,1]. */
  _renderDiscoveryFrame(ctx, node, t) {
    if (!node) return;
    const { sx, sy } = this._csNodeScreenPos(node);

    const tier    = node.tier || 1;
    const nodeR   = (tier * 2 + 4) * this.csZoom;
    const clusterMeta  = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[node.cluster] : null;
    const clusterColor = clusterMeta ? clusterMeta.color : '#ffffff';
    const rgb          = this._hexColorToRgb(clusterColor);

    // Expanding ring that fades out
    const ringR   = nodeR * (1 + t * 5);
    const ringAlpha = (1 - t) * 0.8;
    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
    if (rgb) {
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${ringAlpha.toFixed(2)})`;
    } else {
      ctx.strokeStyle = `rgba(255,255,255,${ringAlpha.toFixed(2)})`;
    }
    ctx.lineWidth = Math.max(1, 3 * (1 - t) * this.csZoom);
    ctx.stroke();

    // Second inner ring (slightly delayed)
    if (t > 0.1) {
      const t2   = (t - 0.1) / 0.9;
      const ring2R = nodeR * (1 + t2 * 3);
      const ring2A = (1 - t2) * 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, ring2R, 0, Math.PI * 2);
      if (rgb) {
        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${ring2A.toFixed(2)})`;
      } else {
        ctx.strokeStyle = `rgba(255,255,255,${ring2A.toFixed(2)})`;
      }
      ctx.lineWidth = Math.max(1, 2 * (1 - t2) * this.csZoom);
      ctx.stroke();
    }

    // "Pop" brightness: node glows extra bright during first half of animation
    if (t < 0.5) {
      const popAlpha = (0.5 - t) * 1.4;
      const popR     = nodeR * (1.0 + (0.5 - t) * 1.2);
      const glow     = ctx.createRadialGradient(sx, sy, 0, sx, sy, popR * 2);
      if (rgb) {
        glow.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.min(1, popAlpha).toFixed(2)})`);
        glow.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      } else {
        glow.addColorStop(0, `rgba(255,255,255,${Math.min(1, popAlpha).toFixed(2)})`);
        glow.addColorStop(1, 'rgba(255,255,255,0)');
      }
      ctx.beginPath();
      ctx.arc(sx, sy, popR * 2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
    }
  },

  /** Update tooltip position; content is set by UI.onHexHovered. */
  _updateMapTooltip(clientX, clientY, hex) {
    const tooltip = document.getElementById('map-tooltip');
    if (!tooltip) return;
    if (!tooltip.classList.contains('hidden')) {
      const rect = this.mapCanvas ? this.mapCanvas.getBoundingClientRect() : { left: 0, top: 0 };
      tooltip.style.left = (clientX - rect.left + 14) + 'px';
      tooltip.style.top  = (clientY - rect.top  + 10) + 'px';
    }
  },

  _hideMapTooltip() {
    const tooltip = document.getElementById('map-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
  },

  /**
   * Shift a hex CSS color (#rrggbb) by a brightness delta (-1 to 1).
   * Returns a new CSS color string.
   */
  _shiftColor(hexColor, delta) {
    const rgb = this._hexColorToRgb(hexColor);
    if (!rgb) return hexColor;
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    const shift = delta * 255;
    const r = clamp(rgb.r + shift);
    const g = clamp(rgb.g + shift);
    const b = clamp(rgb.b + shift);
    return `rgb(${r},${g},${b})`;
  },

  /**
   * Parse a hex CSS color (#rgb or #rrggbb) to { r, g, b } integers.
   * Returns null if unparseable.
   */
  _hexColorToRgb(hex) {
    if (!hex || typeof hex !== 'string') return null;
    hex = hex.trim().replace('#', '');
    if (hex.length === 3) {
      hex = hex[0]+hex[0] + hex[1]+hex[1] + hex[2]+hex[2];
    }
    if (hex.length !== 6) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  },

  /** Format a number for display (integer or 1 decimal). */
  _fmt(v) {
    if (v === null || v === undefined) return '0';
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(1);
  },
};
