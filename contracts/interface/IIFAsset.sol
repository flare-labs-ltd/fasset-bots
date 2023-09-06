// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "fasset/contracts/fasset/interface/IFAsset.sol";

interface IFAssetMetadata is IFAsset, IERC20Metadata { }