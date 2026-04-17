(function () {
  "use strict";

  if (typeof require === "function" && typeof globalThis.SPXStrategyCalculatorCore === "undefined") {
    require("./core.js");
  }

  var core = typeof globalThis !== "undefined"
    ? globalThis.SPXStrategyCalculatorCore
    : this.SPXStrategyCalculatorCore;

  function approxEqual(left, right, tolerance) {
    return Math.abs(left - right) <= tolerance;
  }

  function refA(absGapPct) {
    if (absGapPct <= 0.002) return 1.2;
    if (absGapPct <= 0.004) return 1.4;
    if (absGapPct <= 0.006) return 1.6;
    if (absGapPct <= 0.008) return 1.8;
    if (absGapPct <= 0.015) return 2.0;
    if (absGapPct <= 0.02) return 2.5;
    return 3.0;
  }

  function refSide(gapPct) {
    return {
      tradeSide: gapPct > 0 ? "CALL" : "PUT",
      directionSource: "Gap Rule",
      overrideApplied: false,
      gapdownExemption: false
    };
  }

  function refCalc(inputs) {
    var spxPrevClose = Number(inputs.spxPrevClose);
    var prevVixClose = Number(inputs.prevVixClose);
    var spxOpen = Number(inputs.spxOpen);
    var gapPct = spxOpen / spxPrevClose - 1;
    var absGapPct = Math.abs(gapPct);
    var baseExpectedMovePct = prevVixClose / 100 / Math.sqrt(252);
    var expectedMoveLowPrice = spxPrevClose * (1 - baseExpectedMovePct);
    var expectedMoveHighPrice = spxPrevClose * (1 + baseExpectedMovePct);
    var moveAfterKPct = baseExpectedMovePct * 1.2;
    var aMultiplier = refA(absGapPct);
    var rawOtmPct = moveAfterKPct * aMultiplier;
    var sideInfo = refSide(gapPct);
    var otmFloorPct = sideInfo.tradeSide === "PUT" ? 0.02 : 0.015;
    var finalOtmPct = rawOtmPct > otmFloorPct ? rawOtmPct : otmFloorPct;
    var exactTargetPrice = sideInfo.tradeSide === "PUT"
      ? spxPrevClose * (1 - finalOtmPct)
      : spxPrevClose * (1 + finalOtmPct);
    var outerFivePointStrike = sideInfo.tradeSide === "PUT"
      ? Math.floor(exactTargetPrice / 5) * 5
      : Math.ceil(exactTargetPrice / 5) * 5;
    var innerFivePointStrike = sideInfo.tradeSide === "PUT"
      ? Math.ceil(exactTargetPrice / 5) * 5
      : Math.floor(exactTargetPrice / 5) * 5;
    var referenceLevels = [
      { pct: 0.015, downLevel: spxPrevClose * 0.985, upLevel: spxPrevClose * 1.015 },
      { pct: 0.02, downLevel: spxPrevClose * 0.98, upLevel: spxPrevClose * 1.02 },
      { pct: 0.025, downLevel: spxPrevClose * 0.975, upLevel: spxPrevClose * 1.025 },
      { pct: 0.03, downLevel: spxPrevClose * 0.97, upLevel: spxPrevClose * 1.03 }
    ];

    return {
      gapPct: gapPct,
      absGapPct: absGapPct,
      baseExpectedMovePct: baseExpectedMovePct,
      expectedMoveLowPrice: expectedMoveLowPrice,
      expectedMoveHighPrice: expectedMoveHighPrice,
      moveAfterKPct: moveAfterKPct,
      aMultiplier: aMultiplier,
      rawOtmPct: rawOtmPct,
      tradeSide: sideInfo.tradeSide,
      directionSource: sideInfo.directionSource,
      overrideApplied: sideInfo.overrideApplied,
      gapdownExemption: sideInfo.gapdownExemption,
      otmFloorPct: otmFloorPct,
      finalOtmPct: finalOtmPct,
      exactTargetPrice: exactTargetPrice,
      outerFivePointStrike: outerFivePointStrike,
      innerFivePointStrike: innerFivePointStrike,
      referenceLevels: referenceLevels
    };
  }

  function createRng(seed) {
    var state = seed >>> 0;
    return function () {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function randomCase(rng) {
    var spxPrevClose = 3500 + rng() * 4500;
    var prevVixClose = 8 + rng() * 40;
    var gapPct = -0.03 + rng() * 0.06;
    var spxOpen = spxPrevClose * (1 + gapPct);
    return {
      spxPrevClose: Number(spxPrevClose.toFixed(4)),
      prevVixClose: Number(prevVixClose.toFixed(4)),
      spxOpen: Number(spxOpen.toFixed(4))
    };
  }

  function boundaryCases() {
    return [
      { spxPrevClose: 6000, prevVixClose: 25, spxOpen: 5991 },
      { spxPrevClose: 6000, prevVixClose: 14.2, spxOpen: 5993 },
      { spxPrevClose: 6000, prevVixClose: 14.2, spxOpen: 5969 },
      { spxPrevClose: 5000, prevVixClose: 18, spxOpen: 5010 },
      { spxPrevClose: 5000, prevVixClose: 18, spxOpen: 5020 },
      { spxPrevClose: 5000, prevVixClose: 18, spxOpen: 5040 },
      { spxPrevClose: 5000, prevVixClose: 18, spxOpen: 5075 },
      { spxPrevClose: 5000, prevVixClose: 18, spxOpen: 5100 },
      { spxPrevClose: 5000, prevVixClose: 14.8, spxOpen: 4975 },
      { spxPrevClose: 5000, prevVixClose: 14.8, spxOpen: 4974.5 }
    ];
  }

  function compareOutputs(actual, expected, label) {
    var floatTol = 1e-10;
    if (!approxEqual(actual.gapPct, expected.gapPct, floatTol)) throw new Error(label + ": gapPct mismatch");
    if (!approxEqual(actual.baseExpectedMovePct, expected.baseExpectedMovePct, floatTol)) throw new Error(label + ": baseExpectedMovePct mismatch");
    if (!approxEqual(actual.expectedMoveLowPrice, expected.expectedMoveLowPrice, 1e-8)) throw new Error(label + ": expectedMoveLowPrice mismatch");
    if (!approxEqual(actual.expectedMoveHighPrice, expected.expectedMoveHighPrice, 1e-8)) throw new Error(label + ": expectedMoveHighPrice mismatch");
    if (!approxEqual(actual.moveAfterKPct, expected.moveAfterKPct, floatTol)) throw new Error(label + ": moveAfterKPct mismatch");
    if (!approxEqual(actual.aMultiplier, expected.aMultiplier, floatTol)) throw new Error(label + ": aMultiplier mismatch");
    if (!approxEqual(actual.rawOtmPct, expected.rawOtmPct, floatTol)) throw new Error(label + ": rawOtmPct mismatch");
    if (!approxEqual(actual.otmFloorPct, expected.otmFloorPct, floatTol)) throw new Error(label + ": otmFloorPct mismatch");
    if (!approxEqual(actual.finalOtmPct, expected.finalOtmPct, floatTol)) throw new Error(label + ": finalOtmPct mismatch");
    if (!approxEqual(actual.exactTargetPrice, expected.exactTargetPrice, 1e-8)) throw new Error(label + ": exactTargetPrice mismatch");
    if (actual.outerFivePointStrike !== expected.outerFivePointStrike) throw new Error(label + ": outerFivePointStrike mismatch");
    if (actual.innerFivePointStrike !== expected.innerFivePointStrike) throw new Error(label + ": innerFivePointStrike mismatch");
    if (actual.tradeSide !== expected.tradeSide) throw new Error(label + ": tradeSide mismatch");
    if (actual.directionSource !== expected.directionSource) throw new Error(label + ": directionSource mismatch");
    if (actual.overrideApplied !== expected.overrideApplied) throw new Error(label + ": overrideApplied mismatch");
    if (actual.gapdownExemption !== expected.gapdownExemption) throw new Error(label + ": gapdownExemption mismatch");
    if (actual.referenceLevels.length !== expected.referenceLevels.length) throw new Error(label + ": referenceLevels length mismatch");

    for (var i = 0; i < actual.referenceLevels.length; i += 1) {
      if (!approxEqual(actual.referenceLevels[i].pct, expected.referenceLevels[i].pct, floatTol)) {
        throw new Error(label + ": referenceLevels pct mismatch");
      }
      if (!approxEqual(actual.referenceLevels[i].downLevel, expected.referenceLevels[i].downLevel, 1e-8)) {
        throw new Error(label + ": referenceLevels downLevel mismatch");
      }
      if (!approxEqual(actual.referenceLevels[i].upLevel, expected.referenceLevels[i].upLevel, 1e-8)) {
        throw new Error(label + ": referenceLevels upLevel mismatch");
      }
    }
  }

  function run() {
    var rng = createRng(20260407);
    var deterministic = boundaryCases();
    for (var i = 0; i < 10000; i += 1) {
      deterministic.push(randomCase(rng));
    }

    for (var index = 0; index < deterministic.length; index += 1) {
      var testCase = deterministic[index];
      compareOutputs(core.calculateStrategy(testCase), refCalc(testCase), "case #" + index);
    }

    var sample = core.calculateStrategy({ spxPrevClose: 6000, prevVixClose: 25, spxOpen: 5991 });
    console.log(
      JSON.stringify(
        {
          status: "ok",
          casesChecked: deterministic.length,
          sampleResult: {
            tradeSide: sample.tradeSide,
          expectedMoveLowPrice: sample.expectedMoveLowPrice,
          expectedMoveHighPrice: sample.expectedMoveHighPrice,
          finalOtmPct: sample.finalOtmPct,
          exactTargetPrice: sample.exactTargetPrice,
          outerFivePointStrike: sample.outerFivePointStrike,
          innerFivePointStrike: sample.innerFivePointStrike,
          referenceLevels: sample.referenceLevels
        }
      },
      null,
        2
      )
    );
  }

  run();
}).call(this);
