import { open } from "fs/promises";
import { BN_ZERO, MAX_BIPS, toBN } from "../../src/utils";
import { ColumnPrinter } from "../../src/commands/ColumnPrinter";
import BN from "bn.js";

async function main(args: string[]) {
    const printer = new ColumnPrinter([
        ["Datetime", 24, "l"],
        ["Block", 10, "l"],
        ["Event", 30, "l"],
        ["Balance", 12, "r"],
        ["BalanceChg", 12, "r"],
        ["Minted", 12, "r"],
        ["Redeeming", 12, "r"],
        ["Backing", 12, "r"],
        ["Required", 12, "r"],
        ["Free", 12, "r"],
    ]);
    printer.printHeader();
    //
    const infile = await open(args[0]);
    let mintedUBA = BN_ZERO;
    let redeemingUBA = BN_ZERO;
    let underlyingBalanceUBA = BN_ZERO;
    const ubaFactor = 1e-6;
    const formatUBA = (value: BN) => (Number(value) * ubaFactor).toFixed(3);
    const minBackingBIPS = 9800;
    for await (const line of infile.readLines()) {
        if (line.trim() === '') continue;
        const event = JSON.parse(line);
        let print = true;
        const prevUnderlyingBalanceUBA = underlyingBalanceUBA;
        if (event.name === "MintingExecuted" || event.name === "SelfMint") {
            mintedUBA = mintedUBA.add(toBN(event.args.mintedAmountUBA)).add(toBN(event.args.poolFeeUBA));
        } else if (event.name === "RedemptionRequested") {
            mintedUBA = mintedUBA.sub(toBN(event.args.valueUBA));
            redeemingUBA = redeemingUBA.add(toBN(event.args.valueUBA));
        } else if (event.name === "RedemptionPerformed" || event.name === "RedemptionPaymentBlocked" || event.name === "RedemptionDefault") {
            // TODO: add handshake support
            redeemingUBA = redeemingUBA.sub(toBN(event.args.redemptionAmountUBA));
        } else if (event.name === "UnderlyingBalanceChanged") {
            underlyingBalanceUBA = toBN(event.args.underlyingBalanceUBA);
        } else if (event.name === "UnderlyingWithdrawalAnnounced" || event.name === "UnderlyingWithdrawalConfirmed") {
            // just print
        } else if (event.name === "UnderlyingBalanceTooLow") {
            const freeUBA = toBN(event.args.balance).sub(toBN(event.args.requiredBalance));
            printer.printLine(event.datetime, event.block, event.name,
                formatUBA(toBN(event.args.balance)), "", "", "", "", formatUBA(event.args.requiredBalance), formatUBA(freeUBA));
        } else {
            print = false;
        }
        if (print) {
            const backingUBA = mintedUBA.add(redeemingUBA);
            const requiredUBA = backingUBA.muln(minBackingBIPS).divn(MAX_BIPS);
            const freeUBA = underlyingBalanceUBA.sub(requiredUBA);
            printer.printLine(event.datetime, event.block, event.name,
                formatUBA(underlyingBalanceUBA), formatUBA(underlyingBalanceUBA.sub(prevUnderlyingBalanceUBA)),
                formatUBA(mintedUBA), formatUBA(redeemingUBA), formatUBA(backingUBA), formatUBA(requiredUBA), formatUBA(freeUBA));
        }
    }
}

main(process.argv.slice(2)).catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
