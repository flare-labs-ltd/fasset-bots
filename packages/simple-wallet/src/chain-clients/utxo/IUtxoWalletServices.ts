import { EntityManager } from "@mikro-orm/core";
import { UTXOBlockchainAPI } from "../../blockchain-apis/UTXOBlockchainAPI";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { TransactionFeeService } from "./TransactionFeeService";
import { TransactionService } from "./TransactionService";
import { TransactionUTXOService } from "./TransactionUTXOService";
import { IWalletKeys } from "../../interfaces/IWalletTransaction";

export interface IUtxoWalletServices {
    rootEm: EntityManager;
    feeService?: BlockchainFeeService;
    walletKeys: IWalletKeys
    blockchainAPI: UTXOBlockchainAPI;
    transactionFeeService: TransactionFeeService;
    transactionUTXOService: TransactionUTXOService;
    transactionService: TransactionService;
}
