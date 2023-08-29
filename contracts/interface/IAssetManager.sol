// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IWNat.sol";
import "../fasset_data/AssetManagerSettings.sol";
import "../fasset_data/CollateralType.sol";
import "../fasset_data/AgentInfo.sol";
import "../fasset_data/AgentSettings.sol";
import "../fasset_data/AvailableAgentInfo.sol";

/**
 * Asset manager publicly callable methods.
 */
interface IAssetManager {
    ////////////////////////////////////////////////////////////////////////////////////
    // Basic system information

    /**
     * Get the asset manager controller, the only address that can change settings.
     * Asset manager must be attached to the asset manager controller in the system contract registry.
     */
    function assetManagerController()
        external view
        returns (address);

    /**
     * Get the f-asset contract managed by this asset manager instance.
     */
    function fAsset()
        external view
        returns (IERC20);

    /**
     * Return lot size in UBA (underlying base amount - smallest amount on underlying chain, e.g. satoshi).
     */
    function lotSize()
        external view
        returns (uint256 _lotSizeUBA);


    ////////////////////////////////////////////////////////////////////////////////////
    // System settings

    /**
     * Get complete current settings.
     * @return the current settings
     */
    function getSettings()
        external view
        returns (AssetManagerSettings.Data memory);

    /**
     * Get settings for current liquidation strategy. Format depends on the liquidation strategy implementation.
     * @return the current settings
     */
    function getLiquidationSettings()
        external view
        returns (bytes memory);

    /**
     * When `controllerAttached` is true, asset manager has been added to the asset manager controller.
     * This is required for the asset manager to be operational (create agent and minting don't work otherwise).
     */
    function controllerAttached()
        external view
        returns (bool);

    ////////////////////////////////////////////////////////////////////////////////////
    // Asset manager upgrading state

    /**
     * True if the asset manager is paused.
     * In the paused state, minting is disabled, but all other operations (e.g. redemptions, liquidation) still work.
     * Paused asset manager can be later unpaused.
     */
    function paused()
        external view
        returns (bool);

    /**
     * True if the asset manager is terminated.
     * In terminated state almost all operations (minting, redeeming, liquidation) are disabled and f-assets are
     * not transferable any more. The only operation still permitted is for agents to release the locked collateral
     * by calling `buybackAgentCollateral`.
     * An asset manager can be terminated after being paused for at least a month
     * (to redeem as many f-assets as possible).
     * The terminated asset manager can not be revived anymore.
     */
    function terminated()
        external view
        returns (bool);

    ////////////////////////////////////////////////////////////////////////////////////
    // Timekeeping for underlying chain

    /**
     * Get block number and timestamp of the current underlying block known to the f-asset system.
     * @return _blockNumber current underlying block number tracked by asset manager
     * @return _blockTimestamp current underlying block timestamp tracked by asset manager
     */
    function currentUnderlyingBlock()
        external view
        returns (uint256 _blockNumber, uint256 _blockTimestamp);

    ////////////////////////////////////////////////////////////////////////////////////
    // Available collateral types

    /**
     * Get collateral  information about a token.
     */
    function getCollateralType(CollateralType.Class _collateralClass, IERC20 _token)
        external view
        returns (CollateralType.Data memory);

    /**
     * Get the list of all available and deprecated tokens used for collateral.
     */
    function getCollateralTypes()
        external view
        returns (CollateralType.Data[] memory);

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent owner management and work address management

    /**
     * Associate a work address with the agent owner's management address.
     * Every owner (management address) can have only one work address, so as soon as the new one is set, the old
     * one stops working.
     * NOTE: May only be called by an agent on the allowed agent list and only from the management address.
     */
    function setOwnerWorkAddress(address _ownerWorkAddress) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent create / destroy

    /**
     * Create an agent vault.
     * The agent will always be identified by `_agentVault` address.
     * (Externally, one account may own several agent vaults,
     *  but in fasset system, each agent vault acts as an independent agent.)
     * NOTE: may only be called by an agent on the allowed agent list.
     * Can be called from the management or the work agent owner address.
     * @return _agentVault new agent vault address
     */
    function createAgentVault(
        AgentSettings.Data calldata _settings
    ) external
        returns (address _agentVault);

