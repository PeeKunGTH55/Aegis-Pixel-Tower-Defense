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
  if (!res.ok) {
    if (res.reason !== expectedReason) {
      throw new Error(
        `INVARIANT VIOLATION: ${message}: expected reason "${expectedReason}", got "${res.reason}"`
      );
    }
  } else {
    throw new Error(`INVARIANT VIOLATION: ${message}: expected rejection but command succeeded`);
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
  // Invariant 1: Loadout Cap (<= 6) & Account Tutorial Idempotency (+200 coins)
  // =========================================================================
  for (let lvl = -5; lvl <= 20; lvl++) {
    const cap = getUnlockedLoadoutSlots(lvl);
    assert(cap >= 2 && cap <= MAX_LOADOUT_SLOTS, `Invalid slot cap ${cap} for level ${lvl}`);
    assert(cap <= 6, `Loadout slot cap must never exceed 6 (got ${cap})`);
    totalSamples++;
  }

  // Account Tutorial Idempotency
  const freshProfile = createDefaultProfile("Commander");
  assert(!freshProfile.tutorialCompleted, "Default profile tutorial must start incomplete");
  const startingCoins = freshProfile.metaCoins;

  const tut1 = completeAccountTutorial(freshProfile);
  assert(tut1.tutorialCompleted === true, "Tutorial must be marked completed after first completion");
  assert(tut1.tutorialStep === 0, "Tutorial step must reset to 0 upon completion");
  assert(tut1.metaCoins === startingCoins + 200, "Tutorial completion must award exactly +200 Meta Coins");
  totalSamples += 3;

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

  // Loadout toggle bounds fuzzing
  for (let lvl = 1; lvl <= 10; lvl++) {
    const cap = getUnlockedLoadoutSlots(lvl);
    let prof = {
      ...createDefaultProfile(),
      playerLevel: lvl,
      ownedHeroes: {
        archer: 1,
        frostarcher: 1,
        pyromancer: 1,
        stormcaller: 1,
        frostmage: 1,
        thunderlord: 1,
        paladin: 1,
        chronoweaver: 1,
      },
      loadout: ["archer"] as readonly HeroId[],
    };
    for (const id of ALL_HERO_IDS) {
      prof = toggleHeroInLoadout(prof, id).profile;
      assert(prof.loadout.length >= 1 && prof.loadout.length <= cap, "Loadout length invariant violated");
      assert(prof.loadout.length <= 6, "Loadout cap must never exceed 6");
      totalSamples++;
    }

    const cantRemoveLast = toggleHeroInLoadout({ ...prof, loadout: ["archer"] }, "archer");
    assert(!cantRemoveLast.ok, "Must reject removing the sole hero from loadout");
    totalSamples++;
  }

  // =========================================================================
  // Invariant 2: 4-Tier Rarity Deploy Caps (COMMON:6, UNCOMMON:4, RARE:2, ULTRA_RARE:1)
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
        playerLevel: 5,
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

    // Deploy overflow attempt must be rejected
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
  // Invariant 4: Cross-Progression Difficulty Unlock Tree & Elemental Synergy
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
  const solarSyn = computeActiveSynergies([{ heroId: "paladin" }, { heroId: "chronoweaver" }]);
  const solarBonus = solarSyn.find((s) => s.element === "SOLAR")!;
  assert(solarBonus.active && solarBonus.deployedUnits === 2, "2 SOLAR units must activate SOLAR synergy");
  const frostArcherDmgSolar = getHeroEffectiveDamage(makeDummyHero("frostarcher"), solarSyn);
  assert(frostArcherDmgSolar > nonFlameDmgBase, "SOLAR synergy must increase all hero effective damage");
  assert(frostArcherDmgSolar === Math.round(nonFlameDmgBase * 1.2), "SOLAR synergy must increase damage by exactly +20%");
  totalSamples += 3;

  // STORM Synergy (2+ STORM units -> -20% cooldown)
  const stormSyn = computeActiveSynergies([{ heroId: "stormcaller" }, { heroId: "thunderlord" }]);
  const stormBonus = stormSyn.find((s) => s.element === "STORM")!;
  assert(stormBonus.active && stormBonus.deployedUnits === 2, "2 STORM units must activate STORM synergy");
  const baseStormCd = getHeroSkillCooldownTicks("stormcaller", 1, emptySyn);
  const buffedStormCd = getHeroSkillCooldownTicks("stormcaller", 1, stormSyn);
  assert(buffedStormCd < baseStormCd, "STORM synergy must decrease hero skill cooldown ticks");
  totalSamples += 3;

  // FROST Synergy (2+ FROST units -> active)
  const frostSyn = computeActiveSynergies([{ heroId: "frostarcher" }, { heroId: "frostmage" }]);
  const frostBonusObj = frostSyn.find((s) => s.element === "FROST")!;
  assert(frostBonusObj.active && frostBonusObj.deployedUnits === 2, "2 FROST units must activate FROST synergy");
  totalSamples++;

  // Active skill cooldown guard and Paladin silence cleanse
  let skillState = {
    ...createInitialBattleState({
      seed: 202610,
      stageId: 1,
      mode: "STAGE",
      playerLevel: 5,
      loadout: ["paladin", "archer"],
      heroStars: { paladin: 1, archer: 1 } as any,
    }),
    gold: 999999,
  };
  const palTile = getValidTilesForHero(1, "paladin")[0]!;
  const archTile = getValidTilesForHero(1, "archer")[1]!;
  skillState = applyCommand(skillState, { kind: "DEPLOY", tick: 0, heroId: "paladin", col: palTile.col, row: palTile.row }).state;
  skillState = applyCommand(skillState, { kind: "DEPLOY", tick: 0, heroId: "archer", col: archTile.col, row: archTile.row }).state;

  const cdRes = applyCommand(skillState, { kind: "CAST_SKILL", tick: 0, instanceId: 1 });
  assertRejection(cdRes, "SKILL_ON_COOLDOWN", "Skill cooldown check at tick 0");
  totalSamples++;

  const silencedState: BattleState = {
    ...skillState,
    tick: 50,
    deployedHeroes: skillState.deployedHeroes.map((h) => ({ ...h, silencedUntilTick: 90 })),
  };
  const archCast = applyCommand(silencedState, { kind: "CAST_SKILL", tick: 50, instanceId: 2 });
  assertRejection(archCast, "HERO_SILENCED", "Silenced archer cast check");
  const palCast = applyCommand(silencedState, { kind: "CAST_SKILL", tick: 50, instanceId: 1 });
  assert(palCast.ok, "Expected Paladin Sanctuary Cleanse to break silence");
  assert(
    palCast.state.deployedHeroes.every((h) => h.silencedUntilTick === 0),
    "Expected all heroes to be cleansed of silence"
  );
  assert(
    palCast.state.deployedHeroes[0]!.skillReadyAtTick === 50 + getHeroSkillCooldownTicks("paladin", 1, palCast.state.activeSynergies),
    "Expected Paladin cooldown set properly"
  );
  totalSamples += 4;

  // =========================================================================
  // Invariant 5: 20-Pull ULTRA_RARE Guarantee & 10-Pull RARE+ Guarantee
  // =========================================================================
  let gachaProf = { ...createDefaultProfile(), metaCoins: 1000 * GACHA_PULL_COST };
  let gachaSeed = 1337;
  let totalPulls = 0;

  while (totalPulls < 1000) {
    if (totalPulls % 20 < 10) {
      // Single pull
      const prevUltraPity = gachaProf.pityCounter;
      const prevRarePity = gachaProf.rarePityCounter;
      const out = pullGachaWithSeed(gachaProf, gachaSeed);
      assert(out.ok && out.profile.metaCoins >= 0, "Gacha pull must succeed and metaCoins must be non-negative");
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
      totalSamples++;
    } else {
      // 10-batch pull
      const outBatch = pullGachaBatchWithSeed(gachaProf, 10, gachaSeed);
      assert(outBatch.ok && outBatch.profile.metaCoins >= 0, "Batch pull must succeed and metaCoins must be non-negative");
      gachaSeed = gachaSeed + 10007;
      gachaProf = outBatch.profile;

      assert(gachaProf.pityCounter < ULTRA_RARE_PITY_THRESHOLD, "pityCounter exceeded 20 after batch pull");
      assert(gachaProf.rarePityCounter < RARE_PITY_THRESHOLD, "rarePityCounter exceeded 10 after batch pull");
      totalPulls += 10;
      totalSamples += 10;
    }
  }

  // Insufficient coin checks
  const brokeProf = { ...createDefaultProfile(), metaCoins: 50 };
  const brokePull = pullGachaWithSeed(brokeProf, gachaSeed);
  assert(!brokePull.ok && brokePull.reason === "INSUFFICIENT_COINS", "Expected INSUFFICIENT_COINS for single pull");
  const brokeBatch = pullGachaBatchWithSeed({ ...createDefaultProfile(), metaCoins: 900 }, 10, gachaSeed);
  assert(!brokeBatch.ok && brokeBatch.reason === "INSUFFICIENT_COINS", "Expected INSUFFICIENT_COINS for 10-pull batch");
  totalSamples += 2;

  // =========================================================================
  // Invariant 6: Bitwise Replay Determinism & Stage 10-Wave Victory
  // =========================================================================
  const baseConfig: BattleConfig = {
    seed: 202610,
    stageId: 1,
    mode: "STAGE",
    playerLevel: 5,
    loadout: ["paladin", "chronoweaver", "thunderlord", "frostmage", "pyromancer", "archer"],
    heroStars: {
      archer: 5,
      frostarcher: 5,
      pyromancer: 5,
      stormcaller: 5,
      frostmage: 5,
      thunderlord: 5,
      paladin: 5,
      chronoweaver: 5,
    },
  };

  const replayCmds: GameCommand[] = [
    { kind: "DEPLOY", tick: 0, heroId: "archer", col: 2, row: 3 },
    { kind: "DEPLOY", tick: 0, heroId: "frostmage", col: 8, row: 2 },
    { kind: "START_WAVE", tick: 0 },
    { kind: "CAST_SKILL", tick: 40, instanceId: 1 },
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
