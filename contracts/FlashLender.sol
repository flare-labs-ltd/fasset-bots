// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract FlashLender is IERC3156FlashLender, Ownable {
    bytes32 private constant RETURN_VALUE = keccak256("ERC3156FlashBorrower.onFlashLoan");

    IERC20 immutable private token;

    error ERC3156ExceededMaxLoan(uint256 maxLoan);
    error ERC3156InvalidReceiver(address receiver);

    constructor(IERC20 _token) Ownable() {
        token = _token;
    }

    function withdraw() public onlyOwner {
        token.transfer(msg.sender, token.balanceOf(address(this)));
    }

    function maxFlashLoan(address _token) public view returns (uint256) {
        require(_token == address(token), "FlashLender: invalid token");
        return IERC20(_token).balanceOf(address(this));
    }

    function flashFee(address _token, uint256 /* _value */) public view returns (uint256) {
        require(_token == address(token), "FlashLender: invalid token");
        return 0;
    }

    function flashFeeReceiver(address _token) public view returns (address) {
        require(_token == address(token), "FlashLender: invalid token");
        return address(0);
    }

    function flashLoan(
        IERC3156FlashBorrower _receiver,
        address _token,
        uint256 _amount,
        bytes calldata _data
    ) public virtual returns (bool) {
        require(_token == address(token), "FlashLender: invalid token");
        uint256 maxLoan = maxFlashLoan(_token);
        if (_amount > maxLoan) {
            revert ERC3156ExceededMaxLoan(maxLoan);
        }
        uint256 fee = flashFee(_token, _amount);
        _mint(address(_receiver), _amount);
        if (_receiver.onFlashLoan(msg.sender, _token, _amount, fee, _data) != RETURN_VALUE) {
            revert ERC3156InvalidReceiver(address(_receiver));
        }
        address _flashFeeReceiver = flashFeeReceiver(_token);
        if (fee == 0 || _flashFeeReceiver == address(0)) {
            _burn(address(_receiver), _amount + fee);
        } else {
            _burn(address(_receiver), _amount);
            _transfer(address(_receiver), _flashFeeReceiver, fee);
        }
        return true;
    }

    function _mint(address _account, uint256 _amount) internal {
        token.transfer(_account, _amount);
    }

    function _burn(address _account, uint256 _amount) internal {
        token.transferFrom(_account, address(this), _amount);
    }

    function _transfer(address _from, address _to, uint256 _amount) internal {
        token.transferFrom(_from, _to, _amount);
    }

}