# Security policy

This is an **experimental, unaudited recovery interface**. Do not trust it solely because it is open source or because transaction simulation succeeds. A successful simulation does not guarantee contract solvency or that a later transaction succeeds.

**Never supply a seed phrase, private key or passkey to a website.** This project does not need one. Never approve an ERC-20 allowance to use this interface.

If something looks suspicious, disconnect the wallet, inspect the transaction payload directly on your wallet or block explorer and report an issue in the repository. Please do not publish sensitive wallet ownership proofs or personal information in issue reports.

Security-sensitive changes (contract addresses, ABI, transaction recipients, dependency URLs) should be independently reviewed before merging and deployed only after testing with a low-value account.
Muon queries send only the public sub-account, chain ID and core address to the Rasa gateways. No seed phrase, private key, personal signature or token approval is sent. The dashboard must complete an on-chain read-only simulation before enabling a transaction.
