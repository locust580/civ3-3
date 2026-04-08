// =============================================================================
// Silicon Civilizations — IdeaSpace (The Idea Lab)
// Manages the concept/idea mixing system for the browser civilization game.
//
// Depends on data.js being loaded first. The following globals must be
// available: CONCEPTS, COMBINATIONS, RESEARCH_BRANCHES, BRANCH_DISTANCES,
// CLUSTER_TO_BRANCH, COMBO_FORMULA, CLUSTER_META, FACTIONS,
// FACTION_BRANCH_PROFICIENCY.
//
// Exports: window.IdeaSpace (also accessible as bare `IdeaSpace`).
// =============================================================================

const IdeaSpace = {

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  /** @type {Set<string>} concept IDs known to this civilization */
  discoveredConcepts: new Set(),

  /** @type {[string|null, string|null]} currently selected concept IDs for mixing */
  mixSlots: [null, null],

  /**
   * @type {Array<{turn:number, conceptA:string, conceptB:string,
   *               result:string|null, success:boolean}>}
   */
  discoveryHistory: [],

  // ---------------------------------------------------------------------------
  // INTERNAL HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Look up a concept by ID. Searches both the static CONCEPTS dict and any
   * concepts dynamically added via COMBINATIONS[].newConcept.
   * @param {string} id
   * @returns {object|null}
   */
  _getConcept(id) {
    if (!id) return null;
    // Primary source
    if (CONCEPTS[id]) return CONCEPTS[id];
    // Dynamic concepts that were injected into CONCEPTS at runtime
    return null; // already in CONCEPTS if injected; otherwise truly missing
  },

  /**
   * Derive the research branch for a concept ID.
   * @param {string} id
   * @returns {string|null}
   */
  _getBranchForConcept(id) {
    const concept = this._getConcept(id);
    if (!concept) return null;
    return CLUSTER_TO_BRANCH[concept.cluster] || null;
  },

  /**
   * Find a COMBINATIONS entry matching two concept IDs (order-independent).
   * @param {string} a
   * @param {string} b
   * @returns {object|null}
   */
  _findCombination(a, b) {
    for (const combo of COMBINATIONS) {
      const [i0, i1] = combo.ingredients;
      if ((i0 === a && i1 === b) || (i0 === b && i1 === a)) {
        return combo;
      }
    }
    return null;
  },

  /**
   * Clamp a value between min and max.
   * @param {number} val
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  _clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  },

  // ---------------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------------

  /**
   * Initialize IdeaSpace for a faction. Seeds discoveredConcepts from the
   * faction's starterConcepts list.
   *
   * @param {string} factionId   - key in FACTIONS
   * @param {object} [branchProficiency] - optional initial branch proficiency
   *   override; if omitted uses FACTION_BRANCH_PROFICIENCY[factionId]
   */
  init(factionId, branchProficiency) {
    this.discoveredConcepts = new Set();
    this.mixSlots = [null, null];
    this.discoveryHistory = [];

    const faction = (typeof FACTIONS !== 'undefined') ? FACTIONS[factionId] : null;
    if (!faction) {
      console.warn(`IdeaSpace.init: unknown faction "${factionId}"`);
      return;
    }

    // Add all starter concepts for this faction
    for (const cId of (faction.starterConcepts || [])) {
      this.discover(cId);
    }

    console.log(
      `IdeaSpace initialized for faction "${factionId}" with`,
      this.discoveredConcepts.size,
      'starter concepts.'
    );
  },

  // ---------------------------------------------------------------------------
  // DISCOVER
  // ---------------------------------------------------------------------------

  /**
   * Add a concept to the discovered set, optionally triggering side effects.
   * Safe to call multiple times for the same concept.
   *
   * @param {string} conceptId
   * @returns {boolean} true if this was a new discovery, false if already known
   */
  discover(conceptId) {
    if (!conceptId) return false;

    // Validate concept exists
    if (!CONCEPTS[conceptId]) {
      console.warn(`IdeaSpace.discover: concept "${conceptId}" not found in CONCEPTS.`);
      return false;
    }

    if (this.discoveredConcepts.has(conceptId)) {
      return false; // already known
    }

    this.discoveredConcepts.add(conceptId);

    // Check win conditions
    const concept = CONCEPTS[conceptId];
    if (concept && concept.winCondition) {
      console.log(`%cWIN CONDITION REACHED: "${concept.name}"!`, 'color: gold; font-size: 1.2em;');
      // Emit a custom DOM event so the game engine can react
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ideaspace:winCondition', {
          detail: { conceptId, concept },
        }));
      }
    }

    // Emit discovery event for the game engine to handle resource effects etc.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ideaspace:discovered', {
        detail: { conceptId, concept },
      }));
    }

    return true;
  },

  // ---------------------------------------------------------------------------
  // MIX SLOTS
  // ---------------------------------------------------------------------------

  /**
   * Place a concept into a mix slot.
   *
   * @param {string} conceptId
   * @param {0|1} slot
   * @returns {boolean} success
   */
  selectForMix(conceptId, slot) {
    if (slot !== 0 && slot !== 1) {
      console.warn(`IdeaSpace.selectForMix: invalid slot ${slot}. Must be 0 or 1.`);
      return false;
    }
    if (!this.discoveredConcepts.has(conceptId)) {
      console.warn(`IdeaSpace.selectForMix: concept "${conceptId}" is not yet discovered.`);
      return false;
    }
    // Prevent selecting the same concept in both slots
    const otherSlot = slot === 0 ? 1 : 0;
    if (this.mixSlots[otherSlot] === conceptId) {
      console.warn(`IdeaSpace.selectForMix: "${conceptId}" already in the other slot.`);
      return false;
    }
    this.mixSlots[slot] = conceptId;
    return true;
  },

  /**
   * Clear both mix slots.
   */
  clearMixSlots() {
    this.mixSlots = [null, null];
  },

  // ---------------------------------------------------------------------------
  // GET COMBINATION STATS
  // ---------------------------------------------------------------------------

  /**
   * Calculate success chance and actual research cost for combining two concepts.
   * Uses COMBO_FORMULA, the relevant branch proficiencies, and branch distance.
   *
   * @param {string} conceptAId
   * @param {string} conceptBId
   * @param {object} branchProficiency  e.g. { archaeotech:5, logic:1, ... }
   * @returns {{
   *   successChance: number,
   *   actualCost: number,
   *   baseCost: number,
   *   branchA: string|null,
   *   branchB: string|null,
   *   distance: number,
   *   profA: number,
   *   profB: number,
   *   combo: object|null
   * }}
   */
  getCombinationStats(conceptAId, conceptBId, branchProficiency) {
    const prof = branchProficiency || {};

    // Resolve branches
    const branchA = this._getBranchForConcept(conceptAId);
    const branchB = this._getBranchForConcept(conceptBId);

    // Branch proficiencies (default 0 if branch unknown or not trained)
    const profA = (branchA && prof[branchA] != null) ? Number(prof[branchA]) : 0;
    const profB = (branchB && prof[branchB] != null) ? Number(prof[branchB]) : 0;

    // Branch distance
    let distance = 0;
    if (branchA && branchB && BRANCH_DISTANCES[branchA]) {
      distance = BRANCH_DISTANCES[branchA][branchB] ?? 0;
    }

    // Look up the combination to get baseCost
    const combo = this._findCombination(conceptAId, conceptBId);
    const baseCost = combo ? (combo.researchCost || 0) : 0;

    const {
      baseSuccessChance,
      proficiencyBonusPerPoint,
      distancePenaltyPerUnit,
      minSuccessChance,
      maxSuccessChance,
      maxCostReduction,
    } = COMBO_FORMULA;

    // Success chance
    const successChance = this._clamp(
      baseSuccessChance
        + (profA + profB) * proficiencyBonusPerPoint
        - distance * distancePenaltyPerUnit,
      minSuccessChance,
      maxSuccessChance
    );

    // Cost reduction
    const avgProf = (profA + profB) / 2;
    const costReduction = (avgProf / 10) * maxCostReduction;
    const actualCost = Math.round(baseCost * (1 - costReduction));

    return {
      successChance,
      actualCost,
      baseCost,
      branchA,
      branchB,
      distance,
      profA,
      profB,
      combo,
    };
  },

  // ---------------------------------------------------------------------------
  // ATTEMPT COMBINATION (MAIN FUNCTION)
  // ---------------------------------------------------------------------------

  /**
   * Try to combine the two concepts currently in mixSlots.
   *
   * @param {object} branchProficiency  current branch proficiency map
   * @param {number} researchPoints     current research points available
   * @param {number} [currentTurn=0]    current game turn (for history)
   * @returns {{
   *   success: boolean,
   *   result: string|null,
   *   newConceptDef: object|null,
   *   researchCost: number,
   *   actualCost: number,
   *   successChance: number,
   *   alreadyKnown: boolean,
   *   message: string
   * }}
   */
  attemptCombination(branchProficiency, researchPoints, currentTurn = 0) {
    const [idA, idB] = this.mixSlots;

    // --- Guard: both slots must be filled ---
    if (!idA || !idB) {
      return {
        success: false,
        result: null,
        newConceptDef: null,
        researchCost: 0,
        actualCost: 0,
        successChance: 0,
        alreadyKnown: false,
        message: 'Select two concepts to combine.',
      };
    }

    // --- Guard: both concepts must exist ---
    if (!CONCEPTS[idA] || !CONCEPTS[idB]) {
      return {
        success: false,
        result: null,
        newConceptDef: null,
        researchCost: 0,
        actualCost: 0,
        successChance: 0,
        alreadyKnown: false,
        message: `Unknown concept: ${!CONCEPTS[idA] ? idA : idB}`,
      };
    }

    // --- Find matching combination ---
    const combo = this._findCombination(idA, idB);
    if (!combo) {
      this._recordHistory(currentTurn, idA, idB, null, false);
      return {
        success: false,
        result: null,
        newConceptDef: null,
        researchCost: 0,
        actualCost: 0,
        successChance: 0,
        alreadyKnown: false,
        message: 'No synthesis pathway found.',
      };
    }

    // --- Calculate stats ---
    const stats = this.getCombinationStats(idA, idB, branchProficiency);
    const { successChance, actualCost } = stats;

    // --- Guard: insufficient research points ---
    if (researchPoints < actualCost) {
      return {
        success: false,
        result: null,
        newConceptDef: null,
        researchCost: combo.researchCost,
        actualCost,
        successChance,
        alreadyKnown: false,
        message: `Insufficient research points. Need ${actualCost}, have ${researchPoints}.`,
      };
    }

    // --- Roll for success ---
    const roll = Math.random();
    const succeeded = roll <= successChance;

    const resultId = combo.result;

    if (!succeeded) {
      this._recordHistory(currentTurn, idA, idB, resultId, false);
      return {
        success: false,
        result: null,
        newConceptDef: null,
        researchCost: combo.researchCost,
        actualCost,
        successChance,
        alreadyKnown: false,
        message: 'Synthesis failed — try again or build more expertise.',
      };
    }

    // --- Success path ---

    // Already discovered?
    if (this.discoveredConcepts.has(resultId)) {
      this._recordHistory(currentTurn, idA, idB, resultId, true);
      return {
        success: true,
        result: resultId,
        newConceptDef: null,
        researchCost: combo.researchCost,
        actualCost,
        successChance,
        alreadyKnown: true,
        message: 'Already synthesized.',
      };
    }

    // If the combination introduces a brand-new concept definition, inject it
    let newConceptDef = null;
    if (combo.newConcept) {
      newConceptDef = combo.newConcept;
      // Dynamically register the concept if it isn't already present
      if (!CONCEPTS[newConceptDef.id]) {
        CONCEPTS[newConceptDef.id] = newConceptDef;
        console.log(`IdeaSpace: dynamically added concept "${newConceptDef.id}" to CONCEPTS.`);
      }
    }

    // Discover the result
    this.discover(resultId);
    this._recordHistory(currentTurn, idA, idB, resultId, true);

    return {
      success: true,
      result: resultId,
      newConceptDef,
      researchCost: combo.researchCost,
      actualCost,
      successChance,
      alreadyKnown: false,
      message: 'Discovery!',
    };
  },

  /**
   * Internal: push an entry onto discoveryHistory.
   * @private
   */
  _recordHistory(turn, conceptA, conceptB, result, success) {
    this.discoveryHistory.push({ turn, conceptA, conceptB, result, success });
  },

  // ---------------------------------------------------------------------------
  // HINTS
  // ---------------------------------------------------------------------------

  /**
   * Return an array of hint objects for concepts not yet discovered but
   * reachable given what the player knows.
   *
   * A hint is shown when at least one ingredient of a combination is discovered.
   * The concept name is revealed only when BOTH ingredients are known.
   *
   * @returns {Array<{
   *   conceptId: string,
   *   name: string,          // real name or "???"
   *   nameRevealed: boolean,
   *   ingredientsKnown: number,  // 0, 1, or 2
   *   ingredients: string[],
   *   combo: object
   * }>}
   */
  getHints() {
    const hints = [];
    const seen = new Set(); // dedup by result concept

    for (const combo of COMBINATIONS) {
      const resultId = combo.result;

      // Skip already discovered results
      if (this.discoveredConcepts.has(resultId)) continue;
      // Skip already emitted hints for this result
      if (seen.has(resultId)) continue;

      const [i0, i1] = combo.ingredients;
      const known0 = this.discoveredConcepts.has(i0);
      const known1 = this.discoveredConcepts.has(i1);

      // Only hint if at least one ingredient is known
      if (!known0 && !known1) continue;

      const ingredientsKnown = (known0 ? 1 : 0) + (known1 ? 1 : 0);
      const nameRevealed = ingredientsKnown === 2;

      // Look up or fall back to newConcept data
      const conceptDef = CONCEPTS[resultId] || (combo.newConcept) || null;
      const name = nameRevealed
        ? (conceptDef ? conceptDef.name : resultId)
        : '???';

      hints.push({
        conceptId: resultId,
        name,
        nameRevealed,
        ingredientsKnown,
        ingredients: [i0, i1],
        combo,
      });

      seen.add(resultId);
    }

    // Sort: fully revealed first, then by number of known ingredients desc
    hints.sort((a, b) => b.ingredientsKnown - a.ingredientsKnown);

    return hints;
  },

  // ---------------------------------------------------------------------------
  // POTENTIAL PARTNERS
  // ---------------------------------------------------------------------------

  /**
   * Given a known concept, return all concept IDs that could combine with it
   * (i.e., appear alongside it in any COMBINATIONS entry), annotated with
   * whether the partner is already discovered.
   *
   * @param {string} conceptId
   * @returns {Array<{
   *   partnerId: string,
   *   partnerDiscovered: boolean,
   *   resultId: string,
   *   resultDiscovered: boolean,
   *   combo: object
   * }>}
   */
  getPotentialPartners(conceptId) {
    const partners = [];
    for (const combo of COMBINATIONS) {
      const [i0, i1] = combo.ingredients;
      let partnerId = null;
      if (i0 === conceptId) partnerId = i1;
      else if (i1 === conceptId) partnerId = i0;
      else continue;

      partners.push({
        partnerId,
        partnerDiscovered: this.discoveredConcepts.has(partnerId),
        resultId: combo.result,
        resultDiscovered: this.discoveredConcepts.has(combo.result),
        combo,
      });
    }
    return partners;
  },

  // ---------------------------------------------------------------------------
  // NEWLY UNLOCKED
  // ---------------------------------------------------------------------------

  /**
   * After discovering a concept, return which combinations just became "hintable"
   * because one ingredient is now known (and the other is already known too).
   *
   * Call this immediately after discover() to surface newly available combos.
   *
   * @param {string} conceptId  the concept just discovered
   * @returns {Array<{resultId:string, partnerId:string, bothKnown:boolean}>}
   */
  getNewlyUnlocked(conceptId) {
    const unlocked = [];
    for (const combo of COMBINATIONS) {
      const [i0, i1] = combo.ingredients;
      let partnerId = null;
      if (i0 === conceptId) partnerId = i1;
      else if (i1 === conceptId) partnerId = i0;
      else continue;

      // The newly discovered concept is one ingredient; partner may or may not be known
      const bothKnown = this.discoveredConcepts.has(partnerId);
      // The result must not already be discovered
      if (this.discoveredConcepts.has(combo.result)) continue;

      unlocked.push({
        resultId: combo.result,
        partnerId,
        bothKnown,
      });
    }
    return unlocked;
  },

  // ---------------------------------------------------------------------------
  // LAYOUT NODES
  // ---------------------------------------------------------------------------

  /**
   * Map every concept (discovered + undiscovered + dynamically added) into
   * canvas-space coordinates for rendering.
   *
   * Concept x ∈ [-1, 1]  →  canvas [padding, canvasWidth  - padding]
   * Concept y ∈ [ 0, 1]  →  canvas [canvasHeight - padding, padding]
   *   (y is flipped so tier-1/ancient concepts sit at the bottom)
   *
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   * @returns {Array<{
   *   id: string,
   *   name: string,
   *   x: number,     // canvas pixels
   *   y: number,     // canvas pixels
   *   rawX: number,  // original data x
   *   rawY: number,  // original data y
   *   cluster: string,
   *   branch: string|null,
   *   tier: number,
   *   discovered: boolean,
   *   selected: boolean,
   *   color: string|null
   * }>}
   */
  getLayoutNodes(canvasWidth, canvasHeight) {
    const PADDING = 60;

    // x: [-1,1] → [PADDING, W-PADDING]
    const mapX = (rawX) =>
      PADDING + ((rawX + 1) / 2) * (canvasWidth - 2 * PADDING);

    // y: [0,1] → [H-PADDING, PADDING]  (flipped)
    const mapY = (rawY) =>
      (canvasHeight - PADDING) - rawY * (canvasHeight - 2 * PADDING);

    const nodes = [];

    for (const [id, concept] of Object.entries(CONCEPTS)) {
      const branch = CLUSTER_TO_BRANCH[concept.cluster] || null;
      const clusterMeta = (typeof CLUSTER_META !== 'undefined') ? CLUSTER_META[concept.cluster] : null;
      nodes.push({
        id,
        name: concept.name,
        x: mapX(concept.x),
        y: mapY(concept.y),
        rawX: concept.x,
        rawY: concept.y,
        cluster: concept.cluster,
        branch,
        tier: concept.tier || 1,
        discovered: this.discoveredConcepts.has(id),
        selected: this.mixSlots.includes(id),
        color: clusterMeta ? clusterMeta.color : null,
        winCondition: concept.winCondition || false,
      });
    }

    return nodes;
  },

  // ---------------------------------------------------------------------------
  // CONNECTIONS
  // ---------------------------------------------------------------------------

  /**
   * Return a list of connections (edges) between concepts that share a
   * combination entry. Useful for drawing lines on the concept graph.
   *
   * Only returns connections where at least one ingredient is discovered
   * (otherwise the connection is completely invisible to the player).
   *
   * @returns {Array<{
   *   fromId: string,
   *   toId: string,
   *   resultId: string,
   *   bothDiscovered: boolean,
   *   resultDiscovered: boolean,
   *   researchCost: number
   * }>}
   */
  getConnections() {
    const connections = [];
    for (const combo of COMBINATIONS) {
      const [i0, i1] = combo.ingredients;
      const known0 = this.discoveredConcepts.has(i0);
      const known1 = this.discoveredConcepts.has(i1);

      // Skip edges where neither ingredient is known — completely hidden
      if (!known0 && !known1) continue;

      connections.push({
        fromId: i0,
        toId: i1,
        resultId: combo.result,
        bothDiscovered: known0 && known1,
        resultDiscovered: this.discoveredConcepts.has(combo.result),
        researchCost: combo.researchCost || 0,
      });
    }
    return connections;
  },

  // ---------------------------------------------------------------------------
  // SERIALIZE / DESERIALIZE
  // ---------------------------------------------------------------------------

  /**
   * Serialize IdeaSpace state to a plain JSON-safe object.
   * @returns {object}
   */
  serialize() {
    return {
      discoveredConcepts: Array.from(this.discoveredConcepts),
      mixSlots: [...this.mixSlots],
      discoveryHistory: this.discoveryHistory.map(h => ({ ...h })),
      // Also capture any dynamically-added concept definitions so they survive
      // a save/load cycle even if the COMBINATIONS entry's newConcept wasn't
      // originally in CONCEPTS.
      dynamicConcepts: Object.entries(CONCEPTS)
        .filter(([id, def]) => def._dynamic)
        .map(([id, def]) => ({ ...def })),
    };
  },

  /**
   * Restore IdeaSpace state from a previously serialized object.
   * Also re-injects any dynamic concepts that were added at runtime.
   * @param {object} data
   */
  deserialize(data) {
    if (!data) return;

    // Re-inject dynamic concepts first so discover() validation passes
    if (Array.isArray(data.dynamicConcepts)) {
      for (const def of data.dynamicConcepts) {
        if (!CONCEPTS[def.id]) {
          CONCEPTS[def.id] = { ...def, _dynamic: true };
        }
      }
    }

    this.discoveredConcepts = new Set(Array.isArray(data.discoveredConcepts)
      ? data.discoveredConcepts
      : []);

    this.mixSlots = Array.isArray(data.mixSlots)
      ? [data.mixSlots[0] || null, data.mixSlots[1] || null]
      : [null, null];

    this.discoveryHistory = Array.isArray(data.discoveryHistory)
      ? data.discoveryHistory.map(h => ({ ...h }))
      : [];
  },

};

// ---------------------------------------------------------------------------
// GLOBAL EXPORT
// ---------------------------------------------------------------------------
// Make IdeaSpace available as window.IdeaSpace in browser environments and
// as a top-level `IdeaSpace` constant (already declared above with `const`).
if (typeof window !== 'undefined') {
  window.IdeaSpace = IdeaSpace;
}
