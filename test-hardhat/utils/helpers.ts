import { TraceManager } from "@flarenetwork/mcc";
import { TraceManager as TraceManagerSimpleWallet } from "../../node_modules/simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace";

export function disableMccTraceManager() {
    TraceManager.enabled = false;
    TraceManagerSimpleWallet.enabled = false;
}