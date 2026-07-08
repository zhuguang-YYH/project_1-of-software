const assert = require('assert');
const Module = require('module');
const path = require('path');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  const results = [];
  for (const item of tests) {
    const startedAt = Date.now();
    try {
      await item.fn();
      results.push({ name: item.name, status: 'passed', duration: Date.now() - startedAt });
    } catch (error) {
      results.push({
        name: item.name,
        status: 'failed',
        duration: Date.now() - startedAt,
        error
      });
    }
  }
  return results;
}

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

function loadFresh(modulePath) {
  clearModule(modulePath);
  return require(modulePath);
}

function withMockedModule(requestName, mockValue, fn) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === requestName) return mockValue;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return fn();
  } finally {
    Module._load = originalLoad;
  }
}

function projectPath(...segments) {
  return path.resolve(__dirname, '..', '..', ...segments);
}

module.exports = {
  assert,
  test,
  run,
  clearModule,
  loadFresh,
  withMockedModule,
  projectPath
};
