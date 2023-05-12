# FAsset bots

## FAsset bots

The automated system of FAsset system, which is a protocol for bridging assets from non-smart contract chains to Flare/Songbird. FAsset bots allow setting up an Agent and automate actions to events that require quick reactions (collateral reservation, minting, redemption, low collateral ratio).

## Documentation
See [documentation](./docs/README.md) for more.

## FAsset
FAsset is a collateral lending system. The main actor in the system is the Agent. Agent together with its Collateral Pool supplies the collateral that is backing minted FAssets. Agent holds collateral in supported stable coin. Collateral Pool holds collateral in WFLR/WSGB.

*Minimal Collateral Ratio (CR)*: At all times, the Agent's and CR must satisfy the minimal CR as defined by the system. If due to price changes the position doesn’t satisfy the minimal CR, the Agent gets liquidated (until he reaches “safety CR”).

If the Collateral Pool’s CR falls below the minimal CR as defined by the system, the redemption tickets the Agent is backing get liquidated against the Pool collateral, until it reaches “pool safety CR”.

There are three basic flows for the FAsset system:

- Minting: the process of creating (minting) fAssets.
- Redemption: the process of destroying (burning) fAssets.
- Liquidation: the process of selling a part (or all) of an agent's position in a way that will have it satisfy the Min CR. Part of this operation includes burning FAssets.

See [FAsset repository](https://gitlab.com/flarenetwork/fasset).
