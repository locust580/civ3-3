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
   * Fill a hex with terrain color, apply fog of war, and draw a texture pattern.
   */
  drawHexTerrain(ctx, tile, isExplored, isSelected, isHovered, size) {
    const tileData = (typeof TILE_TYPES !== 'undefined') ? TILE_TYPES[tile.type] : null;
    const baseColor = tileData ? tileData.color : '#333333';
    const q = tile.q;
    const r = tile.r;

    if (!isExplored) {
      // Fog of war: very dark tile
      this.drawHex(ctx, q, r, '#0a0a10', '#111118', 0.5, size);
      return;
    }

    // Slight colour variation using position as seed
    const variation = ((q * 7 + r * 13) % 7 - 3) * 0.012;
    const fillColor = this._shiftColor(baseColor, variation);

    // Hovered: slightly brighter
    const finalFill = isHovered ? this._shiftColor(fillColor, 0.08) : fillColor;

    // Base hex fill
    this.drawHex(ctx, q, r, finalFill, '#1a1a28', 0.8, size);

    // Subtle texture pattern
    this._drawHexTexture(ctx, q, r, tile.type, size);

    // Selected: inner glow — drawn after texture
    if (isSelected) {
      this.drawHex(ctx, q, r, 'rgba(0,220,255,0.10)', '#00e5ff', 2.5, size);
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

      for (let d = 0; d < 6; d++) {
        const dir   = dirs[d];
        const nbKey = `${tile.q + dir.q},${tile.r + dir.r}`;
        const nbTile = mapTiles.get(nbKey);
        const nbOwner = nbTile ? nbTile.owner : null;

        // Draw border if neighbour has different owner or is outside the map
        if (nbOwner !== tile.owner) {
          const [ci, cj] = edgeCorners[d];
          ctx.beginPath();
          ctx.moveTo(corners[ci].x, corners[ci].y);
          ctx.lineTo(corners[cj].x, corners[cj].y);
          ctx.strokeStyle = borderColor;
          ctx.lineWidth   = 3 * this.mapZoom;
          ctx.stroke();
        }
      }
    }
  },

  // ---------------------------------------------------------------------------
  // drawBuilding
  // ---------------------------------------------------------------------------

  /**
   * Draw a building icon (emoji) at a tile center.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} centerX
   * @param {number} centerY
   * @param {string} buildingId
   * @param {number} scale  - mapZoom
   */
  drawBuilding(ctx, centerX, centerY, buildingId, scale) {
    const bldData = (typeof BUILDINGS !== 'undefined') ? BUILDINGS[buildingId] : null;
    if (!bldData) return;

    const icon = bldData.icon || '🏗️';
    const fontSize = Math.max(8, Math.round(14 * scale));
    ctx.font = `${fontSize}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    // Slight shadow for legibility
    ctx.shadowColor  = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur   = 4;
    ctx.fillText(icon, centerX, centerY - fontSize * 0.1);
    ctx.shadowBlur   = 0;
  },

  // ---------------------------------------------------------------------------
  // drawUnit
  // ---------------------------------------------------------------------------

  /**
   * Draw a unit as a colored circle with type indicator and health bar.
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

    // Radius by unit type
    const radii = { scout: 0.18, warrior: 0.22, siege: 0.28,
                    cyber_warrior: 0.24, quantum_agent: 0.26 };
    const r = Math.max(5, hexSizePx * (radii[unit.type] || 0.22));

    // Circle body
    ctx.beginPath();
    ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
    ctx.fillStyle = civColor;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Unit type initial
    const typeData = (typeof UNIT_TYPES !== 'undefined') ? UNIT_TYPES[unit.type] : null;
    const icon     = typeData ? typeData.icon : '?';
    const fontSize = Math.max(7, Math.round(r * 1.1));
    ctx.font = `${fontSize}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#ffffff';
    ctx.shadowColor  = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur   = 3;
    ctx.fillText(icon, centerX, centerY);
    ctx.shadowBlur   = 0;

    // Health bar
    const hp    = unit.hp    !== undefined ? unit.hp    : 10;
    const maxHp = unit.maxHp !== undefined ? unit.maxHp : 10;
    const hpRatio = Math.max(0, Math.min(1, hp / maxHp));
    const barW  = r * 2.2;
    const barH  = Math.max(3, r * 0.25);
    const barX  = centerX - barW / 2;
    const barY  = centerY + r + 3;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(barX, barY, barW, barH);
    // Fill — green/yellow/red
    const hpColor = hpRatio > 0.6 ? '#33cc33' : hpRatio > 0.3 ? '#ffcc00' : '#ff3333';
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    // Count badge if multiple units on tile
    if (totalUnits > 1) {
      const badgeR = Math.max(5, r * 0.45);
      const bx     = centerX + r * 0.65;
      const by     = centerY - r * 0.65;
      ctx.beginPath();
      ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
      ctx.fillStyle   = '#222233';
      ctx.fill();
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.font = `bold ${Math.max(7, Math.round(badgeR * 1.2))}px sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = '#ffffff';
      ctx.fillText(String(totalUnits), bx, by);
    }
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

    const tier     = node.tier || 1;
    const baseR    = tier * 2 + 4;                       // tier 1=6px, tier 7=18px
    const radius   = baseR * this.csZoom * (isHovered ? 1.3 : 1.0);

    const clusterMeta = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[node.cluster] : null;
    const clusterColor = clusterMeta ? clusterMeta.color : '#888888';

    if (!isDiscovered) {
      // Small dim grey dot
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(3, radius * 0.5), 0, Math.PI * 2);
      ctx.fillStyle   = 'rgba(80,80,100,0.5)';
      ctx.fill();
      return;
    }

    // Glow for discovered nodes
    const glowR  = radius * 2.2;
    const glow   = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
    const rgb    = this._hexColorToRgb(clusterColor);
    if (rgb) {
      glow.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`);
      glow.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.00)`);
    }
    ctx.beginPath();
    ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Node body
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle   = clusterColor;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.2;
    ctx.stroke();

    // Selected: gold glow ring
    if (isSelected) {
      const slotIndex = mixSlots.indexOf(node.id);
      const goldColor = slotIndex === 0 ? '#FFD700' : '#FFA500';
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 4 * this.csZoom, 0, Math.PI * 2);
      ctx.strokeStyle = goldColor;
      ctx.lineWidth   = 2.5;
      ctx.stroke();

      // Outer pulse ring
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 8 * this.csZoom, 0, Math.PI * 2);
      ctx.strokeStyle = `${goldColor}66`;
      ctx.lineWidth   = 1.5;
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

      // Bezier control point: offset from midpoint perpendicular to line
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const dx = bx - ax;
      const dy = by - ay;
      const perpX = -dy * 0.18;
      const perpY =  dx * 0.18;
      const cpx   = mx + perpX;
      const cpy   = my + perpY;

      const clusterMeta = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[nodeA.cluster] : null;
      const lineColor   = clusterMeta ? clusterMeta.color : '#555577';

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(cpx, cpy, bx, by);

      if (aDisc && bDisc) {
        // Both discovered: bright solid line
        ctx.strokeStyle = lineColor + 'bb';
        ctx.lineWidth   = 1.5 * this.csZoom;
        ctx.setLineDash([]);
      } else {
        // One discovered: dim dashed hint
        ctx.strokeStyle = lineColor + '44';
        ctx.lineWidth   = 1.0 * this.csZoom;
        ctx.setLineDash([4, 6]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZ   = Math.max(0.3, Math.min(3.0, self.csZoom * factor));
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
    const scale   = Math.min(canvasW, canvasH) * 0.42 * this.csZoom;

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

  /** Update or hide the #map-tooltip DOM element. */
  _updateMapTooltip(clientX, clientY, hex) {
    let tooltip = document.getElementById('map-tooltip');
    if (!tooltip) return;

    // Try to get tile info from game state
    const gs   = this._getGameState ? this._getGameState() : null;
    const tileMap = gs && (gs.mapTiles || gs.map);
    const tile = tileMap ? tileMap.get(`${hex.q},${hex.r}`) : null;
    if (!tile) { this._hideMapTooltip(); return; }

    const tileData = (typeof TILE_TYPES !== 'undefined') ? TILE_TYPES[tile.type] : null;
    if (!tileData) { this._hideMapTooltip(); return; }

    const isExplored = this._isTileExplored(tile, gs.playerCivId);
    if (!isExplored) {
      tooltip.innerHTML = '<div class="tt-fog">Unexplored territory</div>';
    } else {
      const res = tileData.baseResources || {};
      const resStr = Object.entries(res).map(([k, v]) => `${k}:${v}`).join(', ');
      const ownerLine = tile.owner
        ? `<div class="tt-owner">Owner: ${tile.owner}</div>`
        : '';
      tooltip.innerHTML =
        `<div class="tt-name">${tileData.name}</div>` +
        ownerLine +
        (resStr ? `<div class="tt-res">${resStr}</div>` : '');
    }

    tooltip.style.display = 'block';
    tooltip.style.left    = `${clientX + 12}px`;
    tooltip.style.top     = `${clientY + 12}px`;
  },

  _hideMapTooltip() {
    const tooltip = document.getElementById('map-tooltip');
    if (tooltip) tooltip.style.display = 'none';
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
