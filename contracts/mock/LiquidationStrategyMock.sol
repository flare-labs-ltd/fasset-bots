// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "fasset/contracts/fasset/library/CollateralTypes.sol";


contract LiquidationStrategyMock {
    uint256 public liquidationCollateralFactorBIPS;
    uint256 public liquidationFactorVaultCollateralBIPS;

    function currentLiquidationFactorBIPS(
        address /* _agentVault */,
        uint256 _vaultCR,
        uint256 _poolCR
    )
        external view
        returns (uint256 _c1FactorBIPS, uint256 _poolFactorBIPS)
    {
        uint256 factorBIPS = Math.min(liquidationFactorVaultCollateralBIPS, liquidationCollateralFactorBIPS);
        // never exceed CR of tokens
        if (_c1FactorBIPS > _vaultCR) {
            _c1FactorBIPS = _vaultCR;
        }
        _poolFactorBIPS = factorBIPS - _c1FactorBIPS;
        if (_poolFactorBIPS > _poolCR) {
            _poolFactorBIPS = _poolCR;
            _c1FactorBIPS = Math.min(factorBIPS - _poolFactorBIPS, _vaultCR);
        }
    }

    function setLiquidationFactors(
        uint256 _liquidationCollateralFactorBIPS,
        uint256 _liquidationFactorVaultCollateralBIPS
    ) external {
        liquidationCollateralFactorBIPS = _liquidationCollateralFactorBIPS;
        liquidationFactorVaultCollateralBIPS = _liquidationFactorVaultCollateralBIPS;
    }
}
