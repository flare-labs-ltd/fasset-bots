import { TraceManager } from "@flarenetwork/mcc/dist/src/utils/trace";
import { TraceManager as TraceManagerSimpleWallet } from "../../node_modules/simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace";

export function disableMccTraceManager() {
    TraceManager.enabled = false;
    TraceManagerSimpleWallet.enabled = false;
}