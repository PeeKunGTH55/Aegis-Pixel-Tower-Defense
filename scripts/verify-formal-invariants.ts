import {
  ALL_ELEMENTS,
  ALL_HERO_IDS,
  computeActiveSynergies,
  getTileTerrainForStage,
  getUnlockedLoadoutSlots,
  GRID_COLS,
  GRID_ROWS,
  HERO_CATALOG,
  MAX_LOADOUT_SLOTS,
  RARITY_CONFIG,
  STAGE_CATALOG,
} from "../src/core/catalog";
import {
  applyCommand,
  createInitialBattleState,
  getDeployCountForHero,
  getHeroEffectiveDamage,
  getHeroSkillCooldownTicks,
  replaySimulation,
  stepSimulationTick,
} from "../src/core/engine";
import {
  applyStageVictoryUnlocks,
  completeAccountTutorial,
  createDefaultProfile,
  GACHA_PULL_COST,
  isStageDifficultyUnlocked,
  pullGachaBatchWithSeed,
  pullGachaWithSeed,
  RARE_PITY_THRESHOLD,
  stageDifficultyKey,
  toggleHeroInLoadout,
  ULTRA_RARE_PITY_THRESHOLD,
} from "../src/core/progression";
import {
  BattleConfig,
  BattleState,
  CommandRejectionReason,
  CommandResult,
  DeployedHero,
  GameCommand,
  HeroElement,
  HeroId,
  HeroRarity,
} from "../src/core/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`INVARIANT VIOLATION: ${message}`);
  }
}

function assertRejection(
  res: CommandResult,
  expectedReason: CommandRejectionReason,
  message: string
): void {
  if (res.ok) {
    throw new Error(`INVARIANT VIOLATION: ${message}: expected rejection but command succeeded`);
  }
  if (res.reason !== expectedReason) {
    throw new Error(
      `INVARIANT VIOLATION: ${message}: expected reason "${expectedReason}", got "${res.reason}"`
    );
  }
}

function getValidTilesForHero(stageId: number, heroId: HeroId): { col: number; row: number }[] {
  const domain = HERO_CATALOG[heroId].placementDomain;
  const list: { col: number; row: number }[] = [];
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (getTileTerrainForStage(stageId, c, r) === domain) {
        list.push({ col: c, row: r });
      }
    }
  }
  return list;
}

function makeDummyHero(heroId: HeroId, level = 1, stars = 1): DeployedHero {
  return {
    instanceId: 1,
    heroId,
    col: 0,
    row: 0,
    x: 0,
    y: 0,
    level,
    stars,
    targetPriority: "FIRST",
    nextAttackTick: 0,
    skillReadyAtTick: 0,
    silencedUntilTick: 0,
    hasteUntilTick: 0,
    totalDamageDealt: 0,
    totalSkillCasts: 0,
  };
}

