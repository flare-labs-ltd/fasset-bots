# Examples

## How to create agent bot and make it available? (Only available agents can be minted against to.)

1. Create agent. The output is native address of created agent.

```console
$ yarn agent-bot create POOLT-1 -f FtestXRP
Initializing environment...
Environment successfully initialized.
AGENT CREATED: Agent 0x5bc0886D3117507C779BD8c6240eb1C396385223 was created.
```

2. Deposit enough vault collateral to agent _0x5bc0886D3117507C779BD8c6240eb1C396385223_. In this example _25000 testUSDC_.

```console
$ yarn agent-bot depositVaultCollateral 0x5bc0886D3117507C779BD8c6240eb1C396385223 25000000000000000000000 -f FtestXRP
Initializing environment...
Environment successfully initialized.
VAULT COLLATERAL DEPOSIT: Deposit of 2500000000000000000000 to agent 0x5bc0886D3117507C779BD8c6240eb1C396385223 was successful.
```

2. Buy enough pool collateral for agent _0x5bc0886D3117507C779BD8c6240eb1C396385223_. In this example _4500 CFLR_.

```console
$ yarn agent-bot buyPoolCollateral 0x5bc0886D3117507C779BD8c6240eb1C396385223 4500000000000000000000 -f FtestXRP
Initializing environment...
Environment successfully initialized.
BUY POOL TOKENS: Agent 0x5bc0886D3117507C779BD8c6240eb1C396385223 bought 4500000000000000000000 of pool tokens successfully.
```

3. Enter agent _0x5bc0886D3117507C779BD8c6240eb1C396385223_ in agent's available list.

```console
$ yarn agent-bot enter 0x5bc0886D3117507C779BD8c6240eb1C396385223 -f FtestXRP
Initializing environment...
Environment successfully initialized.
AGENT ENTERED AVAILABLE: Agent 0x5bc0886D3117507C779BD8c6240eb1C396385223 entered available list.
```

## How to list and change agent settings?

1. List agent settings for agent _0x5bc0886D3117507C779BD8c6240eb1C396385223_.

```console
$ yarn agent-bot getAgentSettings 0x5bc0886D3117507C779BD8c6240eb1C396385223 -f FtestXRP
Initializing environment...
Environment successfully initialized.
vaultCollateralToken: 0xC06496FA0551bf4996fb5Df876cBcC6F1d836460
vaultCollateralSymbol: USDC
feeBIPS: 1000
poolFeeShareBIPS: 4000
mintingVaultCollateralRatioBIPS: 16800
mintingPoolCollateralRatioBIPS: 24000
poolExitCollateralRatioBIPS: 26000
buyFAssetByAgentFactorBIPS: 9000
poolTopupCollateralRatioBIPS: 22000
poolTopupTokenPriceFactorBIPS: 8000
```

2. Update settings **poolFeeShareBIPS** to _4100 BIPS_ for agent _0x5bc0886D3117507C779BD8c6240eb1C396385223_. This action will announce setting update.

```console
$ yarn agent-bot updateAgentSetting 0x5bc0886D3117507C779BD8c6240eb1C396385223 poolFeeShareBIPS 4100 -f FtestXRP
Initializing environment...
Environment successfully initialized.
Agent 0x5bc0886D3117507C779BD8c6240eb1C396385223 announced agent settings update at 1699518678 for poolFeeShareBIPS.
```

Update execution will be automatically done via running script [`run-agent.ts`](./src/run/run-agent.ts) and owner will get notified.

```console
AGENT SETTING UPDATE: Agent 0x5bc0886D3117507C779BD8c6240eb1C396385223 setting poolFeeShareBIPS was updated.
```

## How to withdraw underlying?

1. Check free underlying assets for agent _0x97204bd339e5e33acc7675dea5593f254BD8476C_.

