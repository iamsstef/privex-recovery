'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

test('PriveX MultiAccount v2 _call has no expected return data', () => {
  const matches = [...app.matchAll(/'function _call\(address account,bytes\[\] callDatas\)[^']*'/g)];
  assert.equal(matches.length,1);
  assert.equal(matches[0][0],"'function _call(address account,bytes[] callDatas)'");
});

test('owner calls still require static simulation and gas estimation', () => {
  assert.match(app,/await action\.contract\[action\.method\]\.staticCall\(\.\.\.action\.args\)/);
  assert.match(app,/await action\.contract\[action\.method\]\.estimateGas\(\.\.\.action\.args\)/);
});

test('deallocation uses the owner-controlled MultiAccount wrapper', () => {
  assert.match(app,/method:'_call',args:\[a\.address,\[data\]\],target:CONFIG\.multiAccount/);
  assert.match(app,/const owner = await multi\(\)\.owners\(a\.address\)/);
});

test('main script cache is updated on deployment', () => {
  assert.match(html,/src="\.\/app\.js\?v=multiaccount-abi2"/);
});
