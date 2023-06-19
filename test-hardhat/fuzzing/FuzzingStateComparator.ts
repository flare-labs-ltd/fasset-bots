import BN from "bn.js";
import { BN_ZERO, BNish, toBN } from "../../src/utils/helpers";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { formatBN } from "../test-utils/fuzzing-utils";


export class FuzzingStateComparator {
    problems: number = 0;

    isNumeric(value: unknown): value is BNish {
        return typeof value === 'number' || BN.isBN(value) || (typeof value === 'string' && /^\d+$/.test(value));
    }

    checkEquality(description: string, actualValue: unknown, trackedValue: unknown, alwaysLog: boolean = false) {
        if (this.isNumeric(actualValue) && this.isNumeric(trackedValue)) {
            return this.checkNumericDifference(description, actualValue, 'eq', trackedValue, alwaysLog);
        } else {
            return this.checkStringEquality(description, actualValue, trackedValue, alwaysLog);
        }
    }

    checkStringEquality(description: string, actualValue: unknown, trackedValue: unknown, alwaysLog: boolean = false) {
        const actualValueS = JSON.stringify(web3DeepNormalize(actualValue));
        const trackedValueS = JSON.stringify(web3DeepNormalize(trackedValue));
        const different = actualValueS !== trackedValueS;
        if (different || alwaysLog) {
            const actualCmp = different ? '!=' : '==';
            console.log(`    ${different ? 'different' : 'equal'}  ${description}:  actual=${actualValueS} ${actualCmp} tracked=${trackedValueS}`);
        }
        this.problems += different ? 1 : 0;
        return different ? 1 : 0;
    }

    checkNumericDifference(description: string, actualValue: BNish, comparison: 'eq' | 'lte' | 'gte', trackedValue: BNish, alwaysLog: boolean = false) {
        const diff = toBN(actualValue).sub(toBN(trackedValue));
        const problem = !diff[comparison](BN_ZERO);
        if (problem || alwaysLog) {
            const actualCmp = diff.eq(BN_ZERO) ? "==" : (diff.lt(BN_ZERO) ? "<" : ">");
            const okMsg = comparison === 'eq' ? 'equal' : (comparison === 'lte' ? 'ok (<=)' : 'ok (>=)');
            const problemMsg = comparison === 'eq' ? 'different' : (comparison === 'lte' ? 'problem (too large)' : 'problem (too small)');
            console.log(`    ${problem ? problemMsg : okMsg}  ${description}:  actual=${formatBN(actualValue)} ${actualCmp} tracked=${formatBN(trackedValue)},  difference=${formatBN(diff)}`);
        }
        this.problems += problem ? 1 : 0;
        return problem ? 1 : 0;
    }
}