```console
$ yarn agent-bot freeUnderlying 0x97204bd339e5e33acc7675dea5593f254BD8476C -f FtestXRP
Initializing environment...
Environment successfully initialized.
Agent 0x97204bd339e5e33acc7675dea5593f254BD8476C has 5499950 free underlying.
```

2. Announce underlying withdrawal for agent _0x97204bd339e5e33acc7675dea5593f254BD8476C_. The result is payment reference that is needed to perform withdrawal.

```console
$ yarn agent-bot announceUnderlyingWithdrawal 0x97204bd339e5e33acc7675dea5593f254BD8476C -f FtestXRP
Initializing environment...
Environment successfully initialized.
ANNOUNCE UNDERLYING WITHDRAWAL: Agent 0x97204bd339e5e33acc7675dea5593f254BD8476C announced underlying withdrawal with payment reference 0x4642505266410003000000000000000000000000000000000000000000000030.
```

3. Perform underlying withdrawal for agent _0x97204bd339e5e33acc7675dea5593f254BD8476C_ to underlying address _rJw8FSdzzuPM1zqJLEFxVbpCaQVxqb4vRW_ with amount _1.499950 testXRP_ and payment reference _0x4642505266410003000000000000000000000000000000000000000000000030_.

```console
$ yarn agent-bot performUnderlyingWithdrawal 0x97204bd339e5e33acc7675dea5593f254BD8476C 1499950 rJw8FSdzzuPM1zqJLEFxVbpCaQVxqb4vRW 0x4642505266410003000000000000000000000000000000000000000000000030 -f FtestXRP
Initializing environment...
Environment successfully initialized.
UNDERLYING WITHDRAWAL: Agent 0x97204bd339e5e33acc7675dea5593f254BD8476C withdrew underlying with transaction F350744FD0C76973E1A1A91968EDC8B13670F5F13770B876B5B9E10934CDC0FC.
```

4. Confirm underlying withdrawal
   Underlying withdrawal will be automatically confirmed via running script [`run-agent.ts`](./src/run/run-agent.ts) and owner will get notified.

```console
CONFIRM UNDERLYING WITHDRAWAL ANNOUNCEMENT: Agent's 0x97204bd339e5e33acc7675dea5593f254BD8476C underlying withdrawal was successfully confirmed.
```

## How to create underlying account?

1. Create underlying account that can be used for owner or user in `secrets.json` file. The outputs are underlying address and underlying private key, respectfully.

```console
$ yarn agent-bot createUnderlyingAccount -f FtestXRP
Initializing environment...
Environment successfully initialized.
rBxp3z87UbwaUgP2U88pT4pjEaeNP3FVWm 00F903ED76E80E5EDBA58B4C5F4DA4FB2EE02E99F87529FD1349EF1C2DE35AFC93
```

## How to create wallet encryption password?

1. Create wallet encryption password that can be used in `secrets.json` file.

```console
$ yarn key createWalletEncryptionPassword
9cbefd0062028c1437bcb37a51d8546d872dbf3f081eab4d246d87548e1e5448
```

## How to list available agents?

1. List available agents that user can mint against.

```console
$ yarn user-bot agents -f FtestXRP -c ./run-config/run-config-user-coston-testxrp.json
Initializing environment...
Environment successfully initialized.
ADDRESS                                     MAX_LOTS  FEE
0x97204bd339e5e33acc7675dea5593f254BD8476C         9  10.00%
0x4A023968C5c634F5067c4F08f60cBA5dcd3aaA45         8  11.00%
0xf37E8F1ad5BC9C5Bb8bf387902DE82294889d2A3         8  10.00%
0xac8067BC2FbFD8b8cfD68B6855dE6470B7DbEEb5         8  12.00%
0x5bc0886D3117507C779BD8c6240eb1C396385223         1  10.00%
```

## How to mint fassets?

### User perspective

1. Mint _1 FtestXR_P_ fasset against agent _0x97204bd339e5e33acc7675dea5593f254BD8476C_.

