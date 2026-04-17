(function (root) {
  "use strict";

  var K_MULTIPLIER = 1.2;
  var SQRT_252 = Math.sqrt(252);
  var PUT_MIN_OTM = 0.02;
  var CALL_MIN_OTM = 0.015;

  function assertPositive(value, label) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(label + " 必须是大于 0 的数字。");
    }
  }

  function chooseAMultiplier(absGapPct) {
    if (absGapPct <= 0.002) return 1.2;
    if (absGapPct <= 0.004) return 1.4;
    if (absGapPct <= 0.006) return 1.6;
    if (absGapPct <= 0.008) return 1.8;
    if (absGapPct <= 0.015) return 2.0;
    if (absGapPct <= 0.02) return 2.5;
    return 3.0;
  }

  function gapBucket(absGapPct) {
    if (absGapPct <= 0.002) return "0.0%-0.2%";
    if (absGapPct <= 0.004) return "0.2%-0.4%";
    if (absGapPct <= 0.006) return "0.4%-0.6%";
    if (absGapPct <= 0.008) return "0.6%-0.8%";
    if (absGapPct <= 0.015) return "0.8%-1.5%";
    if (absGapPct <= 0.02) return "1.5%-2.0%";
    return ">2.0%";
  }

  function determineTradeSide(gapPct) {
    return {
      tradeSide: gapPct > 0 ? "CALL" : "PUT",
      directionSource: "Gap Rule",
      overrideApplied: false,
      gapdownExemption: false
    };
  }

  function getFivePointStrike(targetPrice, tradeSide, mode) {
    if (mode === "outer") {
      return tradeSide === "PUT" ? Math.floor(targetPrice / 5) * 5 : Math.ceil(targetPrice / 5) * 5;
    }

    if (mode === "inner") {
      return tradeSide === "PUT" ? Math.ceil(targetPrice / 5) * 5 : Math.floor(targetPrice / 5) * 5;
    }

    throw new Error("Unknown strike rounding mode: " + mode);
  }

  function calculateReferenceLevels(spxPrevClose) {
    var levels = [0.015, 0.02, 0.025, 0.03];
    return levels.map(function (pct) {
      return {
        pct: pct,
        downLevel: spxPrevClose * (1 - pct),
        upLevel: spxPrevClose * (1 + pct)
      };
    });
  }

  function calculateStrategy(inputs) {
    var spxPrevClose = Number(inputs.spxPrevClose);
    var prevVixClose = Number(inputs.prevVixClose);
    var spxOpen = Number(inputs.spxOpen);

    assertPositive(spxPrevClose, "SPX 昨收");
    assertPositive(prevVixClose, "VIX1D 昨收");
    assertPositive(spxOpen, "SPX 今日开盘价");

    var gapPct = spxOpen / spxPrevClose - 1;
    var absGapPct = Math.abs(gapPct);
    var gapDirection = gapPct > 0 ? "Gap Up" : "Gap Down / Flat";
    var baseExpectedMovePct = prevVixClose / 100 / SQRT_252;
    var expectedMoveLowPrice = spxPrevClose * (1 - baseExpectedMovePct);
    var expectedMoveHighPrice = spxPrevClose * (1 + baseExpectedMovePct);
    var moveAfterKPct = baseExpectedMovePct * K_MULTIPLIER;
    var aMultiplier = chooseAMultiplier(absGapPct);
    var rawOtmPct = moveAfterKPct * aMultiplier;
    var directionInfo = determineTradeSide(gapPct);
    var otmFloorPct = directionInfo.tradeSide === "PUT" ? PUT_MIN_OTM : CALL_MIN_OTM;
    var floorApplied = rawOtmPct < otmFloorPct;
    var finalOtmPct = floorApplied ? otmFloorPct : rawOtmPct;
    var exactTargetPrice =
      directionInfo.tradeSide === "PUT"
        ? spxPrevClose * (1 - finalOtmPct)
        : spxPrevClose * (1 + finalOtmPct);

    return {
      spxPrevClose: spxPrevClose,
      prevVixClose: prevVixClose,
      spxOpen: spxOpen,
      gapPct: gapPct,
      absGapPct: absGapPct,
      gapBucket: gapBucket(absGapPct),
      gapDirection: gapDirection,
      baseExpectedMovePct: baseExpectedMovePct,
      expectedMoveLowPrice: expectedMoveLowPrice,
      expectedMoveHighPrice: expectedMoveHighPrice,
      kMultiplier: K_MULTIPLIER,
      moveAfterKPct: moveAfterKPct,
      aMultiplier: aMultiplier,
      rawOtmPct: rawOtmPct,
      tradeSide: directionInfo.tradeSide,
      directionSource: directionInfo.directionSource,
      overrideApplied: directionInfo.overrideApplied,
      gapdownExemption: directionInfo.gapdownExemption,
      otmFloorPct: otmFloorPct,
      floorApplied: floorApplied,
      finalOtmPct: finalOtmPct,
      exactTargetPrice: exactTargetPrice,
      outerFivePointStrike: getFivePointStrike(exactTargetPrice, directionInfo.tradeSide, "outer"),
      innerFivePointStrike: getFivePointStrike(exactTargetPrice, directionInfo.tradeSide, "inner"),
      referenceLevels: calculateReferenceLevels(spxPrevClose)
    };
  }

  root.SPXStrategyCalculatorCore = {
    K_MULTIPLIER: K_MULTIPLIER,
    PUT_MIN_OTM: PUT_MIN_OTM,
    CALL_MIN_OTM: CALL_MIN_OTM,
    chooseAMultiplier: chooseAMultiplier,
    gapBucket: gapBucket,
    determineTradeSide: determineTradeSide,
    getFivePointStrike: getFivePointStrike,
    calculateReferenceLevels: calculateReferenceLevels,
    calculateStrategy: calculateStrategy
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
