'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRequest, simulate, estimateGas } = require('../raw-call.js');
const MA = '0xbF318724218cED9A3ff7CfC642c71a0CA1952b0F';
const OWNER = '0x1111111111111111111111111111111111111111';
const ACCOUNT = '0x2222222222222222222222222222222222222222';
const INNER = '0xabcdef12' + '00'.repeat(32);
const out = '0x12345678' + '00'.repeat(32);
const mockInterface = {
  encodeFunctionData(name, params) {
    assert.equal(name, '_call');
    assert.deepEqual(params, [ACCOUNT, [INNER]]);
    return out;
  },
};

test('builds an owner-only raw MultiAccount transaction to fixed destination', () => {
  assert.deepEqual(makeRequest(mockInterface, MA, OWNER, ACCOUNT, [INNER]), {to:MA,from:OWNER,data:out});
});
test('accepts a successful 0x eth_call result without ABI decoding', async () => {
  const tx = makeRequest(mockInterface, MA, OWNER, ACCOUNT, [INNER]);
  const provider = { async call(arg) { assert.equal(arg,tx); return '0x'; } };
  assert.equal(await simulate(provider,tx), '0x');
});
test('requires an independent gas estimate before allowing transactions', async () => {
  const tx=makeRequest(mockInterface, MA, OWNER, ACCOUNT, [INNER]);
  assert.equal(await estimateGas({estimateGas:async()=>115000n},tx),115000n);
  await assert.rejects(estimateGas({estimateGas:async()=>0n},tx),/Invalid gas estimate/);
});
test('propagates actual contract reverts without mislabeling them as decode failures', async () => {
  const tx=makeRequest(mockInterface, MA, OWNER, ACCOUNT, [INNER]);
  await assert.rejects(simulate({call:async()=>{throw new Error('AccountFacet: Too many deallocate in a short window');}},tx),/Too many deallocate/);
});
test('rejects malformed transactions',()=>{
  assert.throws(()=>makeRequest(mockInterface,MA,OWNER,ACCOUNT,['0x']),/Invalid core call/);
  assert.throws(()=>makeRequest(mockInterface,MA,OWNER,'0x0',[INNER]),/Invalid sub-account address/);
});