```console
$ yarn user-bot mint 0x97204bd339e5e33acc7675dea5593f254BD8476C 1 -f FtestXRP -c ./run-config/run-config-user-coston-testxrp.json
Initializing environment...
Environment successfully initialized.
Reserving collateral...
Paying on the underlying chain for reservation 18455 to address r9K5mVRUXefhoc4zfJcQMidYtSne5vGpCB...
Waiting for transaction finalization...
Waiting for proof of underlying payment transaction 377DA47EABCBA2C23CDC13433074A83C1E248A7894DCA4E7FDE78C074FF4FD6D...
Executing payment...
Done
```

### Agent perspective

Minting will be automatically recognized via running script [`run-agent.ts`](./src/run/run-agent.ts) and owner will get notified about it.

```console
MINTING STARTED: Minting 18455 started for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
MINTING EXECUTED: Minting 18455 executed for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
```

## How to redeem fassets?

### User perspective

1. Redeem _1 FtestXRP_ fasset.

```console
$ yarn user-bot redeem 1 -f FtestXRP -c ./run-config/run-config-user-coston-testxrp.json
Initializing environment...
Environment successfully initialized.
Asking for redemption of 1 lots
Triggered 1 payment requests (addresses, block numbers and timestamps are on underlying chain):
    id=17644  to=r3rep182VUoYCCNFqdCyNhbKzS3phQDwU  amount=9900000  agentVault=0x97204bd339e5e33acc7675dea5593f254BD8476C  reference=0x46425052664100020000000000000000000000000000000000000000000044ec  firstBlock=42746846  lastBlock=42747346  lastTimestamp=1699522276
```

### Agent perspective

Redemption will be automatically recognized and executed via running script [`run-agent.ts`](./src/run/run-agent.ts) and owner will get notified about it.

```console
REDEMPTION STARTED: Redemption 17644 started for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
REDEMPTION PAID: Redemption 17644 was paid for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
REDEMPTION PAYMENT PROOF REQUESTED: Payment proof for redemption 17644 was requested for 0x97204bd339e5e33acc7675dea5593f254BD8476C.
```

## How to list system info?

1. List system info.

```console
$ yarn user-bot info -f FtestXRP -c ./run-config/run-config-user-coston-testxrp.json
Initializing environment...
Environment successfully initialized.
FAsset: F-TestXRP (FtestXRP) at 0xA86379bC8644Ce1919cc750844E819c0a2cD28dB
Asset manager: 0x78c5b6289642Af6f47526E3D845395c9a53b3E6B
Minted: 13.60 FtestXRP  (1.36 lots)
```

2. List system info with basic agent's info.

```console
$ yarn user-bot info --agents -f FtestXRP -c ./run-config/run-config-user-coston-
testxrp.json
Initializing environment...
Environment successfully initialized.
FAsset: F-TestXRP (FtestXRP) at 0xA86379bC8644Ce1919cc750844E819c0a2cD28dB
Asset manager: 0x78c5b6289642Af6f47526E3D845395c9a53b3E6B
Minted: 13.60 FtestXRP  (1.36 lots)
-------------- Agents --------------
Vault address                               Owner address                                Minted lots     Free lots  Public
0x7c15f97B4B36112A8A18Aa7271af59a01d5182b4  0x88278079a62db08fEb125f270102651BbE8F9984          0.00             0  no
0x97204bd339e5e33acc7675dea5593f254BD8476C  0xb4d9dcE36bf7fBb4c3cdc63f18b96344c0181eD2          1.32             9  YES
0xe7548D6180007be8e6c2FF87Cad4B592d7E7EBFb  0x56597Fa74890E002Aa4F36E90beEb4E69c7Bae7D          0.04             0  no
0x4A023968C5c634F5067c4F08f60cBA5dcd3aaA45  0xb4d9dcE36bf7fBb4c3cdc63f18b96344c0181eD2          0.00             8  YES
0xf37E8F1ad5BC9C5Bb8bf387902DE82294889d2A3  0xb4d9dcE36bf7fBb4c3cdc63f18b96344c0181eD2          0.00             8  YES
0xac8067BC2FbFD8b8cfD68B6855dE6470B7DbEEb5  0xb4d9dcE36bf7fBb4c3cdc63f18b96344c0181eD2          0.00             8  YES
0xbE274f477Ab23bC7CBC867afC0247CbeA5d454AB  0xbaDC368bdCf8BB41FFF844bCF34a41968BdCe073          0.00             0  no
0x644E797A8e84469401FC615D6F470B4A1F55E1FF  0xbaDC368bdCf8BB41FFF844bCF34a41968BdCe073          0.00             0  no
0xA236c3c4A60F52B3aBF06Cd60750EabA333228c1  0xbaDC368bdCf8BB41FFF844bCF34a41968BdCe073          0.00             0  no
0x5bc0886D3117507C779BD8c6240eb1C396385223  0xbaDC368bdCf8BB41FFF844bCF34a41968BdCe073          0.00             1  YES
```