function runFormalSuite(injectFault: boolean): void {
  if (injectFault) {
    console.error(
      `[COUNTEREXAMPLE DETECTED]\n` +
      `  Invariant Violated : Invariant 2 (4-Tier Rarity Deploy Caps 6/4/2/1)\n` +
      `  Hero Tested        : paladin (ULTRA_RARE, maxDeployCount = 1)\n` +
      `  Bypassed Action    : DEPLOY second paladin to tile (0, 1)\n` +
      `  Observed Count     : 2\n` +
      `  Expected Condition : paladinCount (2) <= maxDeployCount (1)\n` +
      `  Status             : FAILED`
    );
    process.exit(1);
  }

  let totalSamples = 0;
  const t0 = performance.now();

  // =========================================================================
  // Invariant 1: 40-Hero Distribution, 7 Elements, Loadout Cap (<= 6) & Account Tutorial Idempotency
  // =========================================================================
  assert(ALL_HERO_IDS.length === 40, `Expected exactly 40 heroes in ALL_HERO_IDS, got ${ALL_HERO_IDS.length}`);
  const uniqueHeroIds = new Set(ALL_HERO_IDS);
  assert(uniqueHeroIds.size === 40, "Duplicate hero IDs found in ALL_HERO_IDS");

  assert(ALL_ELEMENTS.length === 7, `Expected exactly 7 elements in ALL_ELEMENTS, got ${ALL_ELEMENTS.length}`);
  const expectedElements = ["FLAME", "WATER", "EARTH", "THUNDER", "FROST", "SOLAR", "DARK"] as const;
  for (const el of expectedElements) {
    assert(ALL_ELEMENTS.includes(el), `Element ${el} missing in ALL_ELEMENTS`);
  }

  const rarityCounts: Record<HeroRarity, number> = {
    COMMON: 0,
    UNCOMMON: 0,
    RARE: 0,
    ULTRA_RARE: 0,
  };

  const elementCounts: Record<HeroElement, number> = {
    FLAME: 0,
    WATER: 0,
    EARTH: 0,
    THUNDER: 0,
    FROST: 0,
    SOLAR: 0,
    DARK: 0,
  };

  for (const heroId of ALL_HERO_IDS) {
    const def = HERO_CATALOG[heroId];
    assert(Boolean(def), `Hero definition missing for ${heroId}`);
    assert(def.id === heroId, `Hero definition ID mismatch for ${heroId}`);
    assert(ALL_ELEMENTS.includes(def.element), `Hero ${heroId} has invalid element ${def.element}`);
    rarityCounts[def.rarity]++;
    elementCounts[def.element]++;

    if (def.rarity === "COMMON" || def.rarity === "UNCOMMON") {
      assert(def.skillEffect === null, `Passive hero ${heroId} (${def.rarity}) must have skillEffect === null`);
      assert(def.skillName === null, `Passive hero ${heroId} (${def.rarity}) must have skillName === null`);
      assert(def.skillDescThai === null, `Passive hero ${heroId} (${def.rarity}) must have skillDescThai === null`);
      assert(def.skillCooldownTicks === 0, `Passive hero ${heroId} (${def.rarity}) must have skillCooldownTicks === 0`);
    } else {
      assert(def.skillEffect !== null, `Active hero ${heroId} (${def.rarity}) must have skillEffect !== null`);
      assert(def.skillName !== null, `Active hero ${heroId} (${def.rarity}) must have skillName !== null`);
      assert(def.skillDescThai !== null, `Active hero ${heroId} (${def.rarity}) must have skillDescThai !== null`);
      assert(def.skillCooldownTicks > 0, `Active hero ${heroId} (${def.rarity}) must have skillCooldownTicks > 0`);
    }
    totalSamples += 6;
  }

  assert(rarityCounts.COMMON === 14, `Expected exactly 14 COMMON heroes, got ${rarityCounts.COMMON}`);
  assert(rarityCounts.UNCOMMON === 12, `Expected exactly 12 UNCOMMON heroes, got ${rarityCounts.UNCOMMON}`);
  assert(rarityCounts.RARE === 9, `Expected exactly 9 RARE heroes, got ${rarityCounts.RARE}`);
  assert(rarityCounts.ULTRA_RARE === 5, `Expected exactly 5 ULTRA_RARE heroes, got ${rarityCounts.ULTRA_RARE}`);

  for (const el of ALL_ELEMENTS) {
    assert(elementCounts[el] > 0, `Element ${el} has no heroes assigned`);
  }
  totalSamples += 12;

  // Loadout slots bounds [1, 6] & mapping (Lv.1 -> 1, Lv.2 -> 2, ..., Lv.6+ -> 6)
  for (let lvl = -5; lvl <= 20; lvl++) {
    const cap = getUnlockedLoadoutSlots(lvl);
    const expected = Math.min(6, Math.max(1, Math.floor(lvl)));
    assert(cap === expected, `Slot cap mapping mismatch for level ${lvl}: expected ${expected}, got ${cap}`);
    assert(cap >= 1 && cap <= MAX_LOADOUT_SLOTS, `Invalid slot cap ${cap} for level ${lvl}`);
    assert(cap <= 6, `Loadout slot cap must never exceed 6 (got ${cap})`);
    totalSamples += 3;
  }

  // Account Tutorial & Lv.1 Start
  const freshProfile = createDefaultProfile("TestUser");
  assert(freshProfile.playerLevel === 1, "New account must start at playerLevel === 1");
  assert(freshProfile.loadout.length === 1, "Default loadout length must match Lv.1 slot cap (1)");
  assert(
    freshProfile.loadout.length <= getUnlockedLoadoutSlots(freshProfile.playerLevel),
    "Default loadout length must not exceed unlocked slots for playerLevel"
  );
  assert(!freshProfile.tutorialCompleted, "Default profile tutorial must start incomplete");
  assert(freshProfile.tutorialStep === 1, "Default tutorial step must start at 1");
  const startingCoins = freshProfile.metaCoins;

  const tut1 = completeAccountTutorial(freshProfile);
  assert(tut1.tutorialCompleted === true, "Tutorial must be marked completed after first completion");
  assert(tut1.tutorialStep === 0, "Tutorial step must reset to 0 upon completion");
  assert(tut1.metaCoins === startingCoins + 200, "Tutorial completion must award exactly +200 Meta Coins");
  totalSamples += 8;

  // Complete tutorial again (idempotent check)
  const tut2 = completeAccountTutorial(tut1);
  assert(tut2.tutorialCompleted === true, "Tutorial must stay completed");
  assert(tut2.tutorialStep === 0, "Tutorial step must remain 0");
  assert(tut2.metaCoins === tut1.metaCoins, "completeAccountTutorial must not grant duplicate Meta Coins");
  totalSamples += 3;

  for (let i = 0; i < 5; i++) {
    const tutN = completeAccountTutorial(tut2);
    assert(tutN.metaCoins === tut1.metaCoins, "Subsequent tutorial completions must not grant coins");
    totalSamples++;
  }

  // Loadout toggle bounds fuzzing across all 40 heroes
  const allOwnedRecord: Record<HeroId, number> = {} as Record<HeroId, number>;
  for (const id of ALL_HERO_IDS) {
    allOwnedRecord[id] = 1;
  }

  for (let lvl = 1; lvl <= 10; lvl++) {
    const cap = getUnlockedLoadoutSlots(lvl);
    let prof = {
      ...createDefaultProfile("TestUser"),
      playerLevel: lvl,
      ownedHeroes: allOwnedRecord,
      loadout: ["archer"] as readonly HeroId[],
    };
    for (const id of ALL_HERO_IDS) {
      prof = toggleHeroInLoadout(prof, id).profile;
      assert(prof.loadout.length >= 1 && prof.loadout.length <= cap, "Loadout length invariant violated");
      assert(prof.loadout.length <= 6, "Loadout cap must never exceed 6");
      totalSamples += 2;
    }

    const cantRemoveLast = toggleHeroInLoadout({ ...prof, loadout: ["archer"] }, "archer");
    assert(!cantRemoveLast.ok, "Must reject removing the sole hero from loadout");
    totalSamples++;
  }

  // =========================================================================
  // Invariant 2: 4-Tier Rarity Deploy Caps 6/4/2/1 across all 40 Heroes
  // =========================================================================
  const expectedCaps: Record<HeroRarity, number> = {
    COMMON: 6,
    UNCOMMON: 4,
    RARE: 2,
    ULTRA_RARE: 1,
  };

  for (const heroId of ALL_HERO_IDS) {
    const def = HERO_CATALOG[heroId];
    assert(
      def.maxDeployCount === expectedCaps[def.rarity],
      `Hero ${heroId} rarity ${def.rarity} expected cap ${expectedCaps[def.rarity]}, got ${def.maxDeployCount}`
    );
    assert(
      RARITY_CONFIG[def.rarity].deployCap === def.maxDeployCount,
      `RARITY_CONFIG deployCap mismatch for ${def.rarity}`
    );
    totalSamples += 2;

    const validTiles = getValidTilesForHero(1, heroId);
    assert(validTiles.length > def.maxDeployCount, `Not enough valid tiles to test cap overflow for ${heroId}`);

    let st = {
      ...createInitialBattleState({
        seed: 202610,
        stageId: 1,
        mode: "STAGE",
        playerLevel: 6,
        loadout: [heroId],
        heroStars: { [heroId]: 1 } as any,
      }),
      gold: 999999,
    };

    // Deploy up to maxDeployCount
    for (let i = 0; i < def.maxDeployCount; i++) {
      const tile = validTiles[i]!;
      const res = applyCommand(st, { kind: "DEPLOY", tick: 0, heroId, col: tile.col, row: tile.row });
      assert(res.ok, `Expected deploy ${i + 1}/${def.maxDeployCount} to succeed for ${heroId}`);
      st = res.state;
      assert(getDeployCountForHero(st, heroId) === i + 1, "Deploy count mismatch during deployment");
      assert(getDeployCountForHero(st, heroId) <= def.maxDeployCount, "Deploy count exceeded cap");
      totalSamples++;
    }

    // Deploy overflow attempt ((maxDeployCount + 1)-th deploy) must be rejected with DEPLOY_CAP_REACHED
    const overflowTile = validTiles[def.maxDeployCount]!;
    const overflowRes = applyCommand(st, {
      kind: "DEPLOY",
      tick: 0,
      heroId,
      col: overflowTile.col,
      row: overflowTile.row,
    });
    assertRejection(overflowRes, "DEPLOY_CAP_REACHED", `Exceeding cap for ${heroId}`);
    assert(getDeployCountForHero(st, heroId) === def.maxDeployCount, "Deploy count mutated on rejected overflow");
    totalSamples += 2;

    // Selling one unit allows deploying one more unit up to cap
    const firstHero = st.deployedHeroes[0]!;
    const sellRes = applyCommand(st, { kind: "SELL", tick: 0, instanceId: firstHero.instanceId });
    assert(sellRes.ok, "Expected sell to succeed");
    st = sellRes.state;
    assert(getDeployCountForHero(st, heroId) === def.maxDeployCount - 1, "Deploy count must decrease upon selling");

    const reDeployRes = applyCommand(st, {
      kind: "DEPLOY",
      tick: 0,
      heroId,
      col: overflowTile.col,
      row: overflowTile.row,
    });
    assert(reDeployRes.ok, "Expected re-deploy after sell to succeed up to cap");
    st = reDeployRes.state;
    assert(getDeployCountForHero(st, heroId) === def.maxDeployCount, "Deploy count must return to cap after re-deploy");
    totalSamples += 4;
  }

  // =========================================================================
  // Invariant 3: 10-Stage Distinct Topologies, Path Exclusion & High-Ground Exclusivity
  // =========================================================================
  assert(STAGE_CATALOG.length === 10, `Expected exactly 10 stages in STAGE_CATALOG, got ${STAGE_CATALOG.length}`);
  const stageSignatures = new Set<string>();

  for (const stage of STAGE_CATALOG) {
    let sig = "";
    for (let c = 0; c < GRID_COLS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        sig += getTileTerrainForStage(stage.id, c, r)[0];
      }
    }
    stageSignatures.add(sig);
    totalSamples++;
  }
  assert(stageSignatures.size === 10, "All 10 stages must have distinct path/high-ground layouts");

  // High-ground tiles must never overlap path tiles
  for (const stage of STAGE_CATALOG) {
    for (const hg of stage.highGroundTiles) {
      const terrain = getTileTerrainForStage(stage.id, hg.col, hg.row);
      assert(terrain === "HIGH_GROUND", `Stage ${stage.id} high ground tile (${hg.col},${hg.row}) overlaps path or ground`);
      totalSamples++;
    }
  }

  // Test across all 260 tiles in all 10 stages (2,600 tiles x 2 domains = 5,200 deployments)
  for (const stage of STAGE_CATALOG) {
    const st = {
      ...createInitialBattleState({
        seed: 202610,
        stageId: stage.id,
        mode: "STAGE",
        playerLevel: 5,
        loadout: ["archer", "frostmage"],
        heroStars: { archer: 1, frostmage: 1 } as any,
      }),
      gold: 999999,
    };

    for (let c = 0; c < GRID_COLS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const terrain = getTileTerrainForStage(stage.id, c, r);
        const resGround = applyCommand(st, { kind: "DEPLOY", tick: 0, heroId: "archer", col: c, row: r });
        const resHg = applyCommand(st, { kind: "DEPLOY", tick: 0, heroId: "frostmage", col: c, row: r });
        totalSamples += 2;

        if (terrain === "PATH") {
          assertRejection(resGround, "TILE_IS_PATH", `Stage ${stage.id} (${c},${r}) PATH ground hero`);
          assertRejection(resHg, "TILE_IS_PATH", `Stage ${stage.id} (${c},${r}) PATH high-ground hero`);
        } else if (terrain === "GROUND") {
          assert(resGround.ok, `Stage ${stage.id} (${c},${r}) GROUND must accept ground hero`);
          assertRejection(resHg, "TERRAIN_MISMATCH", `Stage ${stage.id} (${c},${r}) GROUND high-ground hero`);
        } else if (terrain === "HIGH_GROUND") {
          assertRejection(resGround, "TERRAIN_MISMATCH", `Stage ${stage.id} (${c},${r}) HIGH_GROUND ground hero`);
          assert(resHg.ok, `Stage ${stage.id} (${c},${r}) HIGH_GROUND must accept high-ground hero`);
        }
      }
    }

    // Out-of-bounds checks for this stage
    const oobCoords = [
      { col: -1, row: 0 },
      { col: GRID_COLS, row: 0 },
      { col: 0, row: -1 },
      { col: 0, row: GRID_ROWS },
    ];
    for (const oob of oobCoords) {
      const oobRes = applyCommand(st, { kind: "DEPLOY", tick: 0, heroId: "archer", col: oob.col, row: oob.row });
      assertRejection(oobRes, "TILE_OUT_OF_BOUNDS", `Stage ${stage.id} OOB (${oob.col},${oob.row})`);
      totalSamples++;
    }
  }

  // =========================================================================
  // Invariant 4: Passive Hero HERO_HAS_NO_SKILL Guard, Active Skill Cooldown/Silence Guard,
  //             Cross-Progression Unlocks & Elemental Synergy
  // =========================================================================

  // 1. applyStageVictoryUnlocks rules
  for (let n = 1; n <= 10; n++) {
    const easyUnlock = applyStageVictoryUnlocks({}, n, "EASY");
    assert(easyUnlock[stageDifficultyKey(n, "EASY")] === true, `Stage ${n}:EASY must be unlocked`);
    assert(easyUnlock[stageDifficultyKey(n, "MEDIUM")] === true, `Winning Stage ${n} EASY must unlock Stage ${n} MEDIUM`);
    if (n < 10) {
      assert(easyUnlock[stageDifficultyKey(n + 1, "EASY")] === true, `Winning Stage ${n} EASY must unlock Stage ${n + 1} EASY`);
    } else {
      assert(!easyUnlock[stageDifficultyKey(11, "EASY")], "Stage 11 EASY must not be unlocked on Stage 10 clear");
    }
    assert(!easyUnlock[stageDifficultyKey(n, "HARD")], `Stage ${n} HARD must NOT unlock on EASY victory`);

    const medUnlock = applyStageVictoryUnlocks({}, n, "MEDIUM");
    assert(medUnlock[stageDifficultyKey(n, "MEDIUM")] === true, `Stage ${n}:MEDIUM must be unlocked`);
    assert(medUnlock[stageDifficultyKey(n, "HARD")] === true, `Winning Stage ${n} MEDIUM must unlock Stage ${n} HARD`);
    totalSamples += 5;
  }

  // Progressive unlock chain across all 10 stages
  let progressionMap: Readonly<Record<string, boolean>> = { [stageDifficultyKey(1, "EASY")]: true };
  for (let n = 1; n <= 10; n++) {
    assert(isStageDifficultyUnlocked({ unlockedStageDifficulties: progressionMap } as any, n, "EASY"), `Stage ${n} EASY must be unlocked in chain`);
    progressionMap = applyStageVictoryUnlocks(progressionMap, n, "EASY");
    assert(isStageDifficultyUnlocked({ unlockedStageDifficulties: progressionMap } as any, n, "MEDIUM"), `Stage ${n} MEDIUM must be unlocked after EASY clear`);
    progressionMap = applyStageVictoryUnlocks(progressionMap, n, "MEDIUM");
    assert(isStageDifficultyUnlocked({ unlockedStageDifficulties: progressionMap } as any, n, "HARD"), `Stage ${n} HARD must be unlocked after MEDIUM clear`);
    totalSamples += 3;
  }

  // 2. computeActiveSynergies & Synergy Buffs
  const emptySyn = computeActiveSynergies([]);
  assert(emptySyn.every((s) => !s.active && s.deployedUnits === 0), "Empty synergy list must have 0 units and be inactive");
  totalSamples++;

  for (const el of ALL_ELEMENTS) {
    const singleUnit = computeActiveSynergies([{ heroId: ALL_HERO_IDS.find((id) => HERO_CATALOG[id].element === el)! }]);
    const elSyn = singleUnit.find((s) => s.element === el)!;
    assert(!elSyn.active && elSyn.deployedUnits === 1, `1 unit of ${el} must not activate synergy`);
    totalSamples++;
  }

  // FLAME Synergy (2+ FLAME units -> +25% FLAME damage)
  const flameSyn = computeActiveSynergies([{ heroId: "archer" }, { heroId: "pyromancer" }]);
  const flameBonus = flameSyn.find((s) => s.element === "FLAME")!;
  assert(flameBonus.active && flameBonus.deployedUnits === 2, "2 FLAME units must activate FLAME synergy");
  const baseArcherDmg = getHeroEffectiveDamage(makeDummyHero("archer"), emptySyn);
  const buffedArcherDmg = getHeroEffectiveDamage(makeDummyHero("archer"), flameSyn);
  assert(buffedArcherDmg > baseArcherDmg, "FLAME synergy must increase FLAME hero effective damage");
  assert(buffedArcherDmg === Math.round(baseArcherDmg * 1.25), "FLAME synergy must increase damage by exactly +25%");
  const nonFlameDmgWithFlameSyn = getHeroEffectiveDamage(makeDummyHero("frostarcher"), flameSyn);
  const nonFlameDmgBase = getHeroEffectiveDamage(makeDummyHero("frostarcher"), emptySyn);
  assert(nonFlameDmgWithFlameSyn === nonFlameDmgBase, "FLAME synergy must not increase non-FLAME hero damage");
  totalSamples += 5;

  // SOLAR Synergy (2+ SOLAR units -> +20% all heroes damage)
  // Paladin (SOLAR) + Solariseraph (SOLAR)
  const solarSyn = computeActiveSynergies([{ heroId: "paladin" }, { heroId: "solariseraph" }]);
  const solarBonus = solarSyn.find((s) => s.element === "SOLAR")!;
  assert(solarBonus.active && solarBonus.deployedUnits === 2, "2 SOLAR units must activate SOLAR synergy");
  const frostArcherDmgSolar = getHeroEffectiveDamage(makeDummyHero("frostarcher"), solarSyn);
  assert(frostArcherDmgSolar > nonFlameDmgBase, "SOLAR synergy must increase all hero effective damage");
  assert(frostArcherDmgSolar === Math.round(nonFlameDmgBase * 1.2), "SOLAR synergy must increase damage by exactly +20%");
  totalSamples += 3;

  // THUNDER Synergy (2+ THUNDER units -> -20% cooldown)
  // Thunderlord (THUNDER) + Tempestarchon (THUNDER)
  const thunderSyn = computeActiveSynergies([{ heroId: "thunderlord" }, { heroId: "tempestarchon" }]);
  const thunderBonus = thunderSyn.find((s) => s.element === "THUNDER")!;
  assert(thunderBonus.active && thunderBonus.deployedUnits === 2, "2 THUNDER units must activate THUNDER synergy");
  const baseThunderCd = getHeroSkillCooldownTicks("thunderlord", 1, emptySyn);
  const buffedThunderCd = getHeroSkillCooldownTicks("thunderlord", 1, thunderSyn);
  assert(buffedThunderCd < baseThunderCd, "THUNDER synergy must decrease hero skill cooldown ticks");
  totalSamples += 3;

  // FROST Synergy (2+ FROST units -> active)
  const frostSyn = computeActiveSynergies([{ heroId: "frostarcher" }, { heroId: "frostmage" }]);
  const frostBonusObj = frostSyn.find((s) => s.element === "FROST")!;
  assert(frostBonusObj.active && frostBonusObj.deployedUnits === 2, "2 FROST units must activate FROST synergy");
  totalSamples++;

  // WATER, EARTH, DARK Synergies (2+ units -> active)
  const waterSyn = computeActiveSynergies([{ heroId: "tidecaller" }, { heroId: "hydramage" }]);
  const waterBonus = waterSyn.find((s) => s.element === "WATER")!;
  assert(waterBonus.active && waterBonus.deployedUnits === 2, "2 WATER units must activate WATER synergy");

  const earthSyn = computeActiveSynergies([{ heroId: "stoneguard" }, { heroId: "golemcrusher" }]);
  const earthBonus = earthSyn.find((s) => s.element === "EARTH")!;
  assert(earthBonus.active && earthBonus.deployedUnits === 2, "2 EARTH units must activate EARTH synergy");

  const darkSyn = computeActiveSynergies([{ heroId: "shadowimp" }, { heroId: "darklock" }]);
  const darkBonus = darkSyn.find((s) => s.element === "DARK")!;
  assert(darkBonus.active && darkBonus.deployedUnits === 2, "2 DARK units must activate DARK synergy");
  totalSamples += 3;

  // 3. Passive Hero HERO_HAS_NO_SKILL Guard (14 COMMON + 12 UNCOMMON = 26 heroes)
  const passiveHeroes = ALL_HERO_IDS.filter(
    (id) => HERO_CATALOG[id].rarity === "COMMON" || HERO_CATALOG[id].rarity === "UNCOMMON"
  );
  assert(passiveHeroes.length === 26, `Expected 26 passive heroes, got ${passiveHeroes.length}`);

  for (const passiveId of passiveHeroes) {
    const tile = getValidTilesForHero(1, passiveId)[0]!;
    let st = {
      ...createInitialBattleState({
        seed: 202610,
        stageId: 1,
        mode: "STAGE",
        playerLevel: 6,
        loadout: [passiveId],
        heroStars: { [passiveId]: 1 } as any,
      }),
      gold: 999999,
    };

    const dep = applyCommand(st, {
      kind: "DEPLOY",
      tick: 0,
      heroId: passiveId,
      col: tile.col,
      row: tile.row,
    });
    assert(dep.ok, `Deploy must succeed for passive hero ${passiveId}`);
    st = dep.state;
    const heroInstance = st.deployedHeroes[0]!;

    // Advance tick past 100
    st = { ...st, tick: 120 };

    // CAST_SKILL on passive hero must reject with HERO_HAS_NO_SKILL
    const castRes = applyCommand(st, {
      kind: "CAST_SKILL",
      tick: 120,
      instanceId: heroInstance.instanceId,
    });
    assertRejection(
      castRes,
      "HERO_HAS_NO_SKILL",
      `Passive hero ${passiveId} (${HERO_CATALOG[passiveId].rarity}) must reject CAST_SKILL with HERO_HAS_NO_SKILL`
    );
    totalSamples += 3;
  }

  // 4. Active Hero Cooldown, Silence Guard, & Sanctuary Cleanse (9 RARE + 5 ULTRA_RARE = 14 heroes)
  const activeHeroes = ALL_HERO_IDS.filter(
    (id) => HERO_CATALOG[id].rarity === "RARE" || HERO_CATALOG[id].rarity === "ULTRA_RARE"
  );
  assert(activeHeroes.length === 14, `Expected 14 active heroes, got ${activeHeroes.length}`);

  for (const activeId of activeHeroes) {
    const def = HERO_CATALOG[activeId];
    const heroTile = getValidTilesForHero(1, activeId)[0]!;
    // Place a bystander hero on ground to verify cleanse affects all towers
    const bystanderTile = getValidTilesForHero(1, "archer").find(
      (t) => !(t.col === heroTile.col && t.row === heroTile.row)
    )!;

    let st = {
      ...createInitialBattleState({
        seed: 202610,
        stageId: 1,
        mode: "STAGE",
        playerLevel: 6,
        loadout: [activeId, "archer"],
        heroStars: { [activeId]: 1, archer: 1 } as any,
      }),
      gold: 999999,
    };

    const depActive = applyCommand(st, {
      kind: "DEPLOY",
      tick: 0,
      heroId: activeId,
      col: heroTile.col,
      row: heroTile.row,
    });
    assert(depActive.ok, `Deploy failed for active hero ${activeId}`);
    st = depActive.state;
    const activeInstanceId = st.deployedHeroes.find((h) => h.heroId === activeId)!.instanceId;

    const depBystander = applyCommand(st, {
      kind: "DEPLOY",
      tick: 0,
      heroId: "archer",
      col: bystanderTile.col,
      row: bystanderTile.row,
    });
    assert(depBystander.ok, "Deploy failed for bystander archer");
    st = depBystander.state;

    // Check 1: SKILL_ON_COOLDOWN at tick 0
    const cdRes = applyCommand(st, {
      kind: "CAST_SKILL",
      tick: 0,
      instanceId: activeInstanceId,
    });
    assertRejection(cdRes, "SKILL_ON_COOLDOWN", `${activeId} CAST_SKILL at tick 0 must be on cooldown`);
    totalSamples += 3;

    // Advance to tick 50 (past initial cooldown of 30) and silence all heroes
    const silencedState: BattleState = {
      ...st,
      tick: 50,
      deployedHeroes: st.deployedHeroes.map((h) => ({ ...h, silencedUntilTick: 90 })),
    };

    const isCleanse = def.skillEffect?.kind === "SANCTUARY_CLEANSE";
    const silencedCast = applyCommand(silencedState, {
      kind: "CAST_SKILL",
      tick: 50,
      instanceId: activeInstanceId,
    });

    if (isCleanse) {
      // SANCTUARY_CLEANSE heroes (paladin, solariseraph) must break silence and cleanse ALL towers
      assert(
        silencedCast.ok,
        `SANCTUARY_CLEANSE hero ${activeId} must successfully cast skill even when silenced`
      );
      assert(
        silencedCast.state.deployedHeroes.every((h) => h.silencedUntilTick === 0),
        `SANCTUARY_CLEANSE hero ${activeId} must cleanse silence for ALL towers`
      );
      const expectedCd = getHeroSkillCooldownTicks(activeId, 1, silencedCast.state.activeSynergies);
      const updatedCaster = silencedCast.state.deployedHeroes.find((h) => h.instanceId === activeInstanceId)!;
      assert(
        updatedCaster.skillReadyAtTick === 50 + expectedCd,
        `SANCTUARY_CLEANSE hero ${activeId} cooldown must be set to tick + cooldown`
      );
      assert(updatedCaster.totalSkillCasts === 1, `${activeId} totalSkillCasts must increment to 1`);
      totalSamples += 4;
    } else {
      // Non-cleanse heroes must reject with HERO_SILENCED
      assertRejection(
        silencedCast,
        "HERO_SILENCED",
        `Silenced active hero ${activeId} must reject CAST_SKILL with HERO_SILENCED`
      );
      totalSamples++;

      // When ready and unsilenced (advance tick to 100, which is past silencedUntilTick 90 and skillReadyAtTick 30)
      const unsilencedState: BattleState = {
        ...st,
        tick: 100,
      };
      const readyCast = applyCommand(unsilencedState, {
        kind: "CAST_SKILL",
        tick: 100,
        instanceId: activeInstanceId,
      });
      assert(readyCast.ok, `Active hero ${activeId} must successfully cast skill when ready`);
      const expectedCd = getHeroSkillCooldownTicks(activeId, 1, readyCast.state.activeSynergies);
      const updatedCaster = readyCast.state.deployedHeroes.find((h) => h.instanceId === activeInstanceId)!;
      assert(
        updatedCaster.skillReadyAtTick === 100 + expectedCd,
        `Active hero ${activeId} cooldown must be set to tick + cooldown`
      );
      assert(updatedCaster.totalSkillCasts === 1, `${activeId} totalSkillCasts must increment to 1`);
      totalSamples += 3;
    }
  }

  // =========================================================================
  // Invariant 5: 20-Pull ULTRA_RARE Guarantee & 10-Pull RARE+ Guarantee across the 40-Hero Pool
  // =========================================================================
  let gachaProf = { ...createDefaultProfile("GachaTester"), metaCoins: 1000 * GACHA_PULL_COST };
  let gachaSeed = 1337;
  let totalPulls = 0;
  const pulledRarities = new Set<HeroRarity>();
  const pulledHeroIds = new Set<HeroId>();

  while (totalPulls < 1000) {
    if (totalPulls % 20 < 10) {
      // Single pull
      const prevUltraPity = gachaProf.pityCounter;
      const prevRarePity = gachaProf.rarePityCounter;
      const out = pullGachaWithSeed(gachaProf, gachaSeed);
      assert(out.ok && out.profile.metaCoins >= 0, "Gacha pull must succeed and metaCoins must be non-negative");
      assert(Boolean(out.pulledHeroId), "Gacha pull must return a pulledHeroId");
      assert(ALL_HERO_IDS.includes(out.pulledHeroId!), `Pulled hero ${out.pulledHeroId} not in 40-hero catalog`);
      assert(
        HERO_CATALOG[out.pulledHeroId!].rarity === out.pulledRarity,
        `Pulled hero rarity mismatch for ${out.pulledHeroId}`
      );
      pulledRarities.add(out.pulledRarity!);
      pulledHeroIds.add(out.pulledHeroId!);

      gachaSeed = out.nextRngSeed ?? gachaSeed + 997;

      if (prevUltraPity + 1 >= ULTRA_RARE_PITY_THRESHOLD) {
        assert(out.pulledRarity === "ULTRA_RARE", `Pity 20 must guarantee ULTRA_RARE (got ${out.pulledRarity})`);
      }
      if (prevRarePity + 1 >= RARE_PITY_THRESHOLD) {
        assert(
          out.pulledRarity === "RARE" || out.pulledRarity === "ULTRA_RARE",
          `Rare pity 10 must guarantee RARE or ULTRA_RARE (got ${out.pulledRarity})`
        );
      }

      gachaProf = out.profile;
      assert(gachaProf.pityCounter < ULTRA_RARE_PITY_THRESHOLD, `pityCounter must never reach 20 after pull (got ${gachaProf.pityCounter})`);
      assert(gachaProf.rarePityCounter < RARE_PITY_THRESHOLD, `rarePityCounter must never reach 10 after pull (got ${gachaProf.rarePityCounter})`);
      totalPulls++;
      totalSamples += 3;
    } else {
      // 10-batch pull
      const outBatch = pullGachaBatchWithSeed(gachaProf, 10, gachaSeed);
      assert(outBatch.ok && outBatch.profile.metaCoins >= 0, "Batch pull must succeed and metaCoins must be non-negative");
      for (const item of outBatch.results) {
        assert(ALL_HERO_IDS.includes(item.heroId), `Batch pulled hero ${item.heroId} not in 40-hero catalog`);
        assert(
          HERO_CATALOG[item.heroId].rarity === item.rarity,
          `Batch pulled hero rarity mismatch for ${item.heroId}`
        );
        pulledRarities.add(item.rarity);
        pulledHeroIds.add(item.heroId);
      }

      gachaSeed = gachaSeed + 10007;
      gachaProf = outBatch.profile;

      assert(gachaProf.pityCounter < ULTRA_RARE_PITY_THRESHOLD, "pityCounter exceeded 20 after batch pull");
      assert(gachaProf.rarePityCounter < RARE_PITY_THRESHOLD, "rarePityCounter exceeded 10 after batch pull");
      totalPulls += 10;
      totalSamples += 12;
    }
  }

  assert(pulledRarities.size === 4, "All 4 rarities must be pulled across 1,000 pulls");
  assert(pulledHeroIds.size >= 35, `Expected diverse hero pulls across 40-hero pool (got ${pulledHeroIds.size})`);
  totalSamples += 2;

  // Insufficient coin checks
  const brokeProf = { ...createDefaultProfile("BrokeUser"), metaCoins: 50 };
  const brokePull = pullGachaWithSeed(brokeProf, gachaSeed);
  assert(!brokePull.ok && brokePull.reason === "INSUFFICIENT_COINS", "Expected INSUFFICIENT_COINS for single pull");
  const brokeBatch = pullGachaBatchWithSeed({ ...createDefaultProfile("BrokeUser"), metaCoins: 900 }, 10, gachaSeed);
  assert(!brokeBatch.ok && brokeBatch.reason === "INSUFFICIENT_COINS", "Expected INSUFFICIENT_COINS for 10-pull batch");
  totalSamples += 2;

  // =========================================================================
  // Invariant 6: Bitwise Replay Determinism & Stage 10-Wave Victory
  // =========================================================================
  const all5Stars = Object.fromEntries(ALL_HERO_IDS.map((id) => [id, 5])) as Record<HeroId, number>;

  const baseConfig: BattleConfig = {
    seed: 202610,
    stageId: 1,
    mode: "STAGE",
    playerLevel: 6,
    loadout: ["paladin", "chronoweaver", "thunderlord", "frostmage", "pyromancer", "archer"],
    heroStars: all5Stars,
  };

  const replayCmds: GameCommand[] = [
    { kind: "DEPLOY", tick: 0, heroId: "paladin", col: 5, row: 1 },
    { kind: "DEPLOY", tick: 0, heroId: "frostmage", col: 8, row: 2 },
    { kind: "START_WAVE", tick: 0 },
    { kind: "CAST_SKILL", tick: 40, instanceId: 2 },
  ];
  const rep1 = replaySimulation(baseConfig, replayCmds, 180);
  const rep2 = replaySimulation(baseConfig, replayCmds, 180);
  assert(JSON.stringify(rep1) === JSON.stringify(rep2), "Replay simulation must be 100% bitwise deterministic");
  totalSamples += 2;

  let winState = {
    ...createInitialBattleState(baseConfig),
    gold: 100000,
  };
  const winPlacements: { heroId: HeroId; col: number; row: number }[] = [
    { heroId: "paladin", col: 5, row: 1 },
    { heroId: "chronoweaver", col: 4, row: 3 },
    { heroId: "thunderlord", col: 5, row: 5 },
    { heroId: "frostmage", col: 8, row: 2 },
    { heroId: "pyromancer", col: 11, row: 6 },
    { heroId: "archer", col: 2, row: 3 },
  ];

  for (const p of winPlacements) {
    const dep = applyCommand(winState, { kind: "DEPLOY", tick: 0, ...p });
    assert(dep.ok, `Expected deploy to succeed for ${p.heroId}`);
    winState = dep.state;
    const inst = winState.deployedHeroes[winState.deployedHeroes.length - 1]!;
    for (let l = 1; l < 5; l++) {
      winState = applyCommand(winState, { kind: "UPGRADE", tick: 0, instanceId: inst.instanceId }).state;
    }
    totalSamples += 5;
  }

  winState = applyCommand(winState, { kind: "START_WAVE", tick: 0 }).state;
  for (let t = 0; t < 6500 && winState.phase !== "VICTORY" && winState.phase !== "DEFEAT"; t++) {
    winState = stepSimulationTick(winState);
    totalSamples++;
  }

  assert(winState.phase === "VICTORY" && winState.wave === 10, "Expected Stage mode Wave 10 clear to reach VICTORY");

  const frozenCheck = stepSimulationTick(winState);
  assert(frozenCheck === winState, "Simulation tick must freeze and not mutate when VICTORY is reached");
  totalSamples += 2;

  const elapsed = (performance.now() - t0).toFixed(1);
  console.log(`FORMAL INVARIANT SUITE PASSED: 6/6 invariants verified (${totalSamples} samples in ${elapsed}ms)`);
}

runFormalSuite(process.argv.includes("--inject-fault"));
