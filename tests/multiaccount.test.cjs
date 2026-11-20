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

test('owner calls use raw simulation and gas estimation for MultiAccount v2', () => {
  assert.match(app,/await window\.PrivexCalls\.simulate\(state\.walletProvider,action\.request\)/);
  assert.match(app,/await window\.PrivexCalls\.estimateGas\(state\.walletProvider,action\.request\)/);
  assert.match(app,/await signer\.sendTransaction\(action\.request\)/);
});

test('deallocation uses the owner-controlled MultiAccount wrapper', () => {
  assert.match(app,/method:'_call',args:\[a\.address,\[data\]\],target:CONFIG\.multiAccount/);
  assert.match(app,/const owner = await multi\(\)\.owners\(a\.address\)/);
});

test('main script cache is updated on deployment', () => {
  assert.match(html,/src="\.\/app\.js\?v=withdrawal-cooldown4"/);
});


test('raw call helper loads before application', () => {
  assert.match(html, /<script defer src="\.\/raw-call\.js\?v=1"><\/script>/);
});

test('cooldown module loads before app',()=>{
  assert.match(html, /<script defer src="\.\/cooldown\.js\?v=1"><\/script>/);
});
test('no mandatory manual simulation remains',()=>{
  assert.doesNotMatch(html, /id="previewBtn"/);
  assert.doesNotMatch(app, /state\.preview|simulateAction/);
  assert.match(app, /await buildAction\(next=>/);
  assert.match(app, /await window\.PrivexCalls\.estimateGas\(state\.walletProvider,action\.request\)/);
});
test('direct withdrawal re-checks live cooldown before signing',()=>{
  assert.match(app, /core\(\)\.getWithdrawableTime\(a\.address,\{blockTag:latestBlock\.number\}\)/);
  assert.match(app, /liveCooldown<=BigInt\(latestBlock\.timestamp\)/);
});
test('account and request cooldown elements update on a timer',()=>{
  assert.match(app, /data-cooldown-kind="account"/);
  assert.match(app, /data-cooldown-kind="request"/);
  assert.match(app, /setInterval\(tickCountdowns,1000\)/);
});
