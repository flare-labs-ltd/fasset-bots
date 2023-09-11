/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface FullAgentInfoContract
  extends Truffle.Contract<FullAgentInfoInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<FullAgentInfoInstance>;
}

type AllEvents = never;

export interface FullAgentInfoInstance extends Truffle.ContractInstance {
  getAgentInfo(
    _agentVault: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{
    status: BN;
    ownerManagementAddress: string;
    ownerWorkAddress: string;
    collateralPool: string;
    underlyingAddressString: string;
    publiclyAvailable: boolean;
    feeBIPS: BN;
    poolFeeShareBIPS: BN;
    vaultCollateralToken: string;
    mintingVaultCollateralRatioBIPS: BN;
    mintingPoolCollateralRatioBIPS: BN;
    freeCollateralLots: BN;
    totalVaultCollateralWei: BN;
    freeVaultCollateralWei: BN;
    vaultCollateralRatioBIPS: BN;
    totalPoolCollateralNATWei: BN;
    freePoolCollateralNATWei: BN;
    poolCollateralRatioBIPS: BN;
    totalAgentPoolTokensWei: BN;
    announcedVaultCollateralWithdrawalWei: BN;
    announcedPoolTokensWithdrawalWei: BN;
    freeAgentPoolTokensWei: BN;
    mintedUBA: BN;
    reservedUBA: BN;
    redeemingUBA: BN;
    poolRedeemingUBA: BN;
    dustUBA: BN;
    ccbStartTimestamp: BN;
    liquidationStartTimestamp: BN;
    maxLiquidationAmountUBA: BN;
    liquidationPaymentFactorVaultBIPS: BN;
    liquidationPaymentFactorPoolBIPS: BN;
    underlyingBalanceUBA: BN;
    requiredUnderlyingBalanceUBA: BN;
    freeUnderlyingBalanceUBA: BN;
    announcedUnderlyingWithdrawalId: BN;
    buyFAssetByAgentFactorBIPS: BN;
    poolExitCollateralRatioBIPS: BN;
    poolTopupCollateralRatioBIPS: BN;
    poolTopupTokenPriceFactorBIPS: BN;
  }>;

  methods: {
    getAgentInfo(
      _agentVault: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{
      status: BN;
      ownerManagementAddress: string;
      ownerWorkAddress: string;
      collateralPool: string;
      underlyingAddressString: string;
      publiclyAvailable: boolean;
      feeBIPS: BN;
      poolFeeShareBIPS: BN;
      vaultCollateralToken: string;
      mintingVaultCollateralRatioBIPS: BN;
      mintingPoolCollateralRatioBIPS: BN;
      freeCollateralLots: BN;
      totalVaultCollateralWei: BN;
      freeVaultCollateralWei: BN;
      vaultCollateralRatioBIPS: BN;
      totalPoolCollateralNATWei: BN;
      freePoolCollateralNATWei: BN;
      poolCollateralRatioBIPS: BN;
      totalAgentPoolTokensWei: BN;
      announcedVaultCollateralWithdrawalWei: BN;
      announcedPoolTokensWithdrawalWei: BN;
      freeAgentPoolTokensWei: BN;
      mintedUBA: BN;
      reservedUBA: BN;
      redeemingUBA: BN;
      poolRedeemingUBA: BN;
      dustUBA: BN;
      ccbStartTimestamp: BN;
      liquidationStartTimestamp: BN;
      maxLiquidationAmountUBA: BN;
      liquidationPaymentFactorVaultBIPS: BN;
      liquidationPaymentFactorPoolBIPS: BN;
      underlyingBalanceUBA: BN;
      requiredUnderlyingBalanceUBA: BN;
      freeUnderlyingBalanceUBA: BN;
      announcedUnderlyingWithdrawalId: BN;
      buyFAssetByAgentFactorBIPS: BN;
      poolExitCollateralRatioBIPS: BN;
      poolTopupCollateralRatioBIPS: BN;
      poolTopupTokenPriceFactorBIPS: BN;
    }>;
  };

  getPastEvents(event: string): Promise<EventData[]>;
  getPastEvents(
    event: string,
    options: PastEventOptions,
    callback: (error: Error, event: EventData) => void
  ): Promise<EventData[]>;
  getPastEvents(event: string, options: PastEventOptions): Promise<EventData[]>;
  getPastEvents(
    event: string,
    callback: (error: Error, event: EventData) => void
  ): Promise<EventData[]>;
}
