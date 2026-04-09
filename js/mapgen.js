// =============================================================================
// Silicon Civilizations — Map Generation & Hex Grid Math
// Depends on data.js being loaded first (TILE_TYPES must be globally available).
// All functions are top-level so they are accessible from window scope.
// Flat-top hexes, axial (q, r) coordinates throughout.
// =============================================================================

// ---------------------------------------------------------------------------
// SIMPLE DETERMINISTIC NOISE
// ---------------------------------------------------------------------------

/**
 * Deterministic noise in [0, 1) based on position and seed.
 * Uses a sine hash — fast, no imports, repeatable for same inputs.
 */
function noise(x, y, seed) {
  return Math.abs(Math.sin(x * 127.1 + y * 311.7 + seed * 74.3)) % 1;
}

// ---------------------------------------------------------------------------
// HEX GRID MATH  (flat-top hexes, axial coordinates)
// ---------------------------------------------------------------------------

/**
 * Convert axial (q, r) to offset (col, row) for array storage.
 * Uses "even-q" offset layout for flat-top hexes.
 */
function axialToOffset(q, r) {
  const col = q;
  const row = r + Math.floor((q + (q & 1)) / 2);
  return { col, row };
}

/**
 * Convert offset (col, row) back to axial (q, r).
 */
function offsetToAxial(col, row) {
  const q = col;
  const r = row - Math.floor((col + (col & 1)) / 2);
  return { q, r };
}

/**
 * Get the pixel center of a hex at axial (q, r).
 * Flat-top formula:
 *   x = size * (3/2 * q) + offsetX
 *   y = size * (sqrt(3)/2 * q + sqrt(3) * r) + offsetY
 */
function hexToPixel(q, r, size, offsetX, offsetY) {
  const x = size * (1.5 * q) + offsetX;
  const y = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r) + offsetY;
  return { x, y };
}

/**
 * Get axial coordinates from a pixel position.
 * Inverse of hexToPixel — returns {q, r} rounded to nearest hex center.
 */
function pixelToHex(px, py, size, offsetX, offsetY) {
  const x = px - offsetX;
  const y = py - offsetY;
  const q = (2 / 3 * x) / size;
  const r = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / size;
  return axialRound(q, r);
}

/**
 * Round fractional axial coordinates to the nearest integer hex.
 * Uses cube coordinate rounding then converts back to axial.
 */
function axialRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  return { q: rq, r: rr };
}

/**
 * Axial distance (number of hex steps) between two hexes.
 */
function hexDistance(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

// The 6 axial direction vectors for flat-top hexes.
const HEX_DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

/**
 * Get all 6 neighboring axial coordinates of hex (q, r).
 * Returns an array of 6 {q, r} objects.
 */
function hexNeighbors(q, r) {
  return HEX_DIRECTIONS.map(d => ({ q: q + d.q, r: r + d.r }));
}

/**
 * Get all hexes within `radius` steps of (q, r), including center.
 * Returns array of {q, r}.
 */
function hexesInRadius(q, r, radius) {
  const results = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const rMin = Math.max(-radius, -dq - radius);
    const rMax = Math.min(radius, -dq + radius);
    for (let dr = rMin; dr <= rMax; dr++) {
      results.push({ q: q + dq, r: r + dr });
    }
  }
  return results;
}

/**
 * Get the ring of hexes at exactly `radius` steps from (q, r).
 * Returns array of {q, r}. Returns [{q,r}] for radius 0.
 */
