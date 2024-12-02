/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface SettingsReaderFacetContract
  extends Truffle.Contract<SettingsReaderFacetInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<SettingsReaderFacetInstance>;
}

export type AllEvents = never;

export interface SettingsReaderFacetInstance extends Truffle.ContractInstance {
  assetManagerController(
    txDetails?: Truffle.TransactionDetails
  ): Promise<string>;

  assetMintingDecimals(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  assetMintingGranularityUBA(
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  fAsset(txDetails?: Truffle.TransactionDetails): Promise<string>;

  getCollateralPoolTokenTimelockSeconds(
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  getSettings(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{
    assetManagerController: string;
    fAsset: string;
    agentVaultFactory: string;
    collateralPoolFactory: string;
    collateralPoolTokenFactory: string;
    poolTokenSuffix: string;
    whitelist: string;
    agentOwnerRegistry: string;
    fdcVerification: string;
    burnAddress: string;
    priceReader: string;
    assetDecimals: BN;
    assetMintingDecimals: BN;
    chainId: string;
    averageBlockTimeMS: BN;
    mintingPoolHoldingsRequiredBIPS: BN;
    collateralReservationFeeBIPS: BN;
    assetUnitUBA: BN;
    assetMintingGranularityUBA: BN;
    lotSizeAMG: BN;
    minUnderlyingBackingBIPS: BN;
    requireEOAAddressProof: boolean;
    mintingCapAMG: BN;
    underlyingBlocksForPayment: BN;
    underlyingSecondsForPayment: BN;
    redemptionFeeBIPS: BN;
    redemptionDefaultFactorVaultCollateralBIPS: BN;
    redemptionDefaultFactorPoolBIPS: BN;
    confirmationByOthersAfterSeconds: BN;
    confirmationByOthersRewardUSD5: BN;
    maxRedeemedTickets: BN;
    paymentChallengeRewardBIPS: BN;
    paymentChallengeRewardUSD5: BN;
    withdrawalWaitMinSeconds: BN;
    maxTrustedPriceAgeSeconds: BN;
    ccbTimeSeconds: BN;
    attestationWindowSeconds: BN;
    minUpdateRepeatTimeSeconds: BN;
    buybackCollateralFactorBIPS: BN;
    announcedUnderlyingConfirmationMinSeconds: BN;
    tokenInvalidationTimeMinSeconds: BN;
    vaultCollateralBuyForFlareFactorBIPS: BN;
    agentExitAvailableTimelockSeconds: BN;
    agentFeeChangeTimelockSeconds: BN;
    agentMintingCRChangeTimelockSeconds: BN;
    poolExitAndTopupChangeTimelockSeconds: BN;
    agentTimelockedOperationWindowSeconds: BN;
    collateralPoolTokenTimelockSeconds: BN;
    liquidationStepSeconds: BN;
    liquidationCollateralFactorBIPS: BN[];
    liquidationFactorVaultCollateralBIPS: BN[];
    diamondCutMinTimelockSeconds: BN;
    maxEmergencyPauseDurationSeconds: BN;
    emergencyPauseDurationResetAfterSeconds: BN;
    cancelCollateralReservationAfterSeconds: BN;
    rejectRedemptionRequestWindowSeconds: BN;
    takeOverRedemptionRequestWindowSeconds: BN;
    rejectedRedemptionDefaultFactorVaultCollateralBIPS: BN;
    rejectedRedemptionDefaultFactorPoolBIPS: BN;
  }>;

  lotSize(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  priceReader(txDetails?: Truffle.TransactionDetails): Promise<string>;

  methods: {
    assetManagerController(
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;

    assetMintingDecimals(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    assetMintingGranularityUBA(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    fAsset(txDetails?: Truffle.TransactionDetails): Promise<string>;

    getCollateralPoolTokenTimelockSeconds(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    getSettings(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{
      assetManagerController: string;
      fAsset: string;
      agentVaultFactory: string;
      collateralPoolFactory: string;
      collateralPoolTokenFactory: string;
      poolTokenSuffix: string;
      whitelist: string;
      agentOwnerRegistry: string;
      fdcVerification: string;
      burnAddress: string;
      priceReader: string;
      assetDecimals: BN;
      assetMintingDecimals: BN;
      chainId: string;
      averageBlockTimeMS: BN;
      mintingPoolHoldingsRequiredBIPS: BN;
      collateralReservationFeeBIPS: BN;
      assetUnitUBA: BN;
      assetMintingGranularityUBA: BN;
      lotSizeAMG: BN;
      minUnderlyingBackingBIPS: BN;
      requireEOAAddressProof: boolean;
      mintingCapAMG: BN;
      underlyingBlocksForPayment: BN;
      underlyingSecondsForPayment: BN;
      redemptionFeeBIPS: BN;
      redemptionDefaultFactorVaultCollateralBIPS: BN;
      redemptionDefaultFactorPoolBIPS: BN;
      confirmationByOthersAfterSeconds: BN;
      confirmationByOthersRewardUSD5: BN;
      maxRedeemedTickets: BN;
      paymentChallengeRewardBIPS: BN;
      paymentChallengeRewardUSD5: BN;
      withdrawalWaitMinSeconds: BN;
      maxTrustedPriceAgeSeconds: BN;
      ccbTimeSeconds: BN;
      attestationWindowSeconds: BN;
      minUpdateRepeatTimeSeconds: BN;
      buybackCollateralFactorBIPS: BN;
      announcedUnderlyingConfirmationMinSeconds: BN;
      tokenInvalidationTimeMinSeconds: BN;
      vaultCollateralBuyForFlareFactorBIPS: BN;
      agentExitAvailableTimelockSeconds: BN;
      agentFeeChangeTimelockSeconds: BN;
      agentMintingCRChangeTimelockSeconds: BN;
      poolExitAndTopupChangeTimelockSeconds: BN;
      agentTimelockedOperationWindowSeconds: BN;
      collateralPoolTokenTimelockSeconds: BN;
      liquidationStepSeconds: BN;
      liquidationCollateralFactorBIPS: BN[];
      liquidationFactorVaultCollateralBIPS: BN[];
      diamondCutMinTimelockSeconds: BN;
      maxEmergencyPauseDurationSeconds: BN;
      emergencyPauseDurationResetAfterSeconds: BN;
      cancelCollateralReservationAfterSeconds: BN;
      rejectRedemptionRequestWindowSeconds: BN;
      takeOverRedemptionRequestWindowSeconds: BN;
      rejectedRedemptionDefaultFactorVaultCollateralBIPS: BN;
      rejectedRedemptionDefaultFactorPoolBIPS: BN;
    }>;

    lotSize(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    priceReader(txDetails?: Truffle.TransactionDetails): Promise<string>;
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
