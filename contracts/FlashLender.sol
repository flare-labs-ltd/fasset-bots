// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/IFlashLender.sol";

contract FlashLender is IFlashLender {
    bytes32 private constant RETURN_VALUE = keccak256("ERC3156FlashBorrower.onFlashLoan");

    IERC20 immutable public token;
    uint256 immutable public flashFee;
    address immutable public flashFeeReceiver;

    error ERC3156ExceededMaxLoan(uint256 maxLoan);
    error ERC3156InvalidReceiver(address receiver);

    constructor(IERC20 _token, uint256 _flashFee, address _flashFeeReceiver) {
        token = _token;
        flashFee = _flashFee;
        flashFeeReceiver = _flashFeeReceiver;
    }

    function maxFlashLoan() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function flashLoan(
        IERC3156FlashBorrower _receiver,
        uint256 _value,
        bytes calldata _data
    ) external returns (bool) {
        uint256 maxLoan = maxFlashLoan();
        if (_value > maxLoan) {
            revert ERC3156ExceededMaxLoan(maxLoan);
        }
        uint256 fee = flashFee;
        _mint(address(_receiver), _value);
        if (_receiver.onFlashLoan(msg.sender, address(token), _value, fee, _data) != RETURN_VALUE) {
            revert ERC3156InvalidReceiver(address(_receiver));
        }
        if (fee == 0 || flashFeeReceiver == address(0)) {
            _burn(address(_receiver), _value + fee);
        } else {
            _burn(address(_receiver), _value);
            _transfer(address(_receiver), flashFeeReceiver, fee);
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