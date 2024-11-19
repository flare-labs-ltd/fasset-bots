// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@flarelabs/fasset/contracts/assetManager/mock/FakeERC20.sol"; // compile for tests


contract ERC20Mock is ERC20 {
    uint8 public decimals_;

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    )
        ERC20(_name, _symbol)
    {
        decimals_ = _decimals;
    }

    function mint(address _target, uint256 amount) external {
        _mint(_target, amount);
    }

    function burn(address _target, uint256 _amount) external {
        _burn(_target, _amount);
    }

    function decimals() public view override returns (uint8) {
        return decimals_;
    }

}
