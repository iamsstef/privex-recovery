/* PriveX MultiAccount v2 raw call helper. The _call method has no ABI return value. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrivexCalls = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const ADDR = /^0x[0-9a-fA-F]{40}$/;
  const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
  function check(ok, msg) { if (!ok) throw new Error(msg); }

  function makeRequest(iface, multiAccount, owner, account, calls) {
    check(ADDR.test(multiAccount), 'Invalid MultiAccount address');
    check(ADDR.test(owner), 'Invalid owner address');
    check(ADDR.test(account), 'Invalid sub-account address');
    check(Array.isArray(calls) && calls.length === 1 && calls.every(v => typeof v === 'string' && HEX.test(v) && v.length >= 10), 'Invalid core call');
    check(iface && typeof iface.encodeFunctionData === 'function', 'Missing MultiAccount ABI');
    const data = iface.encodeFunctionData('_call', [account, calls]);
    check(typeof data === 'string' && HEX.test(data) && data.length >= 10, 'Invalid encoded MultiAccount call');
    return Object.freeze({ from: owner, to: multiAccount, data });
  }

  async function simulate(provider, request) {
    check(provider && typeof provider.call === 'function', 'No simulation provider');
    const result = await provider.call(request);
    // MultiAccount v2 has no outputs, so a successful eth_call often returns 0x.
    // Do not ABI-decode it. A revert should be thrown by the RPC provider.
    check(typeof result === 'string' && HEX.test(result), 'Invalid eth_call result');
    return result;
  }

  async function estimateGas(provider, request) {
    check(provider && typeof provider.estimateGas === 'function', 'No gas estimation provider');
    const gas = await provider.estimateGas(request);
    check(typeof gas === 'bigint' && gas > 0n, 'Invalid gas estimate');
    return gas;
  }

  return Object.freeze({ makeRequest, simulate, estimateGas });
});