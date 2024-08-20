import BN from "bn.js";

export class InvalidFeeError extends Error {
    public readonly correctFee: BN;
    public readonly prototype: InvalidFeeError;

    constructor(message: string, correctFee: BN) {
        super(message);
        this.correctFee = correctFee;
        this.prototype = InvalidFeeError.prototype;
    }
}

export class NotEnoughUTXOsError extends Error {
    constructor(message: string) {
        super(message);
    }
}