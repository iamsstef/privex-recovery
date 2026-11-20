/*
 * PriveX Recovery - independent, client-only COTI/SYMMIO interface.
 * All contract targets are allowlisted. No relayers, token approvals, tracking,
 * off-chain account discovery, message signing, or arbitrary destinations.
 */
(() => {
  'use strict';

  const CONFIG = Object.freeze({
    chainId: 2632500,
    rpc: 'https://mainnet.coti.io/rpc',
    explorer: 'https://mainnet.cotiscan.io',
    multiAccount: '0xbF318724218cED9A3ff7CfC642c71a0CA1952b0F',
    core: '0x2Ecc7da3Cc98d341F987C85c3D9FC198570838B5',
    collateral: '0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C',
    decimals: 6,
    deploymentBlock: 639223,
    pageSize: 25,
    maxAccounts: 300,
    recentRequests: 15,
    scanChunk: 5000,
  });

  const MULTI_ABI = [
    'function getAccountsLength(address user) view returns (uint256)',
    'function getAccounts(address user,uint256 start,uint256 size) view returns ((address accountAddress,string name)[])',
    'function owners(address account) view returns (address)',
    'function symmioAddress() view returns (address)',
    'function paused() view returns (bool)',
    'function revokeCooldown() view returns (uint256)',
    'function delegatedAccesses(address account,address target,bytes4 selector) view returns (bool)',
    'function revokeProposalTimestamp(address account,address target,bytes4 selector) view returns (uint256)',
    'function withdrawFromAccount(address account,uint256 amount)',
    // PriveX COTI MultiAccount uses SYMMIO symmioMultiAccount_2: _call returns no data.
    // Ignoring outputs also works if a newer implementation returns bytes[].
    'function _call(address account,bytes[] callDatas)',
    'event DelegateAccess(address account,address target,bytes4 selector,bool state)',
    'event DelegateAccesses(address account,address target,bytes4[] selector,bool state)',
    'event ProposeToRevokeAccesses(address account,address target,bytes4[] selector)',
  ];

  const PART = '(uint256 id,uint256 amount,int256 chainId,bytes receiver,address virtualProvider,address expressProvider)';
  const REQUEST = `(uint256 id,address user,${PART}[] parts,uint256 timestamp,uint256 cooldownEndTime,uint8 status,bool speedUp,bool isCooldownModified,address provider,bool isPureVirtual,bytes providerData,uint256 totalAmount,uint256 totalVirtualAmount)`;
  const CORE_ABI = [
    'function getCollateral() view returns (address)',
    'function getMuonConfig() view returns (uint256 upnlValidTime,uint256 priceValidTime)',
    'function isLegacyDeallocateDeprecated() view returns (bool)',
    'function balanceOf(address user) view returns (uint256)',
    'function allocatedBalanceOfPartyA(address partyA) view returns (uint256)',
    'function getWithdrawableTime(address user) view returns (uint256)',
    'function isSuspended(address user) view returns (bool)',
    'function partyAPositionsCount(address partyA) view returns (uint256)',
    'function partyAPendingQuotesCount(address partyA) view returns (uint256)',
    'function pauseState() view returns (bool globalPaused,bool liquidationPaused,bool accountingPaused,bool partyBActionsPaused,bool partyAActionsPaused,bool internalTransferPaused,bool externalTransferPaused,bool emergencyMode,bool partyBOpenPositionsPaused)',
    'function safeDeallocate(uint256 amount,(bytes reqId,uint256 timestamp,int256 upnl,uint256 pendingBalance,bytes gatewaySignature,(uint256 signature,address owner,address nonce) sigs) upnlSig)',
    'function deallocate(uint256 amount,(bytes reqId,uint256 timestamp,int256 upnl,bytes gatewaySignature,(uint256 signature,address owner,address nonce) sigs) upnlSig)',
    `function initiateWithdraw(${PART}[] parts,bool speedUp,bytes providerData) returns (uint256 requestId,uint256 cooldownEndTime)`,
    'function finalizeWithdrawRequest(address user,uint256 requestId)',
    'function getLastWithdrawRequestId(address user) view returns (uint256)',
    `function getWithdrawRequests(address user,uint256 requestId) view returns (${REQUEST})`,
  ];
  const TOKEN_ABI = [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
  ];

  const $ = id => document.getElementById(id);
  const H = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ellipsis = s => s ? `${s.slice(0, 6)}…${s.slice(-5)}` : '--';
  const fmtTime = n => n ? new Date(Number(n) * 1000).toLocaleString(undefined, {dateStyle:'medium',timeStyle:'short'}) : '--';
  const STATUS = ['Pending','Provider accepted','Provider rejected','Completed','Cancel requested','Cancelled','Suspended'];
  const state = {
    eth: null, read: null, walletProvider: null, wallet: null,
    inspected: null, meta: null, accounts: [], selected: null,
    preview: null, scanCancelled: false, activeScan: false, loading: false,
  };

  function showStatus(message, tone = '') {
    const node = $('statusArea');
    node.hidden = !message;
    node.className = `status-area ${tone}`;
    node.textContent = message || '';
  }
  function failText(e) {
    if (e?.code === 'BAD_DATA') {
      const fn = e.info?.signature || e.info?.method || 'unknown contract read';
      const raw = typeof e.value === 'string' ? e.value : '';
      return `Invalid return data from ${fn}${raw === '0x' ? ' (empty 0x)' : ''}. Check deployed function and RPC.`;
    }
    // Avoid dumping unbounded RPC payloads into the interface.
    let msg = e?.shortMessage || e?.reason || e?.info?.error?.message || e?.message || String(e);
    if (/user rejected|user denied|4001/i.test(msg)) return 'Transaction or wallet request was rejected.';
    return String(msg).slice(0, 340);
  }
  function assert(ok, message) { if (!ok) throw new Error(message); }
  function same(a,b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  function asAddress(raw) { return state.eth.getAddress(String(raw).trim()); }
  function fmtAmount(value, places = 4) {
    if (value === null || value === undefined) return 'Unavailable';
    // All accounting amounts are held at 18 decimals. Format without unsafe float conversion.
    const full = state.eth.formatUnits(value, 18);
    const [whole, fraction = ''] = full.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const digits = fraction.slice(0, places).replace(/0+$/, '');
    return digits ? `${grouped}.${digits}` : grouped;
  }
  function fmtCollateral(value) {
    if (value === null || value === undefined) return 'Unavailable';
    const full = state.eth.formatUnits(value, CONFIG.decimals);
    const [whole, fraction = ''] = full.split('.');
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction && /[1-9]/.test(fraction) ? '.' + fraction.replace(/0+$/, '') : ''}`;
  }
  function strictUnits(input) {
    const s = String(input).trim();
    assert(/^\d+(?:\.\d+)?$/.test(s), 'Enter a positive decimal amount.');
    const value = state.eth.parseUnits(s, CONFIG.decimals);
    assert(value > 0n, 'Amount must be greater than zero.');
    return value;
  }
  function maxInput(raw18) {
    if (raw18 === null) return '';
    const scale = 10n ** BigInt(18 - CONFIG.decimals);
    return state.eth.formatUnits(raw18 / scale, CONFIG.decimals);
  }
  function setNetwork(text, ok) {
    $('networkStatus').textContent = text;
    $('networkDot').className = `network-dot ${ok === true ? 'ok' : ok === false ? 'bad' : ''}`;
  }
  function shortOwner(name) {
    const n = String(name || '').trim();
    return n.length > 85 ? `${n.slice(0, 82)}…` : n;
  }

  function multi(connection = state.read) { return new state.eth.Contract(CONFIG.multiAccount, MULTI_ABI, connection); }
  function core(connection = state.read) { return new state.eth.Contract(CONFIG.core, CORE_ABI, connection); }

  async function ensureRead() {
    if (!state.eth) {
      assert(window.ethers?.Contract, 'The pinned ethers.js library did not load. Check network access to jsDelivr.');
      state.eth = window.ethers;
      // Catch malformed ABI fragments before allowing any wallet interaction.
      new state.eth.Interface(MULTI_ABI);
      new state.eth.Interface(CORE_ABI);
    }
    if (state.read) return state.read;
    let provider = new state.eth.JsonRpcProvider(CONFIG.rpc, CONFIG.chainId, {staticNetwork:true});
    try {
      const id = await provider.send('eth_chainId', []);
      assert(BigInt(id) === BigInt(CONFIG.chainId), 'Official RPC returned the wrong chain ID.');
    } catch (rpcError) {
      if (!state.walletProvider) throw new Error(`Official COTI RPC unavailable: ${failText(rpcError)}. Connect a wallet on COTI Mainnet to use its provider as a fallback.`);
      const network = await state.walletProvider.getNetwork();
      assert(network.chainId === BigInt(CONFIG.chainId), 'Wallet is not connected to COTI Mainnet.');
      provider = state.walletProvider;
    }
    state.read = provider;
    return provider;
  }

  async function verifyDeployment() {
    const provider = await ensureRead();
    const [multiCode, coreCode, multiCore, collateral, isPaused, pauseFlags] = await Promise.all([
      provider.getCode(CONFIG.multiAccount),
      provider.getCode(CONFIG.core),
      multi().symmioAddress(),
      core().getCollateral(),
      multi().paused(),
      core().pauseState(),
    ]);
    assert(multiCode !== '0x' && coreCode !== '0x', 'Expected contract bytecode is missing.');
    assert(same(multiCore,CONFIG.core), 'MultiAccount now points to an unexpected SYMMIO Core contract. Writes disabled.');
    assert(same(collateral,CONFIG.collateral), 'SYMMIO Core collateral differs from the published COTI deployment registry. Writes disabled.');
    const token = new state.eth.Contract(collateral, TOKEN_ABI, provider);
    const decimals = Number(await token.decimals());
    assert(decimals === CONFIG.decimals, `Collateral decimal mismatch: expected ${CONFIG.decimals}, got ${decimals}.`);
    let symbol = 'Collateral';
    try { symbol = String(await token.symbol()).slice(0,20); } catch (_) { /* metadata not required */ }
    const flags = [...pauseFlags].map(Boolean);
    state.meta = {symbol, isPaused:Boolean(isPaused), flags, verifiedAt:Date.now()};
    setNetwork('COTI Mainnet', !isPaused);
    return state.meta;
  }

  async function loadProfile(accountAddress, name, registry = true) {
    const addr = asAddress(accountAddress);
    const m = multi();
    const c = core();
    const calls = await Promise.allSettled([
      m.owners(addr), c.balanceOf(addr), c.allocatedBalanceOfPartyA(addr),
      c.getWithdrawableTime(addr), c.isSuspended(addr),
      c.partyAPositionsCount(addr), c.partyAPendingQuotesCount(addr),
      c.getLastWithdrawRequestId(addr),
    ]);
    const val = i => calls[i].status === 'fulfilled' ? calls[i].value : null;
    const owner = val(0);
    const profile = {
      address:addr, name:shortOwner(name) || 'Trading sub-account', registry,
      owner:owner ? asAddress(owner) : null,
      available:val(1), allocated:val(2), cooldown:val(3), suspended:val(4),
      positions:val(5), pendingQuotes:val(6), lastRequest:val(7), requests:[],
    };
    if (profile.lastRequest !== null && profile.lastRequest > 0n) {
      const last = profile.lastRequest;
      const first = last > BigInt(CONFIG.recentRequests) ? last - BigInt(CONFIG.recentRequests) + 1n : 1n;
      const ids = [];
      for (let id = last; id >= first; id -= 1n) ids.push(id);
      const items = await Promise.allSettled(ids.map(id => c.getWithdrawRequests(addr,id)));
      profile.requests = items.map((result,i) => result.status === 'fulfilled' ? result.value : null).filter(Boolean);
      profile.requestsError = items.some(item => item.status === 'rejected');
    }
    return profile;
  }

  async function inspect(address) {
    assert(!state.loading, 'An inspection is already running.');
    state.loading = true;
    $('inspectBtn').disabled = true;
    $('refreshBtn').disabled = true;
    state.preview = null;
    showStatus('Loading accounts...');
    try {
      await verifyDeployment();
      const wallet = asAddress(address);
      state.inspected = wallet;
      const n = await multi().getAccountsLength(wallet);
      assert(n < 100000n, 'Unexpected account count returned by contract.');
      const total = Number(n);
      const limit = Math.min(total,CONFIG.maxAccounts);
      const accountRows = [];
      for (let start=0; start<limit; start+=CONFIG.pageSize) {
        const page = await multi().getAccounts(wallet,BigInt(start),BigInt(Math.min(CONFIG.pageSize,limit-start)));
        for (const entry of page) accountRows.push({address:entry.accountAddress, name:entry.name});
      }
      // Sequential batches keep RPC usage reasonable for users with many sub-accounts.
      state.accounts = [];
      for (let start=0; start<accountRows.length; start+=4) {
        const part = accountRows.slice(start,start+4);
        state.accounts.push(...await Promise.all(part.map(item=>loadProfile(item.address,item.name,true))));
      }
      renderDashboard();
      $('dashboard').hidden = false;
      $('refreshBtn').disabled = false;
      $('connectionBadge').textContent = state.wallet && same(state.wallet,wallet) ? 'Connected' : 'Watch-only';
      $('connectionBadge').className = state.wallet && same(state.wallet,wallet) ? 'tag good' : 'tag';
      $('walletInfo').textContent = state.wallet ? `Wallet: ${ellipsis(state.wallet)} | Viewing: ${ellipsis(wallet)}` : `Address: ${ellipsis(wallet)}`;
      const caution = total>limit ? ` Only the first ${limit} of ${total} registered accounts were loaded; manually inspect additional addresses.` : '';
      const warning = state.meta.isPaused || state.meta.flags[0] || state.meta.flags[2] ? ' Contract operations are currently restricted by a pause.' : '';
      showStatus(`${total} account${total===1?'':'s'} found.${caution}${warning}`, warning ? 'error' : 'success');
    } catch (e) {
      $('dashboard').hidden = true;
      state.preview = null;
      showStatus(failText(e),'error');
      setNetwork('COTI Mainnet',false);
    } finally {
      state.loading = false;
      $('inspectBtn').disabled = false;
      $('refreshBtn').disabled = !state.inspected;
    }
  }

  function renderDashboard() {
    const accounts = state.accounts;
    const hasMissing = accounts.some(a => a.available === null || a.allocated === null);
    const available = accounts.reduce((sum,a)=>sum+(a.available ?? 0n),0n);
    const allocated = accounts.reduce((sum,a)=>sum+(a.allocated ?? 0n),0n);
    const suffix = hasMissing ? ' + unknown' : '';
    $('totalBalance').textContent = `${fmtAmount(available + allocated)}${suffix}`;
    $('availableBalance').textContent = `${fmtAmount(available)}${suffix}`;
    $('allocatedBalance').textContent = `${fmtAmount(allocated)}${suffix}`;
    $('balanceSymbol').textContent = state.meta.symbol;
    $('accountCount').textContent = `${accounts.length} loaded`;
    const out = $('accountList');
    out.innerHTML = '';
    if (!accounts.length) {
      out.innerHTML = '<p class="empty-note">No sub-accounts found for this address. Accounts on other contracts may not appear here.</p>';
    }
    for (let i=0;i<accounts.length;i++) out.appendChild(renderAccount(accounts[i],i));
    const previous = $('delegationAccount').value;
    $('delegationAccount').innerHTML = '';
    for (const a of accounts) {
      const option = document.createElement('option');
      option.value = a.address;
      option.textContent = `${a.name} (${ellipsis(a.address)})`;
      $('delegationAccount').appendChild(option);
    }
    if (accounts.some(a=>same(a.address,previous))) $('delegationAccount').value = previous;
    $('delegationResults').innerHTML = '<p class="empty-note">Scan events or check a known address. Partial scans may miss earlier delegations.</p>';
  }

  function renderAccount(a,index) {
    const element = document.createElement('article');
    element.className = 'account-card';
    const own = !!state.wallet && a.owner && same(state.wallet,a.owner);
    const mayWrite = own && state.meta && !state.meta.isPaused && !state.meta.flags[0] && !state.meta.flags[2];
    const ownerNote = a.owner ? ellipsis(a.owner) : 'Unknown';
    const canDeallocate = mayWrite && a.allocated !== null && a.allocated > 0n;
    const pending = a.requests.filter(r=>r.status === 0n || r.status === 1n || r.status === 4n || r.status === 6n);
    element.innerHTML = `
      <div class="account-top"><div><div class="account-title">${H(a.name)}</div><div class="account-address">${H(a.address)}</div></div></div>
      <div class="account-numbers"><div><small>Available</small><strong>${fmtAmount(a.available)}</strong></div><div><small>Allocated</small><strong>${fmtAmount(a.allocated)}</strong></div><div><small>Open positions</small><strong>${a.positions===null?'Unknown':a.positions.toString()}</strong></div></div>
      <div class="account-bottom"><span class="meta">Owner: ${H(ownerNote)}${a.suspended?' · Suspended':''} · Pending quotes: ${a.pendingQuotes===null?'?':a.pendingQuotes}</span><button class="btn secondary" data-action="deallocate" ${canDeallocate?'':'disabled'}>Deallocate</button><button class="btn primary" data-action="direct" ${mayWrite && a.available!==null && a.available>0n?'':'disabled'}>Withdraw</button></div>
      ${pending.length?`<div class="pending-requests"><div class="pending-header">Withdrawal requests (${pending.length} of ${a.lastRequest?.toString()||'?' } total)</div></div>`:''}`;
    const bottom = element.querySelector('.account-bottom');
    bottom.querySelectorAll('button').forEach(btn => btn.addEventListener('click',()=>openAction(a,btn.dataset.action)));
    if (pending.length) {
      const area = element.querySelector('.pending-requests');
      pending.forEach(request=>area.appendChild(renderRequest(a,request)));
    }
    return element;
  }

  function classicRequestToOwner(a,request) {
    if (!state.wallet || !a.owner || !same(state.wallet,a.owner)) return false;
    if (!same(request.user,a.address) || !same(request.provider,state.eth.ZeroAddress) || request.parts.length<1) return false;
    for (const part of request.parts) {
      if (BigInt(part.chainId)!==BigInt(CONFIG.chainId) || !same(part.virtualProvider,state.eth.ZeroAddress) || !same(part.expressProvider,state.eth.ZeroAddress) || !same(part.receiver,state.wallet) || part.amount<=0n) return false;
    }
    return true;
  }

  function renderRequest(a,req) {
    const item = document.createElement('div');
    item.className='request-row';
    const safe = classicRequestToOwner(a,req);
    const ready = safe && req.status===0n && Number(req.cooldownEndTime)*1000 <= Date.now();
    item.innerHTML = `<div><strong>Request #${H(req.id.toString())}</strong><div class="request-hint">${H(STATUS[Number(req.status)] || 'Unknown')} · ${fmtCollateral(req.totalAmount)} ${H(state.meta.symbol)} · ${fmtTime(req.cooldownEndTime)}</div></div><button class="btn secondary" ${ready?'':'disabled'}>Finalize</button>`;
    item.querySelector('button').addEventListener('click',()=>finalizeRequest(a,req.id));
    if (!safe) item.querySelector('button').title = 'Only classic requests paying the connected owner are enabled in this interface.';
    return item;
  }

  function openAction(a,mode) {
    if (!state.wallet) { showStatus('Connect the owning wallet to authorize transactions.','error'); return; }
    if (!a.owner || !same(a.owner,state.wallet)) { showStatus('The connected wallet does not own this sub-account.','error'); return; }
    state.selected = a.address;
    state.preview = null;
    $('drawerTitle').textContent = mode==='deallocate' ? 'Deallocate margin' : 'Withdraw funds';
    $('drawerAccount').textContent = a.address;
    $('drawerAccountName').textContent = a.name;
    $('actionMode').value = mode;
    $('amountInput').value = '';
    $('previewResult').textContent='';
    $('previewResult').className='preview-result';
    $('submitBtn').disabled = true;
    $('drawer').hidden=false;
    $('drawerBackdrop').hidden=false;
    document.body.style.overflow='hidden';
    refreshDrawer();
    $('amountInput').focus();
  }
  function closeDrawer(){ $('drawer').hidden=true; $('drawerBackdrop').hidden=true; document.body.style.overflow=''; state.preview=null; }
  function activeAccount(){ return state.accounts.find(a=>same(a.address,state.selected)) ?? null; }
  function currentMode(){ return $('actionMode').value; }
  function refreshDrawer(){
    const a=activeAccount();
    if(!a)return;
    const mode=currentMode();
    $('drawerTitle').textContent = mode==='deallocate'?'Deallocate idle margin':mode==='request'?'Create withdrawal request':'Direct withdrawal';
    $('drawerAvailable').textContent = `${fmtAmount(a.available,6)} ${state.meta.symbol}`;
    $('drawerAllocated').textContent = `${fmtAmount(a.allocated,6)} ${state.meta.symbol}`;
    $('drawerDestination').textContent = mode==='deallocate'?'Same trading account':ellipsis(state.wallet);
    $('drawerCooldown').textContent = a.cooldown === null ? 'Unknown' : (Number(a.cooldown)*1000 <= Date.now() ? 'Elapsed' : `Until ${fmtTime(a.cooldown)}`);
    $('amountUnit').textContent=state.meta.symbol;
    $('actionDescription').textContent = mode==='deallocate'
      ? 'Requires a Muon signature. The legacy route is tried only if enabled on-chain. Resets the withdrawal cooldown.'
      : mode==='request'
        ? 'Creates a withdrawal request to your wallet. Funds remain locked until finalized or canceled. Requires a second transaction.'
        : 'Legacy withdrawal to your connected wallet. If disabled, try a withdrawal request.';
    state.preview=null;
    $('submitBtn').disabled=true;
    $('previewResult').textContent='';
  }

  async function assertWriteReady(a) {
    assert(state.walletProvider && state.wallet, 'Connect a wallet first.');
    const network = await state.walletProvider.getNetwork();
    const liveChain = await window.ethereum.request({method:'eth_chainId'});
    assert(network.chainId===BigInt(CONFIG.chainId) && BigInt(liveChain)===BigInt(CONFIG.chainId), 'Switch your wallet to COTI Mainnet.');
    const signer = await state.walletProvider.getSigner();
    assert(same(await signer.getAddress(),state.wallet), 'Wallet account changed. Reconnect before signing.');
    await verifyDeployment(); // re-check deployment and current pause state before every transaction
    assert(!state.meta.isPaused && !state.meta.flags[0] && !state.meta.flags[2], 'MultiAccount or SYMMIO accounting is currently paused.');
    const owner = await multi().owners(a.address);
    assert(same(owner,state.wallet), 'Sub-account is not owned by the connected wallet.');
    assert(!(await core().isSuspended(a.address)), 'SYMMIO reports this account as suspended.');
    return signer;
  }

  async function buildAction(onStage = () => {}) {
    const a=activeAccount();
    assert(a,'Choose an account first.');
    onStage('Checking wallet and account');
    const signer=await assertWriteReady(a);
    const mode=currentMode();
    onStage('Reading balances');
    const units=strictUnits($('amountInput').value);
    const units18=units*10n**BigInt(18-CONFIG.decimals);
    const [available,allocated] = await Promise.all([core().balanceOf(a.address),core().allocatedBalanceOfPartyA(a.address)]);
    const c = core(signer);
    const m = multi(signer);
    let action;
    if(mode==='direct') {
      assert(units18<=available,'Amount exceeds the currently free balance.');
      action={mode,contract:m,method:'withdrawFromAccount',args:[a.address,units],target:CONFIG.multiAccount};
    }else if(mode==='request') {
      assert(units18<=available,'Amount exceeds the currently free balance.');
      const part={id:0n,amount:units,chainId:BigInt(CONFIG.chainId),receiver:state.wallet,virtualProvider:state.eth.ZeroAddress,expressProvider:state.eth.ZeroAddress};
      const data=c.interface.encodeFunctionData('initiateWithdraw',[[part],false,'0x']);
      action={mode,contract:m,method:'_call',args:[a.address,[data]],target:CONFIG.multiAccount};
    }else if(mode==='deallocate') {
      assert(units18<=allocated,'Amount exceeds the allocated balance.');
      assert(window.PrivexMuon?.fetchSignature,'Muon client unavailable. Reload the page.');
      onStage('Reading Muon settings');
      const [muonConfig,latest]=await Promise.all([c.getMuonConfig(),state.read.getBlock('latest')]);
      assert(latest,'Unable to read the latest COTI block.');
      const muonParams={
        partyA:a.address,core:CONFIG.core,chainId:CONFIG.chainId,
        blockTimestamp:latest.timestamp,upnlValidTime:muonConfig.upnlValidTime,
      };
      let oracle, deallocationMethod='safeDeallocate';
      onStage('Requesting safe Muon signature');
      try {
        oracle=await window.PrivexMuon.fetchSignature(muonParams);
      }catch(primaryError){
        // Only use the legacy path if the core explicitly reports it is enabled.
        onStage('Checking legacy deallocation status');
        let disabled;
        try { disabled=await core().isLegacyDeallocateDeprecated(); }
        catch(readError){
          throw new Error(`Safe Muon failed: ${failText(primaryError)}. Legacy status unavailable: ${failText(readError)}`);
        }
        if(disabled) throw new Error(`Safe Muon failed: ${failText(primaryError)}. Legacy deallocation disabled on-chain.`);
        deallocationMethod='deallocate';
        onStage('Requesting legacy Muon signature');
        try { oracle=await window.PrivexMuon.fetchSignature(muonParams,fetch,'uPnl_A'); }
        catch(fallbackError){
          throw new Error(`Safe Muon failed: ${failText(primaryError)}. Legacy Muon failed: ${failText(fallbackError)}`);
        }
      }
      onStage('Encoding deallocation');
      const data=c.interface.encodeFunctionData(deallocationMethod,[units18,oracle.sig]);
      action={mode,contract:m,method:'_call',args:[a.address,[data]],target:CONFIG.multiAccount,oracle:oracle.gateway,deallocationMethod};
    }else throw new Error('Unsupported action.');
    if (action.method === '_call') {
      // PriveX MultiAccount version 2 returns no data. Use a raw eth_call so the
      // provider does not attempt to ABI-decode return values from older contracts.
      onStage('Encoding MultiAccount call');
      assert(window.PrivexCalls?.makeRequest && window.PrivexCalls?.simulate, 'Raw call helper unavailable. Reload the page.');
      action.request = window.PrivexCalls.makeRequest(m.interface,CONFIG.multiAccount,state.wallet,a.address,action.args[1]);
    }
    onStage('Simulating contract call');
    if (action.request) {
      await window.PrivexCalls.simulate(state.walletProvider,action.request);
    } else {
      await action.contract[action.method].staticCall(...action.args);
    }
    return {...action,account:a.address,amount:units,wallet:state.wallet};
  }

  async function simulateAction() {
    $('submitBtn').disabled=true;
    $('previewResult').className='preview-result';
    $('previewResult').textContent=currentMode()==='deallocate' ? 'Fetching Muon signature and simulating...' : 'Simulating transaction...';
    state.preview=null;
    $('previewBtn').disabled=true;
    let stage='Preparing transaction';
    try {
      const action=await buildAction(next=>{stage=next;});
      stage='Estimating gas';
      const gas=action.request
        ? await window.PrivexCalls.estimateGas(state.walletProvider,action.request)
        : await action.contract[action.method].estimateGas(...action.args);
      state.preview={account:action.account,wallet:action.wallet,mode:action.mode,amount:action.amount,deallocationMethod:action.deallocationMethod||null};
      $('previewResult').className='preview-result success';
      $('previewResult').textContent=`Simulation passed.\nAmount: ${fmtCollateral(action.amount)} ${state.meta.symbol}\nTo: ${action.mode==='deallocate'?'same sub-account':action.wallet}\nContract: ${ellipsis(action.target)}\nEstimated gas: ${gas.toString()}${action.deallocationMethod?'\nMethod: '+action.deallocationMethod:''}${action.oracle?'\nMuon: '+action.oracle:''}\nNo transaction has been sent.`;
      $('submitBtn').disabled=false;
    }catch(e){
      $('previewResult').className='preview-result error';
      $('previewResult').textContent=`Simulation failed at ${stage}. No transaction sent.\n${failText(e)}`;
    }finally{$('previewBtn').disabled=false;}
  }

  async function sendAction() {
    if(!state.preview)return;
    $('submitBtn').disabled=true;
    $('previewBtn').disabled=true;
    try {
      // Re-simulate at the time of signing so stale account state never authorizes a different action.
      const action=await buildAction();
      assert(same(action.account,state.preview.account) && same(action.wallet,state.preview.wallet) && action.mode===state.preview.mode && action.amount===state.preview.amount && (action.deallocationMethod||null)===state.preview.deallocationMethod,'Transaction details changed. Please simulate again.');
      $('previewResult').className='preview-result';
      $('previewResult').textContent='Confirm the transaction shown by your wallet. Verify the contract and amount.';
      const signer=await state.walletProvider.getSigner();
      assert(same(await signer.getAddress(),state.wallet), 'Wallet account changed. Reconnect before signing.');
      const tx=action.request
        ? await signer.sendTransaction(action.request)
        : await action.contract[action.method](...action.args);
      $('previewResult').textContent=`Transaction submitted: ${tx.hash}\nWaiting for a confirmed receipt…`;
      const receipt=await tx.wait(1);
      assert(receipt?.status===1,'Transaction was not successful.');
      $('previewResult').className='preview-result success';
      $('previewResult').textContent=`Confirmed on COTI Mainnet: ${tx.hash}\n${action.mode==='request'?'A withdrawal request was created. It still needs finalization after the cooldown.':action.mode==='deallocate'?'Collateral moved into the free balance, subject to the withdrawal cooldown.':'Direct withdrawal executed.'}`;
      showStatus(`Confirmed on-chain transaction: ${CONFIG.explorer}/tx/${tx.hash}`,'success');
      state.preview=null;
      if(state.inspected) await inspect(state.inspected);
      closeDrawer();
    }catch(e){
      $('previewResult').className='preview-result error';
      $('previewResult').textContent=`No confirmed success: ${failText(e)}\nIf your wallet submitted a transaction, verify its hash on COTI Scan before retrying.`;
    }finally{$('previewBtn').disabled=false;}
  }

  async function finalizeRequest(a,id) {
    if(!state.wallet) {showStatus('Connect the owning wallet.','error');return;}
    try {
      const signer=await assertWriteReady(a);
      const request=await core().getWithdrawRequests(a.address,id);
      assert(request.status===0n,'Only pending requests can be finalized here.');
      assert(classicRequestToOwner(a,request),'Only classic withdrawals payable exclusively to the connected owner are supported.');
      const block=await state.read.getBlock('latest');
      assert(BigInt(block.timestamp)>=request.cooldownEndTime,'The withdrawal cooldown has not elapsed.');
      const contract=core(signer);
      await contract.finalizeWithdrawRequest.staticCall(a.address,id);
      const total=fmtCollateral(request.totalAmount);
      const ok=window.confirm(`Finalize request #${id}?\nAmount: ${total} ${state.meta.symbol}\nReceiver: ${state.wallet}\nContract: ${CONFIG.core}\n\nThe wallet will show the exact transaction for approval.`);
      if(!ok)return;
      // Re-check the whole request before broadcasting (including receiver and status).
      const again=await core().getWithdrawRequests(a.address,id);
      assert(again.status===0n && classicRequestToOwner(a,again),'Withdrawal request has changed.');
      await contract.finalizeWithdrawRequest.staticCall(a.address,id);
      showStatus('Confirm finalization in your wallet…');
      const tx=await contract.finalizeWithdrawRequest(a.address,id);
      showStatus(`Finalization submitted: ${tx.hash}\nWaiting for confirmation…`);
      const receipt=await tx.wait(1);
      assert(receipt?.status===1,'Transaction reverted.');
      showStatus(`Withdrawal request finalized: ${CONFIG.explorer}/tx/${tx.hash}`,'success');
      if(state.inspected)await inspect(state.inspected);
    }catch(e){showStatus(`Finalization not completed: ${failText(e)}`,'error');}
  }

  async function connect() {
    try {
      assert(state.eth, 'Wallet library did not initialize. Reload and check the dependency status.');
      assert(window.ethereum?.request,'No injected wallet detected. Install or enable MetaMask, Rabby, or another EIP-1193 compatible wallet.');
      const provider=window.ethereum;
      await provider.request({method:'eth_requestAccounts'});
      const hexChain='0x'+CONFIG.chainId.toString(16);
      let actual=await provider.request({method:'eth_chainId'});
      if(BigInt(actual)!==BigInt(CONFIG.chainId)){
        try { await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:hexChain}]}); }
        catch(e){
          if(e.code===4902 || e?.data?.originalError?.code===4902){
            await provider.request({method:'wallet_addEthereumChain',params:[{chainId:hexChain,chainName:'COTI Mainnet',rpcUrls:[CONFIG.rpc],nativeCurrency:{name:'COTI',symbol:'COTI',decimals:18},blockExplorerUrls:[CONFIG.explorer]}]});
          }else throw e;
        }
        actual=await provider.request({method:'eth_chainId'});
      }
      assert(BigInt(actual)===BigInt(CONFIG.chainId),'Wallet is not connected to COTI Mainnet.');
      state.walletProvider=new state.eth.BrowserProvider(provider);
      state.wallet=asAddress(await (await state.walletProvider.getSigner()).getAddress());
      // Switch to a working read provider. Never use a provider connected to another chain.
      if(!state.read)await ensureRead();
      $('connectBtn').textContent=ellipsis(state.wallet);
      $('connectBtn').classList.remove('primary');
      $('connectBtn').classList.add('secondary');
      $('addressInput').value=state.wallet;
      await inspect(state.wallet);
    }catch(e){showStatus(failText(e),'error');}
  }

  async function inspectManualAccount() {
    try {
      const addr=asAddress($('manualAccount').value);
      assert(state.inspected,'Inspect a wallet address first.');
      const owner=await multi().owners(addr);
      assert(owner && !same(owner,state.eth.ZeroAddress),'Not a registered sub-account in this legacy MultiAccount contract.');
      const existing=state.accounts.find(item=>same(item.address,addr));
      if(existing){showStatus('This sub-account is already listed.');return;}
      const profile=await loadProfile(addr,'Manually inspected account',false);
      state.accounts.push(profile);
      renderDashboard();
      showStatus(`Loaded sub-account ${addr}. Owner: ${owner}. Manual lookup does not prove this belongs to your inspected wallet.`,same(owner,state.wallet)?'success':'');
    }catch(e){showStatus(failText(e),'error');}
  }

  function displayPermissions(account,items,from,to) {
    const output=$('delegationResults');
    output.innerHTML='';
    const heading=document.createElement('p');
    heading.className='empty-note';
    heading.textContent=`Scanned blocks ${from.toLocaleString()}-${to.toLocaleString()} (${items.length} distinct permissions found). Scanning part of the chain does not establish that no other delegations exist.`;
    output.appendChild(heading);
    if(!items.length)return;
    for(const p of items){
      const el=document.createElement('div'); el.className='permission-item';
      el.innerHTML=`<div>Target: ${H(p.target)}</div><div>Selector: ${H(p.selector)} <span class="${p.active?'active':'inactive'}">${p.active?'Active':'Inactive'}</span></div><div>${p.proposal ? `Revocation proposal: ${fmtTime(p.proposal)}` : 'No pending revocation proposal found'}</div>`;
      output.appendChild(el);
    }
  }

  async function scanDelegations() {
    const a=$('delegationAccount').value;
    if(!a){showStatus('Select a sub-account first.','error');return;}
    if(state.activeScan)return;
    state.activeScan=true;
    state.scanCancelled=false;
    $('scanBtn').disabled=true;
    $('stopScanBtn').hidden=false;
    const found=new Map();
    let start,end;
    try {
      const provider=await ensureRead();
      end=await provider.getBlockNumber();
      start=$('fromBlock').value ? Math.max(CONFIG.deploymentBlock,Number($('fromBlock').value)) : Math.max(CONFIG.deploymentBlock,end-40000);
      assert(Number.isSafeInteger(start) && start <= end, 'Enter a valid historical block number.');
      const abi=new state.eth.Interface(MULTI_ABI);
      const topics=[
        state.eth.id('DelegateAccess(address,address,bytes4,bool)'),
        state.eth.id('DelegateAccesses(address,address,bytes4[],bool)'),
        state.eth.id('ProposeToRevokeAccesses(address,address,bytes4[])'),
      ];
      for(let block=start;block<=end;block+=CONFIG.scanChunk){
        if(state.scanCancelled)break;
        const to=Math.min(block+CONFIG.scanChunk-1,end);
        $('delegationResults').innerHTML=`<p class="empty-note">Scanning blocks ${block.toLocaleString()}-${to.toLocaleString()} / ${end.toLocaleString()}…</p>`;
        const logs=await provider.getLogs({address:CONFIG.multiAccount,topics:[topics],fromBlock:block,toBlock:to});
        for(const log of logs){
          try {
            const ev=abi.parseLog(log);
            if(!ev || !same(ev.args.account,a))continue;
            const selectors=ev.name==='DelegateAccess'?[ev.args.selector]:ev.args.selector;
            for(const selector of selectors){
              const target=asAddress(ev.args.target);
              const key=`${target.toLowerCase()}:${selector.toLowerCase()}`;
              found.set(key,{target,selector});
            }
          }catch(_){/* unknown event ignored */}
        }
        // Yield to the browser between batches so Stop is responsive.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const entries=[...found.values()];
      for(let i=0;i<entries.length;i+=8){
        await Promise.all(entries.slice(i,i+8).map(async p=>{
          const [active,proposal]=await Promise.all([
            multi().delegatedAccesses(a,p.target,p.selector),
            multi().revokeProposalTimestamp(a,p.target,p.selector),
          ]);
          p.active=active; p.proposal=proposal;
        }));
      }
      displayPermissions(a,entries,start,end);
      if(state.scanCancelled)showStatus('Delegation scan stopped. Only the completed block ranges were examined.','error');
      else showStatus(`Delegation scan complete for the requested block range. ${entries.length} selector grants or proposals found.`,'success');
    }catch(e){showStatus(`Delegation scan incomplete: ${failText(e)}. Try a smaller block range or check a known target manually.`,'error');}
    finally{state.activeScan=false;$('scanBtn').disabled=false;$('stopScanBtn').hidden=true;}
  }

  async function checkDelegation(){
    try {
      const account=asAddress($('delegationAccount').value);
      const target=asAddress($('targetAddress').value);
      const selector=$('selectorInput').value.trim();
      assert(/^0x[0-9a-fA-F]{8}$/.test(selector),'A function selector must be exactly 4 bytes (0x followed by 8 hex digits).');
      const [active,proposal,cooldown]=await Promise.all([
        multi().delegatedAccesses(account,target,selector),
        multi().revokeProposalTimestamp(account,target,selector),
        multi().revokeCooldown(),
      ]);
      $('manualAccessResult').textContent=`${active?'ACTIVE':'Not currently delegated'} · Proposal: ${proposal?fmtTime(proposal):'none'} · Revoke cooldown: ${cooldown.toString()} seconds`;
    }catch(e){$('manualAccessResult').textContent=failText(e);}
  }

  function wire(){
    $('connectBtn').addEventListener('click',()=>connect());
    $('inspectBtn').addEventListener('click',()=>inspect($('addressInput').value.trim()));
    $('addressInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('inspectBtn').click();});
    $('refreshBtn').addEventListener('click',()=>state.inspected&&inspect(state.inspected));
    $('manualBtn').addEventListener('click',inspectManualAccount);
    $('manualAccount').addEventListener('keydown',e=>{if(e.key==='Enter')$('manualBtn').click();});
    $('closeDrawer').addEventListener('click',closeDrawer);
    $('drawerBackdrop').addEventListener('click',closeDrawer);
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && !$('drawer').hidden)closeDrawer();});
    $('actionMode').addEventListener('change',refreshDrawer);
    $('amountInput').addEventListener('input',()=>{state.preview=null;$('submitBtn').disabled=true;$('previewResult').textContent='';});
    $('maxBtn').addEventListener('click',()=>{
      const a=activeAccount(); if(!a)return;
      $('amountInput').value=maxInput(currentMode()==='deallocate'?a.allocated:a.available);
      state.preview=null;$('submitBtn').disabled=true;$('previewResult').textContent='';
    });
    $('previewBtn').addEventListener('click',simulateAction);
    $('submitBtn').addEventListener('click',sendAction);
    $('scanBtn').addEventListener('click',scanDelegations);
    $('stopScanBtn').addEventListener('click',()=>{state.scanCancelled=true;});
    $('checkAccessBtn').addEventListener('click',checkDelegation);
    const injected=window.ethereum;
    if(injected?.on){
      injected.on('accountsChanged',()=>{
        state.wallet=null;state.walletProvider=null;state.preview=null;
        closeDrawer();$('connectBtn').textContent='Connect wallet';$('connectBtn').className='btn primary';
        showStatus('Wallet account changed. Reconnect and refresh before any transaction.','error');
        $('dashboard').hidden=true;
      });
      injected.on('chainChanged',()=>{
        state.wallet=null;state.walletProvider=null;state.read=null;state.meta=null;state.preview=null;
        closeDrawer();$('connectBtn').textContent='Connect wallet';$('connectBtn').className='btn primary';
        setNetwork('Network changed · reconnect',false);$('dashboard').hidden=true;
        showStatus('Wallet network changed. Reconnect on COTI Mainnet.','error');
      });
    }
  }

  async function init(){
    wire();
    try{
      await ensureRead();
      await verifyDeployment();
      $('walletInfo').textContent='Connect wallet or enter an address.';
    }catch(e){
      setNetwork('RPC not ready',false);
      showStatus(`Read-only initialization: ${failText(e)}`,'error');
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else void init();
})();