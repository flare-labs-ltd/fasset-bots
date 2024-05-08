import BN from "bn.js";
import { FormatSettings, FormattedString, formatFixed } from "./formatting";
import { BNish, toBN, toBNExp } from "./helpers";

export interface CurrencyFormatSettings extends FormatSettings {
    unit?: boolean;     // if true (default), currency unit is appended to formatted number
}

export class Currency {
    constructor(
        public symbol: string,
        public decimals: number,
    ) {}

    parse(amount: string): BN {
        return toBNExp(amount, this.decimals);
    }

    formatValue(amount: BNish, format?: FormatSettings): FormattedString {
        return formatFixed(toBN(amount), this.decimals, format);
    }

    format(amount: BNish, format?: CurrencyFormatSettings): FormattedString {
        const formattedAmount = this.formatValue(amount, format);
        const appendUnit = format?.unit ?? true;
        return appendUnit ? `${formattedAmount} ${this.symbol}` as FormattedString : formattedAmount;
    }
}