function hexRing(q, r, radius) {
  if (radius === 0) return [{ q, r }];
  const results = [];
  // Start at the hex `radius` steps in direction 4 (bottom-left), then walk
  // around using the 6 directions in order.
  let hex = { q: q + HEX_DIRECTIONS[4].q * radius, r: r + HEX_DIRECTIONS[4].r * radius };
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      results.push({ q: hex.q, r: hex.r });
      hex = { q: hex.q + HEX_DIRECTIONS[i].q, r: hex.r + HEX_DIRECTIONS[i].r };
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// MAP GENERATION
// ---------------------------------------------------------------------------

/**
 * Target proportions for tile type assignment.
 * Values should sum to 1.0.
 */
const TILE_WEIGHTS = [
  { type: 'circuit_plains',    weight: 0.28 },
  { type: 'logic_forest',      weight: 0.15 },
  { type: 'silicon_valley',    weight: 0.12 },
  { type: 'memory_mountains',  weight: 0.10 },
  { type: 'cooling_lake',      weight: 0.08 },
  { type: 'data_swamp',        weight: 0.08 },
  { type: 'energy_geysers',    weight: 0.06 },
  { type: 'thermal_wastes',    weight: 0.05 },
  { type: 'rare_earth',        weight: 0.04 },
  { type: 'ancient_ruins',     weight: 0.02 },
  { type: 'quantum_fields',    weight: 0.015 },
  { type: 'void_zone',         weight: 0.005 },
];

// Build cumulative distribution for weighted random selection.
const _TILE_CDF = (() => {
  const cdf = [];
  let cum = 0;
  for (const entry of TILE_WEIGHTS) {
    cum += entry.weight;
    cdf.push({ type: entry.type, cum });
  }
  return cdf;
})();

/**
 * Sample a tile type using the weighted distribution and a noise value in [0,1).
 */
function _sampleTileType(noiseVal) {
  for (const entry of _TILE_CDF) {
    if (noiseVal < entry.cum) return entry.type;
  }
  return _TILE_CDF[_TILE_CDF.length - 1].type;
}

/**
 * Generate the full hex map.
 *
 * @param {number} width  - number of columns in the offset grid
 * @param {number} height - number of rows in the offset grid
 * @param {number} numCivs - number of civilizations (used for starting position hints)
 * @returns {Map<string, Object>} - keyed by "q,r" strings
 */
function generateMap(width, height, numCivs) {
  const seed = 42; // Fixed seed for reproducible maps; can be parameterised later.
  const mapTiles = new Map();

  // Step 1: Create all hex positions and assign initial tile types via noise.
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      const { q, r } = offsetToAxial(col, row);
      const noiseVal = noise(col, row, seed);
      const tileType = _sampleTileType(noiseVal);
      const key = `${q},${r}`;

      // Random small resource bonuses on roughly 20% of tiles.
      const bonusNoise = noise(col + 1000, row + 1000, seed + 7);
      const resourceBonus = {};
      if (bonusNoise > 0.80) {
        const bonusTypes = ['silicon', 'copper', 'data', 'energy', 'research'];
        const bonusIdx = Math.floor(noise(col + 2000, row + 2000, seed + 13) * bonusTypes.length);
        resourceBonus[bonusTypes[bonusIdx]] = 1;
      }

      mapTiles.set(key, {
        q,
        r,
        col,
        row,
        type: tileType,
        owner: null,
        building: null,
        units: [],
        explored: [],
        special: TILE_TYPES[tileType] ? (TILE_TYPES[tileType].special || null) : null,
        resourceBonus,
      });
    }
  }

  // Step 2: Two passes of majority-smoothing for contiguous terrain.
  for (let pass = 0; pass < 2; pass++) {
    const updates = [];
    for (const [key, tile] of mapTiles) {
      // Don't smooth void_zones — handle those separately.
      if (tile.type === 'void_zone') continue;

      const neighbors = hexNeighbors(tile.q, tile.r);
      const counts = {};
      for (const nb of neighbors) {
        const nbKey = `${nb.q},${nb.r}`;
        const nbTile = mapTiles.get(nbKey);
        if (nbTile && nbTile.type !== 'void_zone') {
          counts[nbTile.type] = (counts[nbTile.type] || 0) + 1;
        }
      }
      // If any non-void type appears 4+ times among neighbors, adopt it.
      let dominantType = null;
      let dominantCount = 0;
      for (const [t, c] of Object.entries(counts)) {
        if (c > dominantCount) {
          dominantCount = c;
          dominantType = t;
        }
      }
      if (dominantCount >= 4 && dominantType && dominantType !== tile.type) {
        updates.push({ key, type: dominantType });
      }
    }
    for (const { key, type } of updates) {
      mapTiles.get(key).type = type;
    }
  }

  // Step 3: Confine void_zones to isolated patches far from the map center.
  // Any void tile that has a non-void neighbor close to center gets converted.
  const centerQ = Math.floor(width / 2);
  const centerR = Math.floor(height / 2);
  const voidMinDist = Math.min(width, height) * 0.35; // must be this far from center

  for (const [, tile] of mapTiles) {
    if (tile.type !== 'void_zone') continue;
    const dist = hexDistance(tile.q, tile.r, centerQ, centerR);
    if (dist < voidMinDist) {
      // Replace with circuit_plains — the neutral fallback terrain.
      tile.type = 'circuit_plains';
      tile.special = null;
    }
  }

  return mapTiles;
}

// ---------------------------------------------------------------------------
// STARTING POSITIONS
// ---------------------------------------------------------------------------

/**
 * Score a tile by total base resource output (higher = better start).
 */
function _tileTotalResources(tile) {
  if (!tile || !TILE_TYPES[tile.type]) return 0;
  const base = TILE_TYPES[tile.type].baseResources || {};
  let total = Object.values(base).reduce((s, v) => s + v, 0);
  // Add any bonus resources.
  total += Object.values(tile.resourceBonus || {}).reduce((s, v) => s + v, 0);
  return total;
}

/**
 * Find good starting positions for `numCivs` civilizations.
 *
 * @param {Map<string, Object>} mapTiles
 * @param {number} mapWidth
 * @param {number} mapHeight
 * @param {number} numCivs
 * @returns {Array<{q:number, r:number}>}
 */
function findStartingPositions(mapTiles, mapWidth, mapHeight, numCivs) {
  // Use a 2D grid of sectors so civs are spread across both axes.
  // For numCivs <= 4: 1 row; for 5-8: 2 rows; for 9+: 3 rows.
  const numRows = numCivs <= 4 ? 1 : numCivs <= 8 ? 2 : 3;
  const numCols = Math.ceil(numCivs / numRows);

  const sectorW = mapWidth  / numCols;
  const sectorH = mapHeight / numRows;
  const minDist = Math.floor(Math.min(sectorW, sectorH) * 0.6);

  // Build sector list (row-major order)
  const sectors = [];
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      if (sectors.length < numCivs) {
        sectors.push({
          colMin: col * sectorW,
          colMax: (col + 1) * sectorW,
          rowMin: row * sectorH,
          rowMax: (row + 1) * sectorH,
        });
      }
    }
  }

  // Shuffle sectors for variety
  for (let i = sectors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sectors[i], sectors[j]] = [sectors[j], sectors[i]];
  }

  const positions = [];

  for (const sector of sectors) {
    let best = null;
    let bestScore = -Infinity;

    for (const [, tile] of mapTiles) {
      if (tile.col < sector.colMin || tile.col >= sector.colMax) continue;
      if (tile.row < sector.rowMin || tile.row >= sector.rowMax) continue;
      if (tile.type === 'void_zone' || tile.type === 'cooling_lake') continue;

      // Enforce minimum distance from already chosen starts.
      const tooClose = positions.some(p => hexDistance(tile.q, tile.r, p.q, p.r) < minDist);
      if (tooClose) continue;

      // Score = tile resources + sum of neighbor resources (3-hex radius).
      let score = _tileTotalResources(tile);
      for (const nb of hexesInRadius(tile.q, tile.r, 3)) {
        const nbTile = mapTiles.get(`${nb.q},${nb.r}`);
        if (nbTile) score += _tileTotalResources(nbTile) * 0.5;
      }

      if (score > bestScore) {
        bestScore = score;
        best = { q: tile.q, r: tile.r };
      }
    }

    if (best) positions.push(best);
  }

  // Fallback: if sector search didn't fill all spots, search globally
  if (positions.length < numCivs) {
    for (const [, tile] of mapTiles) {
      if (positions.length >= numCivs) break;
      if (tile.type === 'void_zone' || tile.type === 'cooling_lake') continue;
      const tooClose = positions.some(p => hexDistance(tile.q, tile.r, p.q, p.r) < minDist);
      if (!tooClose) positions.push({ q: tile.q, r: tile.r });
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// TERRITORY INITIALIZATION
// ---------------------------------------------------------------------------

/**
 * Assign initial territory (radius-2 ring) around each starting position.
 *
 * @param {Map<string, Object>} mapTiles
 * @param {Array<{q:number, r:number}>} startPositions
 * @param {Array<string>} civIds - civilization id strings, parallel to startPositions
 */
function initializeTerritory(mapTiles, startPositions, civIds) {
  for (let i = 0; i < startPositions.length; i++) {
    const { q, r } = startPositions[i];
    const civId = civIds[i];
    if (!civId) continue;

    const hexes = hexesInRadius(q, r, 2);
    for (const hex of hexes) {
      const tile = mapTiles.get(`${hex.q},${hex.r}`);
      if (tile && tile.type !== 'void_zone') {
        // Only assign if unclaimed or this civ is closer.
        if (tile.owner === null) {
          tile.owner = civId;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// FOG OF WAR
// ---------------------------------------------------------------------------

/**
 * Mark tiles within `visionRadius` of each given position as explored by civId.
 *
 * @param {Map<string, Object>} mapTiles
 * @param {string} civId
 * @param {Array<{q:number, r:number}>} positions - unit or building positions
 * @param {number} visionRadius
 */
function updateExploration(mapTiles, civId, positions, visionRadius) {
  for (const pos of positions) {
    const visible = hexesInRadius(pos.q, pos.r, visionRadius);
    for (const hex of visible) {
      const tile = mapTiles.get(`${hex.q},${hex.r}`);
      if (tile && !tile.explored.includes(civId)) {
        tile.explored.push(civId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// RESOURCE CALCULATION
// ---------------------------------------------------------------------------

/**
 * Calculate the total resource production delta for a civilization this turn.
 *
 * @param {Map<string, Object>} mapTiles
 * @param {Object} civ - civilization object (must have .id, .faction, .ownedBuildings etc.)
 * @param {Array<Object>} activeEvents - array of currently active event objects
 * @param {Object} branchProficiency - map of branch id -> proficiency level (0-10)
 * @returns {Object} resource delta, e.g. { silicon: 3, energy: 2, ... }
 */
function calculateCivResources(mapTiles, civ, activeEvents, branchProficiency) {
  const delta = {};

  // Helper to accumulate into delta.
  function add(resources) {
    for (const [res, val] of Object.entries(resources)) {
      if (typeof val === 'number') {
        delta[res] = (delta[res] || 0) + val;
      }
    }
  }

  // Gather active event multipliers and flags.
  const multipliers = {};   // resource key -> multiplier
  let thermalPenaltyBlocked = false;
  for (const event of (activeEvents || [])) {
    const ef = event.effect || {};
    if (ef.energy_mult   !== undefined) multipliers.energy   = ef.energy_mult;
    if (ef.silicon_mult  !== undefined) multipliers.silicon  = ef.silicon_mult;
    if (ef.data_mult     !== undefined) multipliers.data     = ef.data_mult;
    if (ef.no_heat) thermalPenaltyBlocked = true;
    // Direct windfall additions (e.g. data_windfall gives +20 data once, handled in engine).
  }

  // Iterate owned tiles.
  for (const [, tile] of mapTiles) {
    if (tile.owner !== civ.id) continue;
    const tileData = TILE_TYPES[tile.type];
    if (!tileData) continue;

    // Base tile resources.
    const base = tileData.baseResources || {};
    const scaledBase = {};
    for (const [res, val] of Object.entries(base)) {
      const mult = multipliers[res] !== undefined ? multipliers[res] : 1;
      scaledBase[res] = val * mult;
    }
    add(scaledBase);

    // Tile bonus resources (small random extras).
    add(tile.resourceBonus || {});

    // Thermal wastes penalty (-1 compute) unless blocked by event.
    if (tile.type === 'thermal_wastes' && !thermalPenaltyBlocked) {
      const penalty = tileData.penalty || {};
      for (const [res, val] of Object.entries(penalty)) {
        delta[res] = (delta[res] || 0) + val; // val is already negative
      }
    }

    // Building production (check both BUILDINGS and BRANCH_RESEARCH_BUILDINGS).
    if (tile.building) {
      const bldData = BUILDINGS[tile.building] ||
        (typeof BRANCH_RESEARCH_BUILDINGS !== 'undefined' ? BRANCH_RESEARCH_BUILDINGS[tile.building] : null);
      if (bldData && bldData.production) {
        const scaledProd = {};
        for (const [res, val] of Object.entries(bldData.production)) {
          const mult = multipliers[res] !== undefined ? multipliers[res] : 1;
          scaledProd[res] = val * mult;
        }
        add(scaledProd);
      }
    }
  }

  // Apply faction start bonuses (from FACTIONS[civ.faction].startBonus).
  const faction = (typeof FACTIONS !== 'undefined') ? FACTIONS[civ.faction] : null;
  if (faction && faction.startBonus) {
    add(faction.startBonus);
  }

  // Apply branch proficiency bonuses: each point of proficiency adds a small
  // flat bonus to the primary resource associated with that branch.
  const BRANCH_RESOURCE_MAP = {
    archaeotech: 'research',
    logic:       'research',
    engineering: 'energy',
    computation: 'compute',
    networks:    'data',
    cognitive:   'research',
    quantum:     'quantum',
  };
  if (branchProficiency) {
    for (const [branch, level] of Object.entries(branchProficiency)) {
      const res = BRANCH_RESOURCE_MAP[branch];
      if (res && level > 0) {
        // Proficiency gives +0.1 per level of the associated resource per turn.
        delta[res] = (delta[res] || 0) + level * 0.1;
      }
    }
  }

  // Clamp all values to avoid floating-point noise below zero.
  for (const key of Object.keys(delta)) {
    delta[key] = Math.round(delta[key] * 10) / 10; // one decimal place
  }

  return delta;
}

// ---------------------------------------------------------------------------
// PATHFINDING  (BFS)
// ---------------------------------------------------------------------------

/**
 * Find a path from (startQ, startR) to (endQ, endR) using BFS.
 * Void zones and tiles occupied by enemy units are treated as impassable.
 *
 * @param {Map<string, Object>} mapTiles
 * @param {number} startQ
 * @param {number} startR
 * @param {number} endQ
 * @param {number} endR
 * @param {number} maxSteps - maximum BFS depth
 * @param {string|null} [movingCivId] - id of the moving civilization (to detect enemies)
 * @returns {Array<{q:number, r:number}>|null} - ordered list of steps (excluding start), or null
 */
function findPath(mapTiles, startQ, startR, endQ, endR, maxSteps, movingCivId) {
  const startKey = `${startQ},${startR}`;
  const endKey = `${endQ},${endR}`;

  if (startKey === endKey) return [];

  // Check that destination is reachable.
  const destTile = mapTiles.get(endKey);
  if (!destTile || destTile.type === 'void_zone') return null;

  const visited = new Set([startKey]);
  // Queue entries: { key, path }  where path is array of {q,r} excluding start.
  const queue = [{ key: startKey, q: startQ, r: startR, path: [] }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.path.length >= maxSteps) continue;

    for (const nb of hexNeighbors(current.q, current.r)) {
      const nbKey = `${nb.q},${nb.r}`;
      if (visited.has(nbKey)) continue;
      visited.add(nbKey);

      const nbTile = mapTiles.get(nbKey);
      if (!nbTile) continue; // Off the map edge.
      if (nbTile.type === 'void_zone') continue;

      // Treat tiles with enemy units as impassable (but allow entering the destination).
      if (nbKey !== endKey && movingCivId && nbTile.units && nbTile.units.length > 0) {
        const hasEnemy = nbTile.units.some(u => u.civId && u.civId !== movingCivId);
        if (hasEnemy) continue;
      }

      const newPath = current.path.concat({ q: nb.q, r: nb.r });

      if (nbKey === endKey) return newPath;

      queue.push({ key: nbKey, q: nb.q, r: nb.r, path: newPath });
    }
  }

  return null; // No path found within maxSteps.
}
