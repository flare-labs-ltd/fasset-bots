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
    ownerAddress: string;
    collateralPool: string;
    underlyingAddressString: string;
    publiclyAvailable: boolean;
    feeBIPS: BN;
    poolFeeShareBIPS: BN;
    class1CollateralToken: string;
    mintingClass1CollateralRatioBIPS: BN;
    mintingPoolCollateralRatioBIPS: BN;
    freeCollateralLots: BN;
    totalClass1CollateralWei: BN;
    freeClass1CollateralWei: BN;
    class1CollateralRatioBIPS: BN;
    totalPoolCollateralNATWei: BN;
    freePoolCollateralNATWei: BN;
    poolCollateralRatioBIPS: BN;
    totalAgentPoolTokensWei: BN;
    freeAgentPoolTokensWei: BN;
    mintedUBA: BN;
    reservedUBA: BN;
    redeemingUBA: BN;
    poolRedeemingUBA: BN;
    dustUBA: BN;
    ccbStartTimestamp: BN;
    liquidationStartTimestamp: BN;
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
      ownerAddress: string;
      collateralPool: string;
      underlyingAddressString: string;
      publiclyAvailable: boolean;
      feeBIPS: BN;
      poolFeeShareBIPS: BN;
      class1CollateralToken: string;
      mintingClass1CollateralRatioBIPS: BN;
      mintingPoolCollateralRatioBIPS: BN;
      freeCollateralLots: BN;
      totalClass1CollateralWei: BN;
      freeClass1CollateralWei: BN;
      class1CollateralRatioBIPS: BN;
      totalPoolCollateralNATWei: BN;
      freePoolCollateralNATWei: BN;
      poolCollateralRatioBIPS: BN;
      totalAgentPoolTokensWei: BN;
      freeAgentPoolTokensWei: BN;
      mintedUBA: BN;
      reservedUBA: BN;
      redeemingUBA: BN;
      poolRedeemingUBA: BN;
      dustUBA: BN;
      ccbStartTimestamp: BN;
      liquidationStartTimestamp: BN;
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
