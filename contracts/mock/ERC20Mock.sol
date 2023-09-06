// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract ERC20Mock is ERC20 {

    constructor(string memory _name, string memory _symbol)
        ERC20(_name, _symbol)
    { }

    function mint(address _target, uint256 amount) external {
        _mint(_target, amount);
    }

    function burn(address _target, uint256 _amount) external {
        _burn(_target, _amount);
    }

}
