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

function createDocument() {
  const elements = new Map();

  return {
    body: createElement("body", "body"),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement(id));
      }

      return elements.get(id);
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

function main() {
  const document = createDocument();
  const context = vm.createContext({
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

  context.window = context;

  runScript("core.js", context);
  runScript("app.js", context);

  const expectedMoveLow = document.getElementById("expect-move-low").textContent;
  const expectedMoveHigh = document.getElementById("expect-move-high").textContent;
  const exactTarget = document.getElementById("exact-target").textContent;
  const tradeSide = document.getElementById("trade-side-badge").textContent;

  assert.strictEqual(expectedMoveLow, "5,905.51");
  assert.strictEqual(expectedMoveHigh, "6,094.49");
  assert.strictEqual(exactTarget, "5,863.93");
  assert.strictEqual(tradeSide, "PUT");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        expectedMoveLow,
        expectedMoveHigh,
        exactTarget,
        tradeSide
      },
      null,
      2
    )
  );
}

main();
