/* Muon attestation client for SYMMIO v0.8.5. Public read-only requests; no keys or wallet signing. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrivexMuon = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Gateways documented by SYMMIO. Support for the PriveX COTI deployment must be tested at runtime.
  const GATEWAYS = Object.freeze([
    'https://muon-oracle2.rasa.capital/v1/',
    'https://muon-oracle3.rasa.capital/v1/',
    'https://muon-oracle4.rasa.capital/v1/',
    'https://muon-oracle1.rasa.capital/v1/',
  ]);
  const METHODS = Object.freeze(['uPnl_A_withPendingBalance', 'uPnl_A']);
  const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
  const UINT256_MAX = (1n << 256n) - 1n;
  const INT256_MIN = -(1n << 255n);
  const INT256_MAX = (1n << 255n) - 1n;

  function check(condition, reason) {
    if (!condition) throw new Error(reason);
  }
  function integer(value, field, signed = false) {
    check(typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint', `Invalid ${field}`);
    if (typeof value === 'number') check(Number.isSafeInteger(value), `Invalid ${field}`);
    const raw = String(value);
    check(/^-?(?:0|[1-9]\d*)$/.test(raw) || /^0x[0-9a-fA-F]+$/.test(raw), `Invalid ${field}`);
    const n = BigInt(raw);
    check(signed ? n >= INT256_MIN && n <= INT256_MAX : n >= 0n && n <= UINT256_MAX, `Out of range: ${field}`);
    return n;
  }
  function address(value, field) {
    check(typeof value === 'string' && ADDRESS.test(value), `Invalid ${field}`);
    return value;
  }
  function hex(value, field) {
    check(typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(value) && value.length <= 4098, `Invalid ${field}`);
    return value;
  }
  function checkMetadata(actual, expected, label, isAddress = false) {
    if (actual === undefined || actual === null) return;
    if (isAddress) check(address(actual, label).toLowerCase() === expected.toLowerCase(), `Muon ${label} mismatch`);
    else check(integer(actual, label) === BigInt(expected), `Muon ${label} mismatch`);
  }
  function cleanError(value) {
    const message = value?.message || value?.error || value?.reason || String(value || 'Unavailable');
    return String(message).replace(/[\r\n\t]+/g, ' ').slice(0, 130);
  }

  function parseResponse(payload, expected, method = METHODS[0]) {
    check(METHODS.includes(method), 'Unsupported Muon method');
    check(payload && typeof payload === 'object', 'Invalid Muon response');
    check(payload.success === true, `Muon rejected request: ${cleanError(payload.error || payload.message)}`);
    const response = payload.result;
    const data = response?.data;
    const values = data?.result;
    check(response && data && values && typeof values === 'object', 'Muon response is missing signed data');
    const signature = response.signatures?.[0];
    check(signature && data.init?.nonceAddress, 'Muon response is missing signature fields');

    const partyA = address(expected.partyA, 'sub-account');
    const core = address(expected.core, 'SYMMIO core');
    const chainId = integer(expected.chainId, 'chain ID');
    // Only compare metadata when returned. The on-chain verifier binds these parameters to the signature.
    checkMetadata(values.partyA ?? data.params?.partyA, partyA, 'partyA', true);
    checkMetadata(values.symmio ?? data.params?.symmio, core, 'SYMMIO core', true);
    checkMetadata(values.chainId ?? data.params?.chainId, chainId, 'chain ID');

    // Safe deallocation requires pendingBalance; standard deallocation does not include it.
    if (method === 'uPnl_A_withPendingBalance') {
      check(values.pendingBalance !== undefined && values.pendingBalance !== null, 'Muon did not return pendingBalance');
    }
    check(values.uPnl !== undefined && values.uPnl !== null, 'Muon did not return uPnl');
    const sig = {
      reqId: hex(response.reqId, 'reqId'),
      timestamp: integer(data.timestamp, 'timestamp'),
      upnl: integer(values.uPnl, 'uPnl', true),
      ...(method === 'uPnl_A_withPendingBalance' ? {pendingBalance: integer(values.pendingBalance, 'pendingBalance')} : {}),
      gatewaySignature: hex(response.nodeSignature, 'gateway signature'),
      sigs: {
        signature: integer(signature.signature, 'Schnorr signature'),
        owner: address(signature.owner, 'Schnorr owner'),
        nonce: address(data.init.nonceAddress, 'Schnorr nonce'),
      },
    };
    check(sig.sigs.signature > 0n, 'Empty Schnorr signature');
    const now = integer(expected.blockTimestamp, 'block time');
    const window = integer(expected.upnlValidTime, 'signature validity window');
    check(window > 0n && window < 604800n, 'Invalid on-chain Muon validity window');
    check(sig.timestamp <= now + 60n, 'Muon signature timestamp is in the future');
    check(sig.timestamp + window > now + 10n, 'Muon signature has expired or will expire immediately');
    return sig;
  }

  function makeUrl(gateway, params, method = METHODS[0]) {
    check(METHODS.includes(method), 'Unsupported Muon method');
    check(GATEWAYS.includes(gateway), 'Unrecognized Muon gateway');
    const url = new URL(gateway);
    url.searchParams.set('app', 'symmio');
    url.searchParams.set('method', method);
    url.searchParams.set('params[partyA]', address(params.partyA, 'sub-account'));
    url.searchParams.set('params[chainId]', String(integer(params.chainId, 'chain ID')));
    url.searchParams.set('params[symmio]', address(params.core, 'SYMMIO core'));
    return url.toString();
  }

  function gatewayError(status, body) {
    const summary = `HTTP ${status}`;
    let details = '';
    try {
      const decoded = JSON.parse(body);
      const problem = decoded?.error ?? decoded?.message ?? decoded?.detail;
      if (typeof problem === 'string') details = problem;
      else if (problem && typeof problem === 'object') {
        details = [problem.message, problem.data].filter(v=>typeof v==='string').join(': ');
      }
    } catch (_) {
      // Never echo arbitrary HTML error pages.
    }
    return new Error(`${summary}${details ? ': ' + details.slice(0,120) : ''}`);
  }

  async function fetchSignature(params, fetchImpl = fetch, method = METHODS[0]) {
    check(METHODS.includes(method), 'Unsupported Muon method');
    const problems = [];
    for (const gateway of GATEWAYS) {
      const url = makeUrl(gateway, params, method);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          mode: 'cors',
          signal: controller.signal,
        });
        const body = await res.text();
        check(body.length <= 200000, 'Invalid response length');
        if (!res.ok) throw gatewayError(res.status, body);
        check(body.length > 0, 'Empty Muon response');
        const sig = parseResponse(JSON.parse(body), params, method);
        return { sig, gateway: new URL(gateway).hostname, method };
      } catch (error) {
        problems.push(`${new URL(gateway).hostname}: ${cleanError(error)}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    const result = new Error(`Muon ${method} unavailable. ${problems.join(' | ')}`);
    result.code = 'MUON_UNAVAILABLE';
    result.details = problems;
    throw result;
  }

  return Object.freeze({ GATEWAYS, METHODS, parseResponse, makeUrl, fetchSignature });
});