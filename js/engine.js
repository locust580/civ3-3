// =============================================================================
// Silicon Civilizations — Game Engine
// Core game logic: turn management, buildings, units, territory, diplomacy,
// bot AI, win conditions, and random events.
//
// Depends on (must be loaded first):
//   data.js    — FACTIONS, BUILDINGS, BRANCH_RESEARCH_BUILDINGS, UNIT_TYPES,
//               EVENTS, CONCEPTS, COMBINATIONS, FACTION_BRANCH_PROFICIENCY,
//               CLUSTER_TO_BRANCH, COMBO_FORMULA, BRANCH_DISTANCES
//   mapgen.js  — generateMap, findStartingPositions, initializeTerritory,
//               calculateCivResources, hexDistance, hexNeighbors, hexesInRadius
//   ideaspace.js — IdeaSpace
//
// Exports: window.GameEngine
// =============================================================================

// ---------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------

/** Lightweight UUID v4 substitute (no crypto dependency). */
function _uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Clamp a number between min and max.
 */
function _clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Return the research branch for a conceptId using CLUSTER_TO_BRANCH.
 */
function _branchForConcept(conceptId) {
  const concept = CONCEPTS[conceptId];
  if (!concept) return null;
  return CLUSTER_TO_BRANCH[concept.cluster] || null;
}

/**
 * Pick a random element from an array.
 */
function _randomFrom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get all buildings (BUILDINGS merged with BRANCH_RESEARCH_BUILDINGS).
 */
function _allBuildings() {
  return Object.assign({}, BUILDINGS, BRANCH_RESEARCH_BUILDINGS);
}

// ---------------------------------------------------------------------------
// GAME ENGINE
// ---------------------------------------------------------------------------

const GameEngine = {

  // -------------------------------------------------------------------------
  // CORE STATE
  // -------------------------------------------------------------------------

  /** @type {object|null} The full game state; set by init(). */
  state: null,

  // -------------------------------------------------------------------------
  // INIT
  // -------------------------------------------------------------------------

  /**
   * Initialise a new game.
   *
   * @param {string} playerFactionId   - key in FACTIONS
   * @param {number} [mapWidth=50]
   * @param {number} [mapHeight=35]
   * @param {number} [numBots=3]
   */
  init(playerFactionId, mapWidth = 50, mapHeight = 35, numBots = 3) {
    const totalCivs = numBots + 1;

    // 1. Generate the map.
    const map = generateMap(mapWidth, mapHeight, totalCivs);

    // 2. Find starting positions.
    const startPositions = findStartingPositions(map, mapWidth, mapHeight, totalCivs);

    // 3. Assign factions.
    const allFactionIds = Object.keys(FACTIONS);
    // Player gets the chosen faction.
    const remaining = allFactionIds.filter(f => f !== playerFactionId);
    // Shuffle remaining and take numBots.
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    const botFactionIds = remaining.slice(0, numBots);

    // Build ordered list: player first, then bots.
    const civFactions = [playerFactionId, ...botFactionIds];

    // 4. Create civilizations.
    const civs = {};
    const civIds = [];
    for (let i = 0; i < civFactions.length; i++) {
      const factionId = civFactions[i];
      const faction = FACTIONS[factionId];
      const isPlayer = i === 0;
      const civId = `civ_${factionId}_${i}`;
      civIds.push(civId);

      const branchProf = Object.assign({}, FACTION_BRANCH_PROFICIENCY[factionId] || {
        archaeotech: 0, logic: 0, engineering: 0,
        computation: 0, networks: 0, cognitive: 0, quantum: 0,
      });

      // 5. Starting resources.
      const resources = {
        energy: 15, silicon: 10, copper: 8, research: 20,
        data: 5, rareEarth: 2, quantum: 0, compute: 0, military: 0,
      };

      // 6. Starting concepts (discoveries).
      const discoveries = new Set(faction.starterConcepts || []);

      const startPos = startPositions[i] || { q: i * 5, r: 0 };

      civs[civId] = {
        id: civId,
        factionId,
        name: faction.name,
        color: faction.color,
        isAI: !isPlayer,
        isDefeated: false,
        capital: { q: startPos.q, r: startPos.r },
        resources,
        resourceIncome: {},
        buildings: new Map(),    // "q,r" -> buildingId
        units: [],
        discoveries,
        branchProficiency: branchProf,
        diplomacy: {},
        totalCompute: 0,
        turnsSinceExpansion: 0,
        aiMemory: {},
      };
    }

    // 7. Set diplomacy (all start neutral with each other).
    for (const civId of civIds) {
      for (const otherId of civIds) {
        if (otherId !== civId) {
          civs[civId].diplomacy[otherId] = 'neutral';
        }
      }
    }

    // 8. Initialize territory around each starting position (radius 2).
    initializeTerritory(map, startPositions, civIds);

    // 9. Place starting buildings on each capital.
    for (let i = 0; i < civIds.length; i++) {
      const civId = civIds[i];
      const { q, r } = startPositions[i];
      const key = `${q},${r}`;
      const tile = map.get(key);
      if (tile) {
        tile.owner = civId;
        // Place research_node and power_plant for free at start.
        tile.building = 'research_node';
        civs[civId].buildings.set(key, 'research_node');

        // Find an adjacent owned tile for the power plant.
        const neighbors = hexNeighbors(q, r);
        let plantPlaced = false;
        for (const nb of neighbors) {
          const nbKey = `${nb.q},${nb.r}`;
          const nbTile = map.get(nbKey);
          if (nbTile && nbTile.owner === civId && !nbTile.building && nbTile.type !== 'void_zone') {
            nbTile.building = 'power_plant';
            civs[civId].buildings.set(nbKey, 'power_plant');
            plantPlaced = true;
            break;
          }
        }
        if (!plantPlaced) {
          // Try any tile in radius 2 that is owned and empty.
          const nearby = hexesInRadius(q, r, 2);
          for (const nb of nearby) {
            if (nb.q === q && nb.r === r) continue;
            const nbKey = `${nb.q},${nb.r}`;
            const nbTile = map.get(nbKey);
            if (nbTile && nbTile.owner === civId && !nbTile.building && nbTile.type !== 'void_zone') {
              nbTile.building = 'power_plant';
              civs[civId].buildings.set(nbKey, 'power_plant');
              break;
            }
          }
        }
      }
    }

    // 10. Build initial state.
    const playerCivId = civIds[0];
    this.state = {
      turn: 1,
      phase: 'player',
      map,
      mapWidth,
      mapHeight,
      civs,
      playerCivId,
      activeEvents: [],
      eventHistory: [],
      eventCooldown: 0,
      winner: null,
      messageLog: [],
    };

    // 11. Initialise IdeaSpace for the player only.
    IdeaSpace.init(playerFactionId, civs[playerCivId].branchProficiency);
    // Sync player discoveries to IdeaSpace.
    for (const cId of civs[playerCivId].discoveries) {
      IdeaSpace.discover(cId);
    }

    // 12. Calculate initial resource income for all civs.
    for (const civId of civIds) {
      this.getResourceIncome(civId);
    }

    // 13. Reveal initial vision around each civ's starting territory.
    for (let i = 0; i < civIds.length; i++) {
      const civId = civIds[i];
      const civ = civs[civId];
      // Collect all owned tiles as vision positions.
      const positions = [];
      for (const [, tile] of map) {
        if (tile.owner === civId) positions.push({ q: tile.q, r: tile.r });
      }
      updateExploration(map, civId, positions, 2);
    }

    this.addMessage(`Game started. You lead ${FACTIONS[playerFactionId].name}. Good luck!`, 'success');

    return this.state;
  },

  // -------------------------------------------------------------------------
  // STATE ACCESSORS
  // -------------------------------------------------------------------------

  getCiv(civId) {
    return this.state.civs[civId];
  },

  getPlayerCiv() {
    return this.getCiv(this.state.playerCivId);
  },

  getTile(q, r) {
    return this.state.map.get(`${q},${r}`);
  },

  getAllCivIds() {
    return Object.keys(this.state.civs);
  },

  getLivingCivIds() {
    return this.getAllCivIds().filter(id => !this.getCiv(id).isDefeated);
  },

  // -------------------------------------------------------------------------
  // MESSAGING
  // -------------------------------------------------------------------------

  /**
   * Append a message to the log.
   * @param {string} text
   * @param {'info'|'warning'|'danger'|'success'} [type='info']
   */
  addMessage(text, type = 'info') {
    if (!this.state) return;
    this.state.messageLog.push({ turn: this.state.turn, text, type });
    // Keep log bounded.
    if (this.state.messageLog.length > 200) {
      this.state.messageLog.shift();
    }
  },

  // -------------------------------------------------------------------------
  // RESOURCE INCOME
  // -------------------------------------------------------------------------

  /**
   * Recalculate per-turn resource income for a civ and store it.
   * @param {string} civId
   * @returns {object} income delta
   */
  getResourceIncome(civId) {
    const civ = this.getCiv(civId);
    if (!civ) return {};
    const income = calculateCivResources(
      this.state.map,
      { id: civ.id, faction: civ.factionId },
      this.state.activeEvents.map(ae => ae.event),
      civ.branchProficiency
    );
    civ.resourceIncome = income;
    return income;
  },

  // -------------------------------------------------------------------------
  // TURN MANAGEMENT
  // -------------------------------------------------------------------------

  /**
   * End the player's turn, run bot turns, apply events, check win conditions,
   * and advance to the next turn.
   *
   * @returns {Array<object>} messages/events that occurred during processing
   */
  endPlayerTurn() {
    if (!this.state || this.state.phase !== 'player') return [];
    const occurred = [];

    this.state.phase = 'bot';

    // 1. Process player resource collection.
    this.processResourceCollection(this.state.playerCivId);

    // 2. Run bot turns.
    const botIds = this.getLivingCivIds().filter(id => id !== this.state.playerCivId);
    for (const botId of botIds) {
      this.processResourceCollection(botId);
      this.runBotTurn(botId);
    }

    // 3. Roll for random event.
    this.state.phase = 'event';
    if (this.state.eventCooldown <= 0) {
      const evt = this.rollForEvent();
      if (evt) {
        occurred.push({ type: 'event', event: evt });
        this.state.eventCooldown = 5 + Math.floor(Math.random() * 4); // 5-8 turns
      } else {
        // Countdown regardless so events don't cluster.
        this.state.eventCooldown = Math.floor(Math.random() * 3); // 0-2 turns gap
      }
    } else {
      this.state.eventCooldown--;
    }

    // 4. Tick down active events.
    this.tickActiveEvents();

    // 5. Check win conditions.
    const winResult = this.checkWinConditions();
    if (winResult) {
      this.state.winner = winResult;
      this.state.phase = 'ended';
      const winnerCiv = this.getCiv(winResult.winner);
      this.addMessage(
        `${winnerCiv ? winnerCiv.name : winResult.winner} wins via ${winResult.type} victory!`,
        'success'
      );
      occurred.push({ type: 'win', result: winResult });
      return occurred;
    }

    // 6. Recalculate income for next turn.
    for (const civId of this.getLivingCivIds()) {
      this.getResourceIncome(civId);
    }

    // 7. Reset unit action flags for the player.
    const playerCiv = this.getPlayerCiv();
    for (const unit of playerCiv.units) {
      unit.moved = false;
      unit.attacked = false;
    }

    // 8. Advance turn counter.
    this.state.turn++;
    this.state.phase = 'player';

    return occurred;
  },

  /**
   * Process resource collection for one civ.
   * Applies income, caps resources, subtracts energy upkeep for units.
   * @param {string} civId
   */
  processResourceCollection(civId) {
    const civ = this.getCiv(civId);
    if (!civ || civ.isDefeated) return;

    const income = this.getResourceIncome(civId);

    // Apply income.
    for (const [res, val] of Object.entries(income)) {
      civ.resources[res] = (civ.resources[res] || 0) + val;
    }

    // Cap resources.
    const CAPS = {
      energy: 200, silicon: 200, copper: 200, research: 200,
      data: 200, rareEarth: 200, military: 200, compute: 200,
      quantum: 50,
    };
    for (const [res, cap] of Object.entries(CAPS)) {
      if (civ.resources[res] > cap) civ.resources[res] = cap;
    }

    // Energy upkeep: 1 energy per unit.
    const unitCount = civ.units.length;
    civ.resources.energy = (civ.resources.energy || 0) - unitCount;

    // Energy deficit: units start dying.
    if (civ.resources.energy < 0) {
      const deficit = Math.abs(civ.resources.energy);
      civ.resources.energy = 0;
      // Kill one unit per 3 deficit, minimum 1.
      const unitsToKill = Math.max(1, Math.floor(deficit / 3));
      for (let i = 0; i < unitsToKill && civ.units.length > 0; i++) {
        const dying = civ.units.splice(0, 1)[0];
        // Remove from tile.
        const tile = this.getTile(dying.q, dying.r);
        if (tile) {
          tile.units = tile.units.filter(u => u.id !== dying.id);
        }
        this.addMessage(
          `${civ.name}: a ${dying.type} disbanded due to energy shortage.`,
          'warning'
        );
      }
    }

    // Accumulate compute score.
    civ.totalCompute += (civ.resources.compute || 0);
    civ.turnsSinceExpansion++;

    // Update exploration vision for this civ (owned tiles + units).
    const visionPositions = [];
    for (const [, tile] of this.state.map) {
      if (tile.owner === civId) visionPositions.push({ q: tile.q, r: tile.r });
    }
    for (const unit of civ.units) {
      visionPositions.push({ q: unit.q, r: unit.r });
    }
    updateExploration(this.state.map, civId, visionPositions, 2);
  },

  // -------------------------------------------------------------------------
  // BUILDING SYSTEM
  // -------------------------------------------------------------------------

  /**
   * Build a building on a tile.
   *
   * @param {string} civId
   * @param {number} q
   * @param {number} r
   * @param {string} buildingId
   * @returns {{ success: boolean, message: string }}
   */
  buildOnTile(civId, q, r, buildingId) {
    const civ = this.getCiv(civId);
    if (!civ) return { success: false, message: 'Civilization not found.' };

    const tile = this.getTile(q, r);
    if (!tile) return { success: false, message: 'Tile not found.' };
    if (tile.type === 'void_zone') return { success: false, message: 'Cannot build on a void zone.' };
    if (tile.owner !== civId) return { success: false, message: 'You do not control this tile.' };
    if (tile.building) return { success: false, message: 'This tile already has a building.' };

    const allBldgs = _allBuildings();
    const bldg = allBldgs[buildingId];
    if (!bldg) return { success: false, message: `Unknown building: ${buildingId}.` };

    // Check concept requirements.
    if (bldg.requires && bldg.requires.length > 0) {
      for (const reqConcept of bldg.requires) {
        if (!civ.discoveries.has(reqConcept)) {
          const conceptName = CONCEPTS[reqConcept] ? CONCEPTS[reqConcept].name : reqConcept;
          return { success: false, message: `Requires concept: ${conceptName}.` };
        }
      }
    }

    // Check and deduct resource cost.
    const cost = bldg.cost || {};
    for (const [res, amount] of Object.entries(cost)) {
      if ((civ.resources[res] || 0) < amount) {
        return {
          success: false,
          message: `Not enough ${res}. Need ${amount}, have ${civ.resources[res] || 0}.`,
        };
      }
    }
    for (const [res, amount] of Object.entries(cost)) {
      civ.resources[res] -= amount;
    }

    // Place building.
    tile.building = buildingId;
    civ.buildings.set(`${q},${r}`, buildingId);

    // Boost branch proficiency if this is a branch research building.
    if (bldg.branchBoost) {
      const { branch, amount } = bldg.branchBoost;
      if (branch === 'all') {
        // +amount to all branches.
        for (const br of Object.keys(civ.branchProficiency)) {
          civ.branchProficiency[br] = Math.min(10, (civ.branchProficiency[br] || 0) + amount);
        }
      } else {
        civ.branchProficiency[branch] = Math.min(
          10,
          (civ.branchProficiency[branch] || 0) + amount
        );
      }
    }

    // Recalculate income.
    this.getResourceIncome(civId);

    this.addMessage(`${civ.name} built ${bldg.name} at (${q},${r}).`, 'info');
    return { success: true, message: `${bldg.name} constructed.` };
  },

  /**
   * Demolish a building, refunding 30% of its cost.
   *
   * @param {string} civId
   * @param {number} q
   * @param {number} r
   * @returns {{ success: boolean, message: string }}
   */
  demolishBuilding(civId, q, r) {
    const civ = this.getCiv(civId);
    if (!civ) return { success: false, message: 'Civilization not found.' };

    const tile = this.getTile(q, r);
    if (!tile || !tile.building) return { success: false, message: 'No building here.' };
    if (tile.owner !== civId) return { success: false, message: 'You do not control this tile.' };

    const allBldgs = _allBuildings();
    const bldg = allBldgs[tile.building];
    const bldgName = bldg ? bldg.name : tile.building;

    // Refund 30% of cost.
    if (bldg && bldg.cost) {
      for (const [res, amount] of Object.entries(bldg.cost)) {
        civ.resources[res] = Math.min(200, (civ.resources[res] || 0) + Math.floor(amount * 0.3));
      }
    }

    civ.buildings.delete(`${q},${r}`);
    tile.building = null;

    this.getResourceIncome(civId);
    this.addMessage(`${civ.name} demolished ${bldgName} at (${q},${r}).`, 'info');
    return { success: true, message: `${bldgName} demolished (30% resources refunded).` };
  },

  // -------------------------------------------------------------------------
  // UNIT SYSTEM
  // -------------------------------------------------------------------------

  /**
   * Train a unit on a tile owned by the civ.
   *
   * @param {string} civId
   * @param {number} q
   * @param {number} r
   * @param {string} unitTypeId
   * @returns {{ success: boolean, message: string, unit?: object }}
   */
  trainUnit(civId, q, r, unitTypeId) {
    const civ = this.getCiv(civId);
    if (!civ) return { success: false, message: 'Civilization not found.' };

    const tile = this.getTile(q, r);
    if (!tile) return { success: false, message: 'Tile not found.' };
    if (tile.owner !== civId) return { success: false, message: 'You do not control this tile.' };
    if (tile.type === 'void_zone') return { success: false, message: 'Cannot train on void zone.' };

    const unitType = UNIT_TYPES[unitTypeId];
    if (!unitType) return { success: false, message: `Unknown unit type: ${unitTypeId}.` };

    // Check concept requirements.
    if (unitType.requires && unitType.requires.length > 0) {
      for (const reqConcept of unitType.requires) {
        if (!civ.discoveries.has(reqConcept)) {
          const conceptName = CONCEPTS[reqConcept] ? CONCEPTS[reqConcept].name : reqConcept;
          return { success: false, message: `Requires concept: ${conceptName}.` };
        }
      }
    }

    // Check resources.
    const cost = unitType.cost || {};
    for (const [res, amount] of Object.entries(cost)) {
      if ((civ.resources[res] || 0) < amount) {
        return {
          success: false,
          message: `Not enough ${res}. Need ${amount}, have ${civ.resources[res] || 0}.`,
        };
      }
    }
    for (const [res, amount] of Object.entries(cost)) {
      civ.resources[res] -= amount;
    }

    const unit = {
      id: _uuid(),
      type: unitTypeId,
      civId,
      q,
      r,
      health: unitType.defense * 5 + 10,   // rough max health
      maxHealth: unitType.defense * 5 + 10,
      attack: unitType.attack,
      defense: unitType.defense,
      movement: unitType.movement,
      moved: false,
      attacked: false,
    };

    civ.units.push(unit);
    tile.units.push(unit);

    this.addMessage(`${civ.name} trained a ${unitType.name} at (${q},${r}).`, 'info');
    return { success: true, message: `${unitType.name} trained.`, unit };
  },

  /**
   * Move a unit to a target hex.
   * If the target has an enemy unit, triggers combat.
   * If the target is unoccupied enemy territory, captures it.
   *
   * @param {string} civId
   * @param {string} unitId
   * @param {number} targetQ
   * @param {number} targetR
   * @returns {{ success: boolean, moved: boolean, combat: boolean, message: string }}
   */
  moveUnit(civId, unitId, targetQ, targetR) {
    const civ = this.getCiv(civId);
    if (!civ) return { success: false, moved: false, combat: false, message: 'Civ not found.' };

    const unit = civ.units.find(u => u.id === unitId);
    if (!unit) return { success: false, moved: false, combat: false, message: 'Unit not found.' };
    if (unit.moved) return { success: false, moved: false, combat: false, message: 'Unit already moved this turn.' };

    const targetTile = this.getTile(targetQ, targetR);
    if (!targetTile) return { success: false, moved: false, combat: false, message: 'Target tile not found.' };
    if (targetTile.type === 'void_zone') return { success: false, moved: false, combat: false, message: 'Cannot enter void zone.' };

    // Pathfinding.
    const path = findPath(
      this.state.map,
      unit.q, unit.r,
      targetQ, targetR,
      unit.movement,
      civId
    );

    if (path === null || path.length > unit.movement) {
      return { success: false, moved: false, combat: false, message: 'Cannot reach target within movement range.' };
    }

    // Check for enemy units on target.
    const enemyUnits = (targetTile.units || []).filter(u => u.civId !== civId);
    if (enemyUnits.length > 0) {
      // Trigger combat — attacker stays in place unless defender dies.
      const combatResult = this.attackWith(civId, unitId, targetQ, targetR);
      return {
        success: combatResult.success,
        moved: combatResult.defenderDied && !combatResult.attackerDied,
        combat: true,
        message: combatResult.success
          ? `Combat at (${targetQ},${targetR}): dealt ${combatResult.attackDmg} dmg, took ${combatResult.defenseDmg} dmg.`
          : combatResult.message || 'Combat error.',
        combatResult,
      };
    }

    // Move the unit.
    const sourceTile = this.getTile(unit.q, unit.r);
    if (sourceTile) {
      sourceTile.units = sourceTile.units.filter(u => u.id !== unitId);
    }
    unit.q = targetQ;
    unit.r = targetR;
    unit.moved = true;
    targetTile.units.push(unit);

    // Capture unowned / enemy territory.
    if (targetTile.owner !== civId) {
      const previousOwner = targetTile.owner;
      this.setTileOwner(targetQ, targetR, civId);
      if (previousOwner) {
        this.addMessage(
          `${civ.name} captured tile (${targetQ},${targetR}) from ${this._civName(previousOwner)}.`,
          'warning'
        );
      }
    }

    return { success: true, moved: true, combat: false, message: `Unit moved to (${targetQ},${targetR}).` };
  },

  /**
   * Resolve combat between an attacker unit and defenders on a tile.
   *
   * @param {string} civId      - attacking civilization
   * @param {string} unitId     - attacking unit id
   * @param {number} targetQ
   * @param {number} targetR
   * @returns {{
   *   success: boolean,
   *   attackDmg: number,
   *   defenseDmg: number,
   *   attackerDied: boolean,
   *   defenderDied: boolean,
   *   message?: string
   * }}
   */
  attackWith(civId, unitId, targetQ, targetR) {
    const civ = this.getCiv(civId);
    if (!civ) return { success: false, attackDmg: 0, defenseDmg: 0, attackerDied: false, defenderDied: false, message: 'Civ not found.' };

    const attacker = civ.units.find(u => u.id === unitId);
    if (!attacker) return { success: false, attackDmg: 0, defenseDmg: 0, attackerDied: false, defenderDied: false, message: 'Attacker not found.' };
    if (attacker.attacked) return { success: false, attackDmg: 0, defenseDmg: 0, attackerDied: false, defenderDied: false, message: 'Unit already attacked this turn.' };

    const targetTile = this.getTile(targetQ, targetR);
    if (!targetTile) return { success: false, attackDmg: 0, defenseDmg: 0, attackerDied: false, defenderDied: false, message: 'Target tile not found.' };

    const defender = (targetTile.units || []).find(u => u.civId !== civId);
    if (!defender) return { success: false, attackDmg: 0, defenseDmg: 0, attackerDied: false, defenderDied: false, message: 'No enemy unit at target.' };

    // Tech bonuses.
    let techBonus = 0;
    if (civ.discoveries.has('integrated_circuit')) techBonus += 2;
    if (civ.discoveries.has('microprocessor')) techBonus += 1;
    if (civ.discoveries.has('reinforcement_learning')) techBonus += 3;
    if (civ.discoveries.has('agi')) techBonus += 5;

    let defenseBonus = 0;
    const defenderCiv = this.getCiv(defender.civId);
    if (defenderCiv) {
      if (defenderCiv.discoveries.has('encryption')) defenseBonus += 2;
      if (defenderCiv.discoveries.has('integrated_circuit')) defenseBonus += 1;
    }
    // Defense array on the tile.
    if (targetTile.building === 'defense_array') defenseBonus += 5;

    const attackRoll = attacker.attack * (0.8 + Math.random() * 0.4) + techBonus;
    const defenseRoll = defender.defense * (0.8 + Math.random() * 0.4) + defenseBonus;

    const attackDmg = Math.round(attackRoll);
    const defenseDmg = Math.round(defenseRoll / 3);

    defender.health -= attackDmg;
    attacker.health -= defenseDmg;
    attacker.attacked = true;

    let defenderDied = false;
    let attackerDied = false;

    if (defender.health <= 0) {
      defenderDied = true;
      // Remove defender from tile and from its civ's units array.
      targetTile.units = targetTile.units.filter(u => u.id !== defender.id);
      if (defenderCiv) {
        defenderCiv.units = defenderCiv.units.filter(u => u.id !== defender.id);
      }

      // Attacker may advance onto the tile.
      if (!attackerDied) {
        const sourceTile = this.getTile(attacker.q, attacker.r);
        if (sourceTile) {
          sourceTile.units = sourceTile.units.filter(u => u.id !== attacker.id);
        }
        attacker.q = targetQ;
        attacker.r = targetR;
        attacker.moved = true;
        targetTile.units.push(attacker);

        if (targetTile.owner !== civId) {
          this.setTileOwner(targetQ, targetR, civId);
        }
      }
    }

    if (attacker.health <= 0) {
      attackerDied = true;
      const sourceTile = this.getTile(attacker.q, attacker.r);
      if (sourceTile) {
        sourceTile.units = sourceTile.units.filter(u => u.id !== attacker.id);
      }
      civ.units = civ.units.filter(u => u.id !== attacker.id);
    }

    this.addMessage(
      `Combat (${civId} vs ${defender.civId}): dealt ${attackDmg} dmg, took ${defenseDmg} dmg.` +
      (defenderDied ? ' Defender destroyed!' : '') +
      (attackerDied ? ' Attacker destroyed!' : ''),
      defenderDied || attackerDied ? 'danger' : 'warning'
    );

    return { success: true, attackDmg, defenseDmg, attackerDied, defenderDied };
  },

  // -------------------------------------------------------------------------
  // TERRITORY
  // -------------------------------------------------------------------------

  /**
   * Change the owner of a tile. Checks if the old owner is now defeated.
   *
   * @param {number} q
   * @param {number} r
   * @param {string} civId
   */
  setTileOwner(q, r, civId) {
    const tile = this.getTile(q, r);
    if (!tile) return;

    const previousOwner = tile.owner;
    tile.owner = civId;

    // Buildings stay (conquered) — ownership of tile changes but building remains.
    // If old owner, update their buildings Map to remove key
    // (new owner "captures" it in place — building is still on map tile).
    if (previousOwner && previousOwner !== civId) {
      const oldCiv = this.getCiv(previousOwner);
      if (oldCiv) {
        const key = `${q},${r}`;
        // Transfer building ownership to captor if building belongs to loser.
        if (oldCiv.buildings.has(key)) {
          oldCiv.buildings.delete(key);
          // Add to new owner's buildings map.
          const newCiv = this.getCiv(civId);
          if (newCiv && tile.building) {
            newCiv.buildings.set(key, tile.building);
          }
        }

        // Check if old civ now has no tiles left.
        let hasTerritory = false;
        for (const [, t] of this.state.map) {
          if (t.owner === previousOwner) {
            hasTerritory = true;
            break;
          }
        }
        if (!hasTerritory && !oldCiv.isDefeated) {
          this._defeatCiv(civId, previousOwner);
        }
      }
    }

    this.getResourceIncome(civId);
    if (previousOwner && previousOwner !== civId) {
      const prevCiv = this.getCiv(previousOwner);
      if (prevCiv && !prevCiv.isDefeated) {
        this.getResourceIncome(previousOwner);
      }
    }
  },

  /**
   * Claim an unowned adjacent tile (costs 5 silicon).
   *
   * @param {string} civId
   * @param {number} q
   * @param {number} r
   * @returns {{ success: boolean, message: string }}
   */
  expandTerritory(civId, q, r) {
    const civ = this.getCiv(civId);
    if (!civ) return { success: false, message: 'Civ not found.' };

    const tile = this.getTile(q, r);
    if (!tile) return { success: false, message: 'Tile not found.' };
    if (tile.owner !== null) return { success: false, message: 'Tile already claimed.' };
    if (tile.type === 'void_zone') return { success: false, message: 'Cannot claim void zone.' };

    // Must be adjacent to an owned tile.
    const neighbors = hexNeighbors(q, r);
    const adjacentOwned = neighbors.some(nb => {
      const nbTile = this.getTile(nb.q, nb.r);
      return nbTile && nbTile.owner === civId;
    });
    if (!adjacentOwned) return { success: false, message: 'Tile must be adjacent to your territory.' };

    if ((civ.resources.silicon || 0) < 5) {
      return { success: false, message: 'Not enough silicon (need 5).' };
    }

    civ.resources.silicon -= 5;
    tile.owner = civId;
    civ.turnsSinceExpansion = 0;
    this.getResourceIncome(civId);

    return { success: true, message: `Territory expanded to (${q},${r}).` };
  },

  // -------------------------------------------------------------------------
  // DIPLOMACY
  // -------------------------------------------------------------------------

  /**
   * Declare war between two civs.
   *
   * @param {string} aggressorCivId
   * @param {string} targetCivId
   */
  declareWar(aggressorCivId, targetCivId) {
    const aggressor = this.getCiv(aggressorCivId);
    const target = this.getCiv(targetCivId);
    if (!aggressor || !target) return;
    aggressor.diplomacy[targetCivId] = 'war';
    target.diplomacy[aggressorCivId] = 'war';
    this.addMessage(
      `${aggressor.name} declares war on ${target.name}!`,
      'danger'
    );
  },

  /**
   * Propose peace between two civs.
   * AI auto-accepts if it is losing badly (< 50% tiles vs aggressor).
   *
   * @param {string} civId1
   * @param {string} civId2
   * @returns {{ accepted: boolean, message: string }}
   */
  proposePeace(civId1, civId2) {
    const civ1 = this.getCiv(civId1);
    const civ2 = this.getCiv(civId2);
    if (!civ1 || !civ2) return { accepted: false, message: 'Civ not found.' };

    // If civ2 is AI, decide whether to accept.
    let accepted = true;
    if (civ2.isAI) {
      const tiles1 = this._countTiles(civId1);
      const tiles2 = this._countTiles(civId2);
      // Accept if civ2 is clearly losing (fewer than 60% of civ1's tiles).
      accepted = tiles2 < tiles1 * 0.6;
    }

    if (accepted) {
      civ1.diplomacy[civId2] = 'peace';
      civ2.diplomacy[civId1] = 'peace';
      this.addMessage(`${civ1.name} and ${civ2.name} agree to peace.`, 'success');
    } else {
      this.addMessage(`${civ2.name} rejects ${civ1.name}'s peace proposal.`, 'warning');
    }

    return { accepted, message: accepted ? 'Peace agreed.' : 'Peace rejected.' };
  },

  // -------------------------------------------------------------------------
  // BOT AI
  // -------------------------------------------------------------------------

  /**
   * Run a single bot turn.
   * @param {string} civId
   */
  runBotTurn(civId) {
    const civ = this.getCiv(civId);
    if (!civ || civ.isDefeated) return;

    // Reset unit action flags.
    for (const unit of civ.units) {
      unit.moved = false;
      unit.attacked = false;
    }

    const res = civ.resources;

    // --- Priority 1: Energy deficit — build power plant. ---
    if ((res.energy || 0) < 5) {
      const result = this.botChooseBuilding(civ, 'power_plant');
      if (result && result.success) return;
    }

    // --- Priority 2: No research node — build one. ---
    const hasResearchNode = Array.from(civ.buildings.values()).includes('research_node');
    if (!hasResearchNode) {
      const result = this.botChooseBuilding(civ, 'research_node');
      if (result && result.success) return;
    }

    // --- Priority 3: Attempt concept combination if 2+ known concepts. ---
    if (civ.discoveries.size >= 2) {
      this.botChooseCombination(civ);
    }

    // --- Priority 4: Expand territory. ---
    if (civ.turnsSinceExpansion >= 3 && (res.silicon || 0) >= 5) {
      const expanded = this.botChooseExpansion(civ);
      if (expanded) {
        civ.turnsSinceExpansion = 0;
      }
    }

    // --- Priority 5: Build military if threatened. ---
    const livingCivs = this.getLivingCivIds();
    const atWar = livingCivs.some(id => id !== civId && civ.diplomacy[id] === 'war');
    if (atWar && civ.units.length < 3) {
      this.botChooseBuilding(civ, 'military_forge');
      // Try to train a warrior.
      this._botTrainUnit(civ, 'warrior');
    }

    // --- Priority 6: Attack weakest neighbor if at war. ---
    if (atWar) {
      this.botChooseMilitaryTarget(civ);
    }

    // --- Priority 7: Declare war if turn > 15 and strong enough. ---
    if (this.state.turn > 15 && !atWar) {
      const myTiles = this._countTiles(civId);
      // Only declare war if at least as large as the smallest rival.
      const rivals = livingCivs.filter(id => id !== civId);
      if (rivals.length > 0) {
        rivals.sort((a, b) => this._countTiles(a) - this._countTiles(b));
        const weakest = rivals[0];
        const weakestTiles = this._countTiles(weakest);
        if (myTiles >= weakestTiles && Math.random() < 0.15) {
          this.declareWar(civId, weakest);
        }
      }
    }

    // --- Build something generally useful if resources permit. ---
    this.botChooseBuilding(civ);
  },

  /**
   * Bot building choice. Optionally prefer a specific building.
   * Tries to build the preferred building, or picks the best one affordable.
   *
   * @param {object} civ
   * @param {string|null} [preferred=null]
   * @returns {{ success: boolean }|null}
   */
  botChooseBuilding(civ, preferred = null) {
    const allBldgs = _allBuildings();

    // Find candidate tiles: owned, no building, not void.
    const candidateTiles = [];
    for (const [, tile] of this.state.map) {
      if (tile.owner === civ.id && !tile.building && tile.type !== 'void_zone') {
        candidateTiles.push(tile);
      }
    }
    if (candidateTiles.length === 0) return null;

    const tile = _randomFrom(candidateTiles);

    // Priority: preferred, then building that matches faction's top branch.
    const buildingOrder = preferred
      ? [preferred]
      : this._botBuildingPriority(civ);

    for (const bldgId of buildingOrder) {
      const bldg = allBldgs[bldgId];
      if (!bldg) continue;

      // Check requirements.
      if (bldg.requires && bldg.requires.length > 0) {
        const hasAll = bldg.requires.every(c => civ.discoveries.has(c));
        if (!hasAll) continue;
      }

      // Check cost.
      const canAfford = Object.entries(bldg.cost || {}).every(
        ([res, amt]) => (civ.resources[res] || 0) >= amt
      );
      if (!canAfford) continue;

      return this.buildOnTile(civ.id, tile.q, tile.r, bldgId);
    }

    return null;
  },

  /**
   * Pick two known concepts to try combining.
   * Prioritises the faction's strongest branch.
   *
   * @param {object} civ
   */
  botChooseCombination(civ) {
    const knownIds = Array.from(civ.discoveries);
    if (knownIds.length < 2) return;

    // Find all valid combinations where both ingredients are known.
    const available = COMBINATIONS.filter(combo => {
      const [a, b] = combo.ingredients;
      return civ.discoveries.has(a) && civ.discoveries.has(b) && !civ.discoveries.has(combo.result);
    });

    if (available.length === 0) return;

    // Sort by faction branch preference.
    const topBranch = this._botTopBranch(civ);
    available.sort((comboA, comboB) => {
      const scoreCombo = (c) => {
        const brA = _branchForConcept(c.ingredients[0]);
        const brB = _branchForConcept(c.ingredients[1]);
        return (brA === topBranch ? 1 : 0) + (brB === topBranch ? 1 : 0);
      };
      return scoreCombo(comboB) - scoreCombo(comboA);
    });

    const combo = available[0];
    const [idA, idB] = combo.ingredients;

    // Calculate cost.
    const branchA = _branchForConcept(idA);
    const branchB = _branchForConcept(idB);
    const profA = branchA ? (civ.branchProficiency[branchA] || 0) : 0;
    const profB = branchB ? (civ.branchProficiency[branchB] || 0) : 0;
    const avgProf = (profA + profB) / 2;
    const costReduction = (avgProf / 10) * COMBO_FORMULA.maxCostReduction;
    const actualCost = Math.round(combo.researchCost * (1 - costReduction));

    if ((civ.resources.research || 0) < actualCost) return;

    // Roll for success.
    let dist = 0;
    if (branchA && branchB && BRANCH_DISTANCES[branchA]) {
      dist = BRANCH_DISTANCES[branchA][branchB] || 0;
    }
    const successChance = _clamp(
      COMBO_FORMULA.baseSuccessChance
      + (profA + profB) * COMBO_FORMULA.proficiencyBonusPerPoint
      - dist * COMBO_FORMULA.distancePenaltyPerUnit,
      COMBO_FORMULA.minSuccessChance,
      COMBO_FORMULA.maxSuccessChance
    );

    civ.resources.research -= actualCost;

    if (Math.random() <= successChance) {
      const resultId = combo.result;

      // Inject dynamic concept if needed.
      if (combo.newConcept && !CONCEPTS[combo.newConcept.id]) {
        CONCEPTS[combo.newConcept.id] = combo.newConcept;
      }

      civ.discoveries.add(resultId);

      // Update proficiency.
      if (branchA) {
        civ.branchProficiency[branchA] = Math.min(10, (civ.branchProficiency[branchA] || 0) + 0.5);
      }
      if (branchB && branchB !== branchA) {
        civ.branchProficiency[branchB] = Math.min(10, (civ.branchProficiency[branchB] || 0) + 0.5);
      }

      const conceptName = CONCEPTS[resultId] ? CONCEPTS[resultId].name : resultId;
      this.addMessage(`${civ.name} discovered ${conceptName}!`, 'info');
    }
  },

  /**
   * Bot attempts to expand to an adjacent unowned tile.
   *
   * @param {object} civ
   * @returns {boolean} true if expanded successfully
   */
  botChooseExpansion(civ) {
    for (const [, tile] of this.state.map) {
      if (tile.owner !== civ.id) continue;
      const neighbors = hexNeighbors(tile.q, tile.r);
      for (const nb of neighbors) {
        const nbTile = this.getTile(nb.q, nb.r);
        if (nbTile && nbTile.owner === null && nbTile.type !== 'void_zone') {
          const result = this.expandTerritory(civ.id, nb.q, nb.r);
          if (result.success) return true;
        }
      }
    }
    return false;
  },

  /**
   * Bot chooses a military target: the weakest adjacent enemy unit.
   *
   * @param {object} civ
   */
  botChooseMilitaryTarget(civ) {
    for (const unit of civ.units) {
      if (unit.attacked) continue;

      const neighbors = hexNeighbors(unit.q, unit.r);
      let bestTarget = null;
      let bestHealth = Infinity;

      for (const nb of neighbors) {
        const nbTile = this.getTile(nb.q, nb.r);
        if (!nbTile) continue;
        for (const enemy of (nbTile.units || [])) {
          if (enemy.civId !== civ.id && civ.diplomacy[enemy.civId] === 'war') {
            if (enemy.health < bestHealth) {
              bestHealth = enemy.health;
              bestTarget = { q: nb.q, r: nb.r };
            }
          }
        }
      }

      if (bestTarget) {
        this.attackWith(civ.id, unit.id, bestTarget.q, bestTarget.r);
      }
    }
  },

  // -------------------------------------------------------------------------
  // WIN CONDITIONS
  // -------------------------------------------------------------------------

  /**
   * Check whether any win condition has been triggered.
   * @returns {{ winner: string, type: 'tech'|'military' }|null}
   */
  checkWinConditions() {
    const living = this.getLivingCivIds();

    // Military victory: only one civ left.
    if (living.length === 1) {
      return { winner: living[0], type: 'military' };
    }

    // Tech victory: any civ has discovered agi or consciousness_upload.
    for (const civId of living) {
      const civ = this.getCiv(civId);
      if (civ.discoveries.has('agi') || civ.discoveries.has('consciousness_upload')) {
        return { winner: civId, type: 'tech' };
      }
    }

    // Also check player via IdeaSpace.
    if (
      IdeaSpace.discoveredConcepts.has('agi') ||
      IdeaSpace.discoveredConcepts.has('consciousness_upload')
    ) {
      return { winner: this.state.playerCivId, type: 'tech' };
    }

    return null;
  },

  // -------------------------------------------------------------------------
  // RANDOM EVENTS
  // -------------------------------------------------------------------------

  /**
   * Maybe trigger a random event based on probability weights.
   * @returns {object|null} triggered event or null
   */
  rollForEvent() {
    // Sum probabilities and roll.
    const roll = Math.random();
    let cumulative = 0;
    for (const evt of EVENTS) {
      cumulative += evt.probability;
      if (roll < cumulative) {
        // Determine target civ (some events are global, some targeted).
        const targetCivId = _randomFrom(this.getLivingCivIds());
        this.applyEventEffect(evt, targetCivId);
        this.state.eventHistory.push({ turn: this.state.turn, event: evt, targetCivId });
        this.addMessage(`EVENT: ${evt.name} — ${evt.description}`, 'warning');
        return evt;
      }
    }
    return null;
  },

  /**
   * Apply the immediate and duration effects of an event.
   *
   * @param {object} evt          - event definition from EVENTS
   * @param {string|null} targetCivId - targeted civ (null = affects all)
   */
  applyEventEffect(evt, targetCivId = null) {
    const ef = evt.effect || {};
    const targets = targetCivId
      ? [targetCivId]
      : this.getLivingCivIds();

    for (const civId of targets) {
      const civ = this.getCiv(civId);
      if (!civ) continue;

      // Immediate resource windfalls.
      const IMMEDIATE_RESOURCES = ['data', 'research', 'rareEarth', 'silicon', 'energy', 'compute', 'military'];
      for (const res of IMMEDIATE_RESOURCES) {
        if (ef[res] != null) {
          civ.resources[res] = Math.min(200, (civ.resources[res] || 0) + ef[res]);
        }
      }

      // Special effects.
      if (ef.random_concept) {
        // Grant a random tier-3 concept the civ doesn't already have.
        const tier3Concepts = Object.values(CONCEPTS).filter(
          c => c.tier === 3 && !civ.discoveries.has(c.id)
        );
        if (tier3Concepts.length > 0) {
          const picked = _randomFrom(tier3Concepts);
          civ.discoveries.add(picked.id);
          this.addMessage(`${civ.name} gained ${picked.name} from the AI Breakthrough!`, 'success');
        }
      }

      if (ef.tier1_concept) {
        // Grant a random tier-1 concept not yet known.
        const tier1Concepts = Object.values(CONCEPTS).filter(
          c => c.tier === 1 && !civ.discoveries.has(c.id)
        );
        if (tier1Concepts.length > 0) {
          const picked = _randomFrom(tier1Concepts);
          civ.discoveries.add(picked.id);
          this.addMessage(`${civ.name} gained ${picked.name} from an Ancient Discovery!`, 'success');
        }
      }

      if (ef.destroy_building) {
        // Destroy a random building owned by the civ.
        const keys = Array.from(civ.buildings.keys());
        if (keys.length > 0) {
          const key = _randomFrom(keys);
          const tile = this.state.map.get(key);
          if (tile) tile.building = null;
          civ.buildings.delete(key);
          this.addMessage(`${civ.name} lost a building to the Logic Virus!`, 'danger');
        }
      }

      if (ef.unit_damage != null) {
        // Deal damage to all units.
        for (const unit of [...civ.units]) {
          unit.health -= ef.unit_damage;
          if (unit.health <= 0) {
            const tile = this.getTile(unit.q, unit.r);
            if (tile) tile.units = tile.units.filter(u => u.id !== unit.id);
            civ.units = civ.units.filter(u => u.id !== unit.id);
          }
        }
      }
    }

    // Duration effects are tracked in state.activeEvents.
    if (ef.duration != null && ef.duration > 0) {
      this.state.activeEvents.push({
        event: evt,
        turnsRemaining: ef.duration,
        targetCivId,
      });
    }
  },

  /**
   * Decrement turnsRemaining on active events; remove expired ones.
   */
  tickActiveEvents() {
    for (const ae of this.state.activeEvents) {
      ae.turnsRemaining--;
    }
    const expired = this.state.activeEvents.filter(ae => ae.turnsRemaining <= 0);
    for (const ae of expired) {
      this.addMessage(`Event "${ae.event.name}" has ended.`, 'info');
    }
    this.state.activeEvents = this.state.activeEvents.filter(ae => ae.turnsRemaining > 0);
  },

  // -------------------------------------------------------------------------
  // CONCEPT DISCOVERY (from combat)
  // -------------------------------------------------------------------------

  /**
   * Called when a civ is defeated. The defeater absorbs some concepts.
   *
   * @param {string} defeaterCivId
   * @param {string} defeatedCivId
   */
  onCivDefeated(defeaterCivId, defeatedCivId) {
    const defeater = this.getCiv(defeaterCivId);
    const defeated = this.getCiv(defeatedCivId);
    if (!defeater || !defeated) return;

    // Pick 2-3 random concepts from defeated that defeater doesn't have.
    const transferable = Array.from(defeated.discoveries).filter(
      id => !defeater.discoveries.has(id) && CONCEPTS[id]
    );
    const count = Math.min(transferable.length, 2 + Math.floor(Math.random() * 2));

    // Shuffle and take `count`.
    for (let i = transferable.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [transferable[i], transferable[j]] = [transferable[j], transferable[i]];
    }
    const absorbed = transferable.slice(0, count);

    for (const conceptId of absorbed) {
      defeater.discoveries.add(conceptId);
      // If defeater is the player, also add to IdeaSpace.
      if (defeaterCivId === this.state.playerCivId) {
        IdeaSpace.discover(conceptId);
      }
      const conceptName = CONCEPTS[conceptId] ? CONCEPTS[conceptId].name : conceptId;
      this.addMessage(
        `${defeater.name} absorbed knowledge: ${conceptName} from ${defeated.name}.`,
        'success'
      );
    }

    // Defeater gains +1 to each branch where defeated had higher proficiency.
    for (const [branch, level] of Object.entries(defeated.branchProficiency)) {
      if ((level || 0) > (defeater.branchProficiency[branch] || 0)) {
        defeater.branchProficiency[branch] = Math.min(
          10,
          ((defeater.branchProficiency[branch] || 0) + 1)
        );
      }
    }

    this.addMessage(
      `${defeater.name} absorbed ${absorbed.length} concept(s) from defeated ${defeated.name}.`,
      'success'
    );
  },

  // -------------------------------------------------------------------------
  // PRIVATE HELPERS
  // -------------------------------------------------------------------------

  /**
   * Mark a civ as defeated and trigger knowledge transfer.
   * @param {string} defeaterCivId - civ that eliminated the other
   * @param {string} defeatedCivId
   * @private
   */
  _defeatCiv(defeaterCivId, defeatedCivId) {
    const defeated = this.getCiv(defeatedCivId);
    if (!defeated || defeated.isDefeated) return;
    defeated.isDefeated = true;

    this.addMessage(`${defeated.name} has been eliminated!`, 'danger');
    this.onCivDefeated(defeaterCivId, defeatedCivId);

    // Make peace with everyone.
    for (const civId of this.getAllCivIds()) {
      if (civId !== defeatedCivId) {
        const civ = this.getCiv(civId);
        if (civ) {
          civ.diplomacy[defeatedCivId] = 'neutral';
          defeated.diplomacy[civId] = 'neutral';
        }
      }
    }
  },

  /**
   * Count the number of tiles owned by a civ.
   * @param {string} civId
   * @returns {number}
   * @private
   */
  _countTiles(civId) {
    let count = 0;
    for (const [, tile] of this.state.map) {
      if (tile.owner === civId) count++;
    }
    return count;
  },

  /**
   * Return the display name of a civ, or the raw id if not found.
   * @param {string} civId
   * @returns {string}
   * @private
   */
  _civName(civId) {
    const civ = this.getCiv(civId);
    return civ ? civ.name : civId;
  },

  /**
   * Return the branch with the highest proficiency for a bot civ.
   * @param {object} civ
   * @returns {string}
   * @private
   */
  _botTopBranch(civ) {
    let top = 'logic';
    let topVal = -1;
    for (const [branch, val] of Object.entries(civ.branchProficiency)) {
      if (val > topVal) {
        topVal = val;
        top = branch;
      }
    }
    return top;
  },

  /**
   * Generate a prioritised list of building IDs for bot construction,
   * weighted toward the bot's top branch.
   * @param {object} civ
   * @returns {string[]}
   * @private
   */
  _botBuildingPriority(civ) {
    const topBranch = this._botTopBranch(civ);
    const allBldgs = _allBuildings();

    // Separate branch-research buildings for this faction's branch.
    const branchBuildings = Object.keys(BRANCH_RESEARCH_BUILDINGS).filter(id => {
      const b = BRANCH_RESEARCH_BUILDINGS[id];
      return b.branchBoost && (b.branchBoost.branch === topBranch || b.branchBoost.branch === 'all');
    });

    // General buildings in a sensible order.
    const general = [
      'power_plant', 'research_node', 'data_farm',
      'silicon_extractor', 'copper_mine', 'advanced_lab',
      'military_forge', 'defense_array',
      'neural_cluster', 'quantum_lab', 'idea_accelerator',
    ];

    return [...branchBuildings, ...general];
  },

  /**
   * Bot trains a unit of the given type on any owned non-void tile.
   * @param {object} civ
   * @param {string} unitTypeId
   * @private
   */
  _botTrainUnit(civ, unitTypeId) {
    for (const [, tile] of this.state.map) {
      if (tile.owner === civ.id && tile.type !== 'void_zone') {
        const result = this.trainUnit(civ.id, tile.q, tile.r, unitTypeId);
        if (result.success) return;
      }
    }
  },

};

// ---------------------------------------------------------------------------
// GLOBAL EXPORT
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.GameEngine = GameEngine;
}
