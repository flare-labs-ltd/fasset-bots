# FAsset bots

## FAsset
FAsset is a collateral lending system. The main actor in the system is the Agent. Agent together with its collateral pool supplies the collateral that is backing minted FAssets. Agent holds collateral in supported stable coin. Collateral pool holds collateral in WFLR/WSGB.

*Minimal Collateral Ratio (CR)*: At all times, the Agent's CR must satisfy the minimal CR as defined by the system. If due to price changes the position doesn’t satisfy the minimal CR, the Agent gets liquidated (until he reaches “safety CR”).

If the pool’s collateral ratio falls below the pool minimal CR as defined by the system, the redemption tickets the Agent is backing get liquidated against the pool collateral, until it reaches “pool safety CR”.

There are three basic flows for the FAsset system:

- Minting: the process of creating (minting) fAssets.
- Redemption: the process of destroying (burning) fAssets.
- Liquidation: the process of selling a part (or all) of an agent's position in a way that will have it satisfy the Min CR. Part of this operation includes burning FAssets.

See [FAsset repository](https://gitlab.com/flarenetwork/fasset).

## FAsset bots

The system that allows setting up an Agent and automate actions to events that require quick reactions (collateral reservation, minting, redemption, low collateral ratio).

## Documentation
See [documentation](./docs/README.md) for more.