import BN from "bn.js";
import { FormatSettings, formatFixed } from "./formatting";
import { BNish, toBN, toBNExp } from "./helpers";

export class Currency {
    constructor(
        public symbol: string,
        public decimals: number,
    ) {}

    parse(amount: string): BN {
        return toBNExp(amount, this.decimals);
    }

    formatValue(amount: BNish, format?: FormatSettings) {
        return formatFixed(toBN(amount), this.decimals, format);
    }

    format(amount: BNish, format?: FormatSettings) {
        return `${this.formatValue(amount, format)} ${this.symbol}`;
    }
}
