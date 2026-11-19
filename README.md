# PriveX Recovery (COTI Mainnet)

Independent, **unofficial**, static recovery/inspection tool for the legacy PriveX SYMMIO MultiAccount deployment on COTI Mainnet (chain ID `2632500`). No backend, cookies, analytics, API keys, or custody. Connect an injected EIP-1193 wallet (e.g. MetaMask/Rabby) or look up a public address without connecting.

> **EXPERIMENTAL - NOT LIVE-CHAIN VALIDATED.** The implementation is based on published source and deployment registries; it has **not** been demonstrated to recover funds on the actual COTI deployment. Do not promote it as a proven recovery mechanism or encourage large withdrawals until an independent source/bytecode review and an end-to-end test with an account owner have succeeded. The public repository must be reviewed before users connect wallets.

## Deployed contracts referenced

| Component | Address | Source |
| --- | --- | --- |
| PriveX legacy MultiAccount | `0xbF318724218cED9A3ff7CfC642c71a0CA1952b0F` | [SYMMIO official COTI subgraph config](https://github.com/SYMM-IO/subgraphs/blob/main/configs/perps/coti.json) |
| SYMMIO Core (Diamond) | `0x2Ecc7da3Cc98d341F987C85c3D9FC198570838B5` | [SYMMIO official COTI subgraph config](https://github.com/SYMM-IO/subgraphs/blob/main/configs/perps/coti.json) |
| Collateral token | `0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C` | [SYMMIO analytics COTI environment](https://github.com/SYMM-IO/analytics/blob/main/src/environments/environment.coti.ts) |
| Public COTI JSON-RPC | `https://mainnet.coti.io/rpc` | [COTI's official example contracts Hardhat config](https://github.com/coti-io/coti-contracts-examples/blob/main/hardhat.config.ts) |

The analytics configuration indicates **six collateral decimals**; the app verifies this against `decimals()` before proceeding. Account balances in SYMMIO core are stored at **18 decimals**, unlike transfer and withdrawal amounts in collateral decimals.

Official contract source consulted:

- [SYMMIO legacy MultiAccount](https://github.com/SYMM-IO/perps-core/blob/main/contracts/helpers/accounts/MultiAccount.sol) - `getAccounts`, `owners`, `_call`, `withdrawFromAccount`, delegation mappings and events.
- [SYMMIO AccountFacetImpl](https://github.com/SYMM-IO/perps-core/blob/main/contracts/core/facets/Account/AccountFacetImpl.sol) - legacy withdrawal cooldown, deallocation and the `legacyWithdrawalDeprecated` check.
- [SYMMIO v0.8.5 withdrawal documentation](https://github.com/SYMM-IO/perps-core/blob/main/docs/v0.8.5/withdraw-system.md) - classic withdrawal initiation/finalization without a service provider.
- [SYMMIO WithdrawFacet](https://github.com/SYMM-IO/perps-core/blob/main/contracts/core/facets/Withdraw/WithdrawFacet.sol) - new withdrawal functions.

**Source compatibility does not prove deployed bytecode compatibility.** PriveX MultiAccount is upgradeable; its current implementation must be verified on an independent explorer / against a known transaction before public production use.

## Features

- Connect an injected wallet and request switching to COTI Mainnet, or inspect any public wallet address read-only.
- Read its registered legacy PriveX sub-accounts from `getAccountsLength` and `getAccounts`, preserving sub-account names (including agent-labeled ones).
- Read each account's owner, available collateral, allocated collateral, open-position count, pending quote count, suspension status, withdrawal cooldown and last 15 withdrawal requests.
- Check delegated function permissions by scanning `DelegateAccess*` events and reading current `delegatedAccesses()` storage. Optional manual target/selector lookup; **event scans are partial unless the user starts at the deployment block**.
- Owner-authorized **direct legacy withdrawal**, with a read-only `staticCall` and gas estimation before wallet signing.
- **Restricted zero-uPnL deallocation**: requires `BALANCE_SETTLER_ROLE` for the sub-account calling the core. The UI checks `hasRole` and disables this action otherwise. Standard `deallocate` / `safeDeallocate` require a fresh Muon signature and are not implemented yet.
- Owner-authorized **classic withdrawal request** through `MultiAccount._call(subAccount, [encoded initiateWithdraw(...)])`, pointing the recipient **only at the connected owner** and using **no providers**.
- Finalize a pending classic withdrawal request once its cooldown expires; other provider-managed withdrawal types are read-only.

The app rechecks ownership, the real wallet network, expected collateral / core wiring, suspension and pause state on every attempted write. Finalization checks the receiver and payment type again. **Wallets should show exact contract, gas and transaction calldata; verify before signing.**

## Known limitations and caveats

1. **Agent accounts outside legacy MultiAccount**: a virtual account, different owner, agent vault, separate Account Layer or another chain cannot be discovered or withdrawn by this adapter. A manually entered *legacy* sub-account is read-only unless `owners()` proves the connected wallet controls it.
2. **Open positions / locked margin**: current SYMMIO source restricts `zeroUpnlDeallocate` to `BALANCE_SETTLER_ROLE`. Most sub-accounts lack this role. Regular deallocation requires a valid Muon attestation, and open positions may need settlement. Allocated margin cannot be withdrawn through this tool without a supported deallocation path.
3. **Pause, suspension, deprecated functions, missing underlying collateral**: the UI cannot bypass contract restrictions or make insolvent contracts solvent. A failed static call intentionally blocks its transaction button.
4. **Withdrawal requests**: standard requests are two transactions (`initiateWithdraw`, then `finalizeWithdrawRequest`). Only the most recent 15 requests per account are inspected. More historical requests would need a pagination interface.
5. **RPC/CORS/rate limits**: GitHub Pages browsers must be able to make `eth_call` to COTI's RPC. If the RPC does not permit browser access, a compatible injected wallet can serve as fallback. Historical delegation scans can be rate-limited.
6. **No full historical event enumeration by default**: delegation mapping keys are not enumerable. The default search window is only the most recent 40,000 blocks. To scan farther back, set **Scan from block** to a prior block, down to `639223`. A zero-result partial scan never proves no permissions exist.
7. **CDN dependency**: `ethers@6.15.0` is loaded by a pinned version from jsDelivr. Before large-scale public deployment, vendor the reviewed library into the repository and apply an integrity hash / security review. GitHub Pages and the CDN can log IP requests, and the public RPC can see queried addresses even though the app sends no telemetry.
8. **Not formally audited**: read-only `eth_call` success, simulated transaction success, token balances and expected contract addresses do not establish economic safety or solvency.

## GitHub Pages deployment

1. **Create a new, public, empty repository**, e.g. `privex-recovery`, on your own GitHub account. It must remain separate from any CipherTrade repository.
2. Upload all files from this project **to the repository root**, including `.nojekyll`. Do not upload only the `.zip` file.
3. On GitHub, open **Settings → Pages → Build and deployment**, set **Source: Deploy from a branch**, branch `main`, folder `/(root)`, and save.
4. Once Pages finishes publishing, open the published URL, check the network status, and inspect a **public known test wallet** before connecting a wallet that holds funds.
5. **Before advertising publicly**, inspect deployed code/upgrade permissions on COTI Scan, run the checks below, and have an independent reviewer inspect the source. This site should stay clearly labeled unofficial.

Static hosting requires no build step. To view files locally you can use `python -m http.server 8000` and open `http://localhost:8000/` (wallet extensions may require HTTPS/GitHub Pages).

## Manual validation checklist before public launch

- [ ] Verify deployed proxy implementation, actual ABI, selectors and codehash of MultiAccount and SYMMIO core against trusted explorer data.
- [ ] Confirm six collateral decimals and the published collateral address with live calls.
- [ ] Test read-only discovery of a known PriveX wallet with its regular and AI-agent sub-accounts, including ownership.
- [ ] Verify free and allocated balance amounts against COTI Scan / a second independently queried node.
- [ ] Test `withdrawFromAccount.staticCall` with a known account; confirm whether legacy withdrawals were deprecated.
- [ ] Test `zeroUpnlDeallocate` with a known no-position account and a **small amount**, including cooldown transition.
- [ ] Test classic `initiateWithdraw` through MultiAccount `_call`, decode the resulting request and finalize after the actual cooldown.
- [ ] Check pause/suspension handling, wallets switching chain and accounts, and withdrawals sent only to owners.
- [ ] Test requests with non-owner destinations and provider-managed requests are **not** eligible for finalization via this UI.
- [ ] Have an independent reviewer examine JavaScript, CDN dependency and deployment configuration.

## Security principles

- **No keys or phrases**. The interface only requests EIP-1193 account access and specific user-triggered contract transactions.
- **Fixed addresses**. Only the official published legacy deployment targets are used; code checks runtime wiring to prevent silently changing target contracts.
- **Fixed recipients**. Initiating new classic withdrawals always uses the connected owner address as the receiving address. Legacy `withdrawFromAccount` transfers to `owners[account]` in contract source.
- **No token approvals**. No permit, infinite approval, `personal_sign`, `eth_sign` or server intermediary.
- **Fail closed**. If a read check, owner check, ABI function or preflight simulation fails, the site does not offer a transaction to bypass it.
- **No affiliation claim**. This repository is not an official PriveX, COTI or SYMMIO interface.

## License

The source files in this repository are released under MIT. SYMMIO contracts and external dependencies retain their separate licenses; no SYMMIO contract code is copied into this project.