    /**
     * Announce that the agent is going to be destroyed. At this time, the agent must not have any mintings
     * or collateral reservations and must not be on the available agents list.
     * NOTE: may only be called by the agent vault owner.
     * @return _destroyAllowedAt the timestamp at which the destroy can be executed
     */
    function announceDestroyAgent(
        address _agentVault
    ) external
        returns (uint256 _destroyAllowedAt);

    /**
     * Delete all agent data, self destruct agent vault and send remaining collateral to the `_recipient`.
     * Procedure for destroying agent:
     * - exit available agents list
     * - wait until all assets are redeemed or perform self-close
     * - announce destroy (and wait the required time)
     * - call destroyAgent()
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the remaining funds from the vault will be transferred to the provided recipient.
     * @param _agentVault address of the agent's vault to destroy
     * @param _recipient address that receives the remaining funds and possible vault balance
     */
    function destroyAgent(
        address _agentVault,
        address payable _recipient
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent settings update

    /**
     * Due to the effect on the pool, all agent settings are timelocked.
     * This method announces a setting change. The change can be executed after the timelock expires.
     * NOTE: may only be called by the agent vault owner.
     * @return _updateAllowedAt the timestamp at which the update can be executed
     */
    function announceAgentSettingUpdate(
        address _agentVault,
        string memory _name,
        uint256 _value
    ) external
        returns (uint256 _updateAllowedAt);

    /**
     * Due to the effect on the pool, all agent settings are timelocked.
     * This method executes a setting change after the timelock expires.
     * NOTE: may only be called by the agent vault owner.
     */
    function executeAgentSettingUpdate(
        address _agentVault,
        string memory _name
    ) external;

    /**
     * If the current agent's vault collateral token gets deprecated, the agent must switch with this method.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: at the time of switch, the agent must have enough of both collaterals in the vault.
     */
    function switchVaultCollateral(
        address _agentVault,
        IERC20 _token
    ) external;

    /**
     * When current pool collateral token contract (WNat) is replaced by the method setPoolCollateralType,
     * pools don't switch automatically. Instead, the agent must call this method that swaps old WNat tokens for
     * new ones and sets it for use by the pool.
     * NOTE: may only be called by the agent vault owner.
     */
    function upgradeWNatContract(
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Collateral withdrawal announcement

    /**
     * The agent is going to withdraw `_valueNATWei` amount of collateral from the agent vault.
     * This has to be announced and the agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, the agent can call `withdrawCollateral(_vaultCollateralToken, _valueNATWei)`
     * on the agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     * @return _withdrawalAllowedAt the timestamp when the withdrawal can be made
     */
    function announceVaultCollateralWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    ) external
        returns (uint256 _withdrawalAllowedAt);

    /**
     * The agent is going to redeem `_valueWei` collateral pool tokens in the agent vault.
     * This has to be announced and the agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, the agent can call `redeemCollateralPoolTokens(_valueNATWei)` on the agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     * @return _redemptionAllowedAt the timestamp when the redemption can be made
     */
    function announceAgentPoolTokenRedemption(
        address _agentVault,
        uint256 _valueNATWei
    ) external
        returns (uint256 _redemptionAllowedAt);

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying balance topup

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying withdrawal announcements

    /**
     * Announce withdrawal of underlying currency.
     * In the event UnderlyingWithdrawalAnnounced the agent receives payment reference, which must be
     * added to the payment, otherwise it can be challenged as illegal.
     * Until the announced withdrawal is performed and confirmed or canceled, no other withdrawal can be announced.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function announceUnderlyingWithdrawal(
        address _agentVault
    ) external;

    /**
     * Cancel ongoing withdrawal of underlying currency.
     * Needed in order to reset announcement timestamp, so that others cannot front-run the agent at
     * `confirmUnderlyingWithdrawal` call. This could happen if withdrawal would be performed more
     * than `confirmationByOthersAfterSeconds` seconds after announcement.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function cancelUnderlyingWithdrawal(
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Terminated asset manager support

    /**
     * When f-asset is terminated, an agent can burn the market price of backed f-assets with his collateral,
     * to release the remaining collateral (and, formally, underlying assets).
     * This method ONLY works when f-asset is terminated, which will only be done when the asset manager
     * is already paused at least for a month and most f-assets are already burned and the only ones
     * remaining are unrecoverable.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the agent (management address) receives the vault collateral and NAT is burned instead. Therefore
     *      this method is `payable` and the caller must provide enough NAT to cover the received vault collateral
     *      amount multiplied by `vaultCollateralBuyForFlareFactorBIPS`.
     */
    function buybackAgentCollateral(
        address _agentVault
    ) external payable;

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent information

    /**
     * Get (a part of) the list of all agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAllAgents(uint256 _start, uint256 _end)
        external view
        returns (address[] memory _agentVaults, uint256 _totalLength);

    /**
     * Return detailed info about an agent, typically needed by a minter.
     * @param _agentVault agent vault address
     * @return structure containing agent's minting fee (BIPS), min collateral ratio (BIPS),
     *      and current free collateral (lots)
     */
    function getAgentInfo(address _agentVault)
        external view
        returns (AgentInfo.Info memory);

    /**
     * Returns the collateral pool address of the agent identified by `_agentVault`.
     */
    function getCollateralPool(address _agentVault)
        external view
        returns (address);

    /**
     * Return the management and the work address of the owner of the agent identified by `_agentVault`.
     */
    function getAgentVaultOwner(address _agentVault)
        external view
        returns (address _ownerManagementAddress, address _ownerWorkAddress);

    ////////////////////////////////////////////////////////////////////////////////////
    // List of available agents (i.e. publicly available for minting).

    /**
     * Add the agent to the list of publicly available agents.
     * Other agents can only self-mint.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function makeAgentAvailable(
        address _agentVault
    ) external;

    /**
     * Announce exit from the publicly available agents list.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @return _exitAllowedAt the timestamp when the agent can exit
     */
    function announceExitAvailableAgentList(
        address _agentVault
    ) external
        returns (uint256 _exitAllowedAt);

    /**
     * Exit the publicly available agents list.
     * NOTE: may only be called by the agent vault owner and after announcement.
     * @param _agentVault agent vault address
     */
    function exitAvailableAgentList(
        address _agentVault
    ) external;

    /**
     * Get (a part of) the list of available agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAvailableAgentsList(uint256 _start, uint256 _end)
        external view
        returns (address[] memory _agentVaults, uint256 _totalLength);

    /**
     * Get (a part of) the list of available agents with extra information about agents' fee, min collateral ratio
     * and available collateral (in lots).
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * NOTE: agent's available collateral can change anytime due to price changes, minting, or changes
     * in agent's min collateral ratio, so it is only to be used as an estimate.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAvailableAgentsDetailedList(uint256 _start, uint256 _end)
        external view
        returns (AvailableAgentInfo.Data[] memory _agents, uint256 _totalLength);

    ////////////////////////////////////////////////////////////////////////////////////
    // Minting

    /**
     * Before paying underlying assets for minting, minter has to reserve collateral and
     * pay collateral reservation fee. Collateral is reserved at ratio of agent's agentMinCollateralRatio
     * to requested lots NAT market price.
     * On success the minter receives instructions for underlying payment (value, fee and payment reference)
     * in event `CollateralReserved`. Then the minter has to pay `value + fee` on the underlying chain.
     * If the minter pays the underlying amount, the collateral reservation fee is burned and the minter obtains
     * f-assets. Otherwise the agent collects the collateral reservation fee.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * NOTE: the owner of the agent vault must be on the allowed agent list.
     * @param _agentVault agent vault address
     * @param _lots the number of lots for which to reserve collateral
     * @param _maxMintingFeeBIPS maximum minting fee (BIPS) that can be charged by the agent - best is just to
     *      copy current agent's published fee; used to prevent agent from front-running reservation request
     *      and increasing fee (that would mean that the minter would have to pay raised fee or forfeit
     *      collateral reservation fee)
     */
    function reserveCollateral(
        address _agentVault,
        uint256 _lots,
        uint256 _maxMintingFeeBIPS
    ) external payable;

    /**
     * Return the collateral reservation fee amount that has to be passed to the `reserveCollateral` method.
     * @param _lots the number of lots for which to reserve collateral
     * @return _reservationFeeNATWei the amount of reservation fee in NAT wei
     */
    function collateralReservationFee(uint256 _lots)
        external view
        returns (uint256 _reservationFeeNATWei);

    ////////////////////////////////////////////////////////////////////////////////////
    // Redemption

    /**
     * Redeem (up to) `_lots` lots of f-assets. The corresponding amount of the f-assets belonging
     * to the redeemer will be burned and the redeemer will get paid by the agent in underlying currency
     * (or, in case of agent's payment default, by agent's collateral with a premium).
     * NOTE: in some cases not all sent f-assets can be redeemed (either there are not enough tickets or
     * more than a fixed limit of tickets should be redeemed). In this case only part of the approved assets
     * are burned and redeemed and the redeemer can execute this method again for the remaining lots.
     * In such a case the `RedemptionRequestIncomplete` event will be emitted, indicating the number
     * of remaining lots.
     * Agent receives redemption request id and instructions for underlying payment in
     * RedemptionRequested event and has to pay `value - fee` and use the provided payment reference.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _lots number of lots to redeem
     * @param _redeemerUnderlyingAddressString the address to which the agent must transfer underlying amount
     * @return _redeemedAmountUBA the actual redeemed amount; may be less then requested if there are not enough
     *      redemption tickets available or the maximum redemption ticket limit is reached
     */
    function redeem(
        uint256 _lots,
        string memory _redeemerUnderlyingAddressString
    ) external
        returns (uint256 _redeemedAmountUBA);

    /**
     * Agent can "redeem against himself" by calling `selfClose`, which burns agent's own f-assets
     * and unlocks agent's collateral. The underlying funds backing the f-assets are released
     * as agent's free underlying funds and can be later withdrawn after announcement.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _amountUBA amount of f-assets to self-close
     * @return _closedAmountUBA the actual self-closed amount, may be less then requested if there are not enough
     *      redemption tickets available or the maximum redemption ticket limit is reached
     */
    function selfClose(
        address _agentVault,
        uint256 _amountUBA
    ) external
        returns (uint256 _closedAmountUBA);

    ////////////////////////////////////////////////////////////////////////////////////
    // Dust

    /**
     * Due to the minting pool fees or after a lot size change by the governance,
     * it may happen that less than one lot remains on a redemption ticket. This is named "dust" and
     * can be self closed or liquidated, but not redeemed. However, after several additions,
     * the total dust can amount to more than one lot. Using this method, the amount, rounded down
     * to a whole number of lots, can be converted to a new redemption ticket.
     * NOTE: we do NOT check that the caller is the agent vault owner, since we want to
     * allow anyone to convert dust to tickets to increase asset fungibility.
     * NOTE: dust above 1 lot is actually added to ticket at every minting, so this function need
     * only be called when the agent doesn't have any minting.
     * @param _agentVault agent vault address
     */
    function convertDustToTicket(
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Liquidation

    /**
     * Checks that the agent's collateral is too low and if true, starts the agent's liquidation.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * NOTE: always succeeds and returns the new liquidation status.
     * @param _agentVault agent vault address
     * @return _liquidationStatus 0=no liquidation, 1=CCB, 2=liquidation
     * @return _liquidationStartTs if the status is LIQUIDATION, the timestamp when liquidation started;
     *  if the status is CCB, the timestamp when liquidation will start; otherwise 0
     */
    function startLiquidation(
        address _agentVault
    ) external
        returns (uint8 _liquidationStatus, uint256 _liquidationStartTs);

    /**
     * Burns up to `_amountUBA` f-assets owned by the caller and pays
     * the caller the corresponding amount of native currency with premium
     * (premium depends on the liquidation state).
     * If the agent isn't in liquidation yet, but satisfies conditions,
     * automatically puts the agent in liquidation status.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     * @param _amountUBA the amount of f-assets to liquidate
     * @return _liquidatedAmountUBA liquidated amount of f-asset
     * @return _amountPaidVault amount paid to liquidator (in agent's vault collateral)
     * @return _amountPaidPool amount paid to liquidator (in NAT from pool)
     */
    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    ) external
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidVault, uint256 _amountPaidPool);

    /**
     * When the agent's collateral reaches the safe level during liquidation, the liquidation
     * process can be stopped by calling this method.
     * Full liquidation (i.e. the liquidation triggered by illegal underlying payment)
     * cannot be stopped.
     * NOTE: anybody can call.
     * NOTE: if the method succeeds, the agent's liquidation has ended.
     * @param _agentVault agent vault address
     */
    function endLiquidation(
        address _agentVault
    ) external;

    /**
     * Get WNat contract. Used by AgentVault.
     * @return WNat contract
     */
    function getWNat() external view returns (IWNat);
}
