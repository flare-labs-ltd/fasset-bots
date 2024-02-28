// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC3156FlashLender} from "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";


contract FlashLender is IERC3156FlashLender, Ownable {
    bytes32 private constant RETURN_VALUE = keccak256("ERC3156FlashBorrower.onFlashLoan");

    error ERC3156ExceededMaxLoan(uint256 maxLoan);
    error ERC3156InvalidReceiver(address receiver);

    constructor() Ownable() {
    }

    function withdraw(IERC20 _token) public onlyOwner {
        _token.transfer(msg.sender, _token.balanceOf(address(this)));
    }

    function maxFlashLoan(address _token) public view returns (uint256) {
        return IERC20(_token).balanceOf(address(this));
    }

    function flashFee(address /* _token */, uint256 /* _value */) public pure returns (uint256) {
        return 0;
    }

    function flashFeeReceiver(address /* _token */) public pure returns (address) {
        return address(0);
    }

    function flashLoan(
        IERC3156FlashBorrower _receiver,
        address _token,
        uint256 _amount,
        bytes calldata _data
    ) public virtual returns (bool) {
        uint256 maxLoan = maxFlashLoan(address(_token));
        if (_amount > maxLoan) {
            revert ERC3156ExceededMaxLoan(maxLoan);
        }
        uint256 fee = flashFee(address(_token), _amount);
        _mint(_token, address(_receiver), _amount);
        if (_receiver.onFlashLoan(msg.sender, address(_token), _amount, fee, _data) != RETURN_VALUE) {
            revert ERC3156InvalidReceiver(address(_receiver));
        }
        address _flashFeeReceiver = flashFeeReceiver(address(_token));
        if (fee == 0 || _flashFeeReceiver == address(0)) {
            _burn(_token, address(_receiver), _amount + fee);
        } else {
            _burn(_token, address(_receiver), _amount);
            _transfer(_token, address(_receiver), _flashFeeReceiver, fee);
        }
        return true;
    }

    function _mint(address _token, address _account, uint256 _amount) internal {
        IERC20(_token).transfer(_account, _amount);
    }

    function _burn(address _token, address _account, uint256 _amount) internal {
        IERC20(_token).transferFrom(_account, address(this), _amount);
    }

    function _transfer(address _token, address _from, address _to, uint256 _amount) internal {
        IERC20(_token).transferFrom(_from, _to, _amount);
    }

}