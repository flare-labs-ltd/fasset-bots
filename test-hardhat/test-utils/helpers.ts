import { TraceManager } from "@flarenetwork/mcc";
import assert from "node:assert";
import { TraceManager as TraceManagerSimpleWallet } from "simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace";
import { web3DeepNormalize } from "../../src/utils/web3normalize";

export function disableMccTraceManager() {
    TraceManager.enabled = false;
    TraceManagerSimpleWallet.enabled = false;
}

export function assertWeb3DeepEqual(x: any, y: any, message?: string) {
    assert.deepStrictEqual(web3DeepNormalize(x), web3DeepNormalize(y), message);
}