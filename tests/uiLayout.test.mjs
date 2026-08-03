import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Memory Guardian starts collapsed and exposes an accessible disclosure control", () => {
  const component = source("../src/components/MemoryWatch.tsx");

  assert.match(component, /useState\(true\)/);
  assert.match(component, /aria-expanded=\{!collapsed\}/);
  assert.match(component, /aria-controls="memory-guardian-content"/);
  assert.match(component, /id="memory-guardian-content"/);
});

test("the cleared Apps tier starts collapsed while every tier remains user-toggleable", () => {
  const component = source("../src/components/ProcessGrid.tsx");

  assert.match(component, /new Set<TierKey>\(\["user"\]\)/);
  assert.match(component, /aria-expanded=\{!isCollapsed\}/);
  assert.match(component, /aria-controls=\{`tier-content-\$\{tier\.key\}`\}/);
  assert.match(component, /id=\{`tier-content-\$\{tier\.key\}`\}/);
});

test("the primary UI regions define narrow-window adaptations", () => {
  const headerCss = source("../src/components/Header.module.css");
  const memoryCss = source("../src/components/MemoryWatch.module.css");
  const gridCss = source("../src/components/ProcessGrid.module.css");
  const electronMain = source("../electron-main/main.ts");

  assert.match(headerCss, /@media \(max-width: 900px\)/);
  assert.match(memoryCss, /@media \(max-width: 680px\)/);
  assert.match(gridCss, /@media \(max-width: 680px\)/);
  assert.match(electronMain, /minWidth: 900/);
  assert.match(electronMain, /minHeight: 620/);
});
