import { EntityManager } from "@mikro-orm/core";
import { UTXOBlockchainAPI } from "../../blockchain-apis/UTXOBlockchainAPI";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { TransactionFeeService } from "./TransactionFeeService";
import { TransactionService } from "./TransactionService";
import { TransactionUTXOService } from "./TransactionUTXOService";

export interface IUtxoWalletServices {
    rootEm: EntityManager;
    feeService?: BlockchainFeeService;
    blockchainAPI: UTXOBlockchainAPI;
    transactionFeeService: TransactionFeeService;
    transactionUTXOService: TransactionUTXOService;
    transactionService: TransactionService;
}