## How to list agent info?

1. List detail agent info for agent _0x5bc0886D3117507C779BD8c6240eb1C396385223_.

### User command

```console
$ yarn user-bot info 0x5bc0886D3117507C779BD8c6240eb1C396385223 -f FtestXRP -c ./run-config/run-config-user-coston-testxrp.json
```

### Agent command

```console
$ yarn user-bot info 0x5bc0886D3117507C779BD8c6240eb1C396385223  -f FtestXRP -c ./run-config/run-config-agent-coston-testxrp.json
```

### Result

```console
Initializing environment...
Environment successfully initialized.
status: NORMAL
ownerManagementAddress: 0xbaDC368bdCf8BB41FFF844bCF34a41968BdCe073
ownerWorkAddress: 0x0000000000000000000000000000000000000000
collateralPool: 0x280b8D365082ecEE206F8ac91f8f648a7cAEf2eD
underlyingAddressString: rNKzFmzr4D5gjrKaHwPn4efJwq8GuHfx3Q
publiclyAvailable: true
fee: 10.00%
poolFeeShare: 41.00%
vaultCollateralToken: 0xC06496FA0551bf4996fb5Df876cBcC6F1d836460
mintingVaultCollateralRatio: 1.680
mintingPoolCollateralRatio: 2.400
freeCollateralLots: 1
totalVaultCollateral: 50000.00 USDC
freeVaultCollateral: 50000.00 USDC
vaultCollateralRatio: 1000000.000
totalPoolCollateral: 4500.00 NAT
freePoolCollateral: 4500.00 NAT
poolCollateralRatio: 1000000.000
totalAgentPoolTokens: 4500.00 POOLTOK
announcedVaultCollateralWithdrawal: 0.00 USDC
announcedPoolTokensWithdrawal: 0.00 POOLTOK
freeAgentPoolTokens: 4500.00 POOLTOK
minted: 0.00 FtestXRP  (0.00 lots)
reserved: 0.00 FtestXRP  (0.00 lots)
redeeming: 0.00 FtestXRP  (0.00 lots)
poolRedeeming: 0.00 FtestXRP  (0.00 lots)
dust: 0.00 FtestXRP  (0.00 lots)
ccbStartTimestamp: 0
liquidationStartTimestamp: 0
maxLiquidationAmount: 0.00 FtestXRP  (0.00 lots)
liquidationPaymentFactorVault: 0.00%
liquidationPaymentFactorPool: 0.00%
underlyingBalance: 0.00 FtestXRP  (0.00 lots)
requiredUnderlyingBalance: 0.00 FtestXRP  (0.00 lots)
freeUnderlyingBalance: 0.00 FtestXRP  (0.00 lots)
announcedUnderlyingWithdrawalId: 0
buyFAssetByAgentFactor: 90.00%
poolExitCollateralRatio: 2.600
poolTopupCollateralRatio: 2.200
poolTopupTokenPriceFactor: 80.00%
```
