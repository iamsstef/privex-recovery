const test = require('node:test');
const assert = require('node:assert/strict');
const { parseResponse, makeUrl, fetchSignature } = require('../muon.js');

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const CORE = '0x2222222222222222222222222222222222222222';
const context = {
  partyA: ACCOUNT, core: CORE, chainId: 2632500,
  blockTimestamp: 1771520000n, upnlValidTime: 300n,
};
function makePayload(overrides = {}) {
  return {
    success: true,
    result: {
      reqId: '0x' + '11'.repeat(32),
      nodeSignature: '0x' + '22'.repeat(65),
      signatures: [{ signature: '0x' + '12'.repeat(32), owner: ACCOUNT }],
      data: {
        init: { nonceAddress: ACCOUNT },
        timestamp: '1771519970',
        result: { uPnl: '-1000000000000000000', pendingBalance: '0', partyA: ACCOUNT, symmio: CORE, chainId: 2632500 },
      },
    },
    ...overrides,
  };
}
test('parses signed pending balance including negative uPnL without floating point', () => {
  const s = parseResponse(makePayload(), context);
  assert.equal(s.upnl, -1000000000000000000n);
  assert.equal(s.pendingBalance, 0n);
  assert.equal(s.timestamp, 1771519970n);
  assert.equal(s.sigs.owner, ACCOUNT);
});
test('rejects missing pendingBalance instead of silently assuming zero', () => {
  const payload = makePayload();
  delete payload.result.data.result.pendingBalance;
  assert.throws(() => parseResponse(payload, context), /pendingBalance/);
});
test('rejects wrong account, wrong chain and unsigned response', () => {
  const account = makePayload();
  account.result.data.result.partyA = CORE;
  assert.throws(() => parseResponse(account, context), /partyA mismatch/);
  const network = makePayload();
  network.result.data.result.chainId = 8453;
  assert.throws(() => parseResponse(network, context), /chain ID mismatch/);
  assert.throws(() => parseResponse({ success: false, error: 'no quorum' }, context), /Muon rejected request/);
});
test('rejects stale and future signatures', () => {
  const old = makePayload();
  old.result.data.timestamp = '1771519500';
  assert.throws(() => parseResponse(old, context), /expired/);
  const future = makePayload();
  future.result.data.timestamp = '1771521000';
  assert.throws(() => parseResponse(future, context), /future/);
});
test('only known gateways can construct a request', () => {
  assert.throws(() => makeUrl('https://example.com/', context), /Unrecognized/);
  const url = new URL(makeUrl('https://muon-oracle1.rasa.capital/v1/', context));
  assert.equal(url.searchParams.get('method'), 'uPnl_A_withPendingBalance');
  assert.equal(url.searchParams.get('params[chainId]'), '2632500');
  assert.equal(url.searchParams.get('params[partyA]'), ACCOUNT);
  assert.equal(url.searchParams.get('params[symmio]'), CORE);
});
test('tries next trusted gateway and does not send credentials', async () => {
  const visited = [];
  const fakeFetch = async (url, opts) => {
    visited.push({ url, opts });
    if (visited.length === 1) throw new Error('offline');
    return { ok: true, text: async () => JSON.stringify(makePayload()) };
  };
  const result = await fetchSignature(context, fakeFetch);
  assert.equal(visited.length, 2);
  assert.equal(result.gateway, 'muon-oracle3.rasa.capital');
  assert.equal(visited[0].opts.credentials, 'omit');
  assert.equal(visited[1].opts.cache, 'no-store');
  assert.equal(result.sig.upnl, -1000000000000000000n);
});
test('legacy uPnl_A method returns a signature without pendingBalance',async()=>{
  const payload=makePayload();
  delete payload.result.data.result.pendingBalance;
  const urls=[];
  const result=await fetchSignature(context,async url=>{urls.push(new URL(url));return {ok:true,status:200,text:async()=>JSON.stringify(payload)};},'uPnl_A');
  assert.equal(urls[0].searchParams.get('method'),'uPnl_A');
  assert.equal(result.method,'uPnl_A');
  assert.equal(result.sig.upnl,-1000000000000000000n);
  assert.equal('pendingBalance' in result.sig,false);
});
test('HTTP 400 details from response body are retained',async()=>{
  let count=0;
  await assert.rejects(fetchSignature(context,async()=>{count++;return {ok:false,status:400,text:async()=>JSON.stringify({success:false,error:{message:'bad request',data:'The server would not process the request'}})};}),err=>{
    assert.equal(count,4);
    assert.match(err.message,/HTTP 400: bad request/);
    assert.match(err.message,/would not process/);
    return true;
  });
});
test('safe signatures never assume a zero pending balance',()=>{
  const payload=makePayload();
  delete payload.result.data.result.pendingBalance;
  assert.throws(()=>parseResponse(payload,context,'uPnl_A_withPendingBalance'),/pendingBalance/);
  assert.ok(parseResponse(payload,context,'uPnl_A').upnl<0n);
});
