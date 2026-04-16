"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const rootDir = __dirname;

function createClassList() {
  const classes = new Set();

  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    contains(name) {
      return classes.has(name);
    }
  };
}

function createElement(id, tagName) {
  const element = {
    id: id || "",
    tagName: tagName || "div",
    value: "",
    textContent: "",
    className: "",
    innerHTML: "",
    disabled: false,
    style: {},
    children: [],
    handlers: {},
    classList: createClassList(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      return child;
    },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    click() {
      if (typeof this.handlers.click === "function") {
        this.handlers.click({ preventDefault() {} });
      }
    }
  };

  return element;
}

function parseIndexIds() {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  const ids = new Set();
  const idPattern = /id="([^"]+)"/g;
  var match = null;

  while ((match = idPattern.exec(html)) !== null) {
    ids.add(match[1]);
  }

  return ids;
}

function assertRequiredIds(indexIds) {
  const required = ["expect-move-low", "expect-move-high", "exact-target", "trade-side-badge"];
  const missing = required.filter((id) => !indexIds.has(id));
  assert.deepStrictEqual(missing, [], "index.html missing required ids: " + missing.join(", "));
}

function createDocument(indexIds) {
  const elements = new Map();
  indexIds.forEach((id) => {
    elements.set(id, createElement(id));
  });

  return {
    body: createElement("body", "body"),
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tagName) {
      return createElement("", tagName);
    }
  };
}

function runScript(filename, context) {
  const source = fs.readFileSync(path.join(rootDir, filename), "utf8");
  vm.runInContext(source, context, { filename });
}

function createContext(document) {
  return vm.createContext({
    console,
    document,
    setTimeout,
    clearTimeout,
    Blob,
    URL: {
      createObjectURL() {
        return "blob:verify";
      },
      revokeObjectURL() {}
    },
    localStorage: {
      getItem() {
        return null;
      },
      removeItem() {}
    },
    indexedDB: null,
    scrollTo() {}
  });
}

function getRenderedValues(document) {
  return {
    expectedMoveLow: document.getElementById("expect-move-low").textContent,
    expectedMoveHigh: document.getElementById("expect-move-high").textContent,
    exactTarget: document.getElementById("exact-target").textContent,
    tradeSide: document.getElementById("trade-side-badge").textContent
  };
}

function assertSampleValues(values, label) {
  assert.strictEqual(values.expectedMoveLow, "5,905.51", label + ": expectedMoveLow mismatch");
  assert.strictEqual(values.expectedMoveHigh, "6,094.49", label + ": expectedMoveHigh mismatch");
  assert.strictEqual(values.exactTarget, "5,863.93", label + ": exactTarget mismatch");
  assert.strictEqual(values.tradeSide, "PUT", label + ": tradeSide mismatch");
}

function runScenario(indexIds, options) {
  const document = createDocument(indexIds);
  const context = createContext(document);
  context.window = context;

  runScript("core.js", context);

  if (options && options.simulateLegacyCoreResult) {
    const originalCalculate = context.SPXStrategyCalculatorCore.calculateStrategy;
    context.SPXStrategyCalculatorCore.calculateStrategy = function (inputs) {
      const result = originalCalculate(inputs);
      delete result.expectedMoveLowPrice;
      delete result.expectedMoveHighPrice;
      return result;
    };
  }

  runScript("app.js", context);
  return getRenderedValues(document);
}

function main() {
  const indexIds = parseIndexIds();
  assertRequiredIds(indexIds);

  const normalValues = runScenario(indexIds, { simulateLegacyCoreResult: false });
  assertSampleValues(normalValues, "normal-core");

  const fallbackValues = runScenario(indexIds, { simulateLegacyCoreResult: true });
  assertSampleValues(fallbackValues, "legacy-core-fallback");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        scenarios: {
          normalCore: normalValues,
          legacyCoreFallback: fallbackValues
        }
      },
      null,
      2
    )
  );
}

main();
