// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BalanceDecreasingTransaction} from "@flarelabs/fasset/contracts/stateConnector/interfaces/ISCProofVerifier.sol";


interface IChallenger {

    function illegalPaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault,
        uint256 _vaultToFAssetMinDexPriceMul,
        uint256 _vaultToFAssetMinDexPriceDiv,
        uint256 _poolToVaultMinDexPriceMul,
        uint256 _poolToVaultMinDexPriceDiv,
        address _flashLender,
        address _dex,
        address[] memory _vaultToFAssetDexPath,
        address[] memory _poolToVaultDexPath
    ) external;

    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault,
        uint256 _vaultToFAssetMinDexPriceMul,
        uint256 _vaultToFAssetMinDexPriceDiv,
        uint256 _poolToVaultMinDexPriceMul,
        uint256 _poolToVaultMinDexPriceDiv,
        address _flashLender,
        address _dex,
        address[] memory _vaultToFAssetDexPath,
        address[] memory _poolToVaultDexPath
    ) external;

    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault,
        uint256 _vaultToFAssetMinDexPriceMul,
        uint256 _vaultToFAssetMinDexPriceDiv,
        uint256 _poolToVaultMinDexPriceMul,
        uint256 _poolToVaultMinDexPriceDiv,
        address _flashLender,
        address _dex,
        address[] memory _vaultToFAssetDexPath,
        address[] memory _poolToVaultDexPath
    ) external;

}
