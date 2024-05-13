import { BNish, CommandLineError, assertCmd, logger, toBN } from "@flarelabs/fasset-bots-core/utils";
import Web3 from "web3";

export { assertCmd as validate } from "@flarelabs/fasset-bots-core/utils";

export function validateAddress(address: string | null | undefined, what: string) {
    if (address == null) return;
    assertCmd(/0x[0-9a-fA-F]{40}/.test(address), `${what} is in invalid format.`);
    assertCmd(Web3.utils.checkAddressChecksum(address), `${what} has invalid EIP-55 checksum.`);
}

export function validateInteger(value: string | null | undefined, what: string, options: { min?: BNish, max?: BNish } = {}) {
    if (value == null) return;
    assertCmd(/^\d+$/.test(value), `${what} must be a whole number`);
    assertCmd(options.min == null || toBN(value).gte(toBN(options.min)), `${what} must be at least ${options.min}.`);
    assertCmd(options.max == null || toBN(value).lte(toBN(options.max)), `${what} must be at most ${options.max}.`);
}

export function validateDecimal(value: string | null | undefined, what: string, options: { min?: number, max?: number, strictMin?: number, strictMax?: number } = {}) {
    if (value == null) return;
    assertCmd(/^\d+(\.\d+)?$/.test(value), `${what} must be a decimal number`);
    assertCmd(options.min == null || Number(value) >= Number(options.min), `${what} must be at least ${options.min}.`);
    assertCmd(options.max == null || Number(value) <= Number(options.max), `${what} must be at most ${options.max}.`);
    assertCmd(options.strictMin == null || Number(value) > Number(options.strictMin), `${what} must be greater than ${options.strictMin}.`);
    assertCmd(options.strictMax == null || Number(value) < Number(options.strictMax), `${what} must be less than ${options.strictMax}.`);
}

export function validateOpt(value: string | null | undefined, test: (value: string) => boolean, message: string) {
    if (value == null) return;
    assertCmd(test(value), message);
}

export function translateError(error: any, translations: { [search: string]: string }) {
    if (!(error instanceof CommandLineError)) {
        const errorMessage = error?.message as unknown;
        if (typeof errorMessage === 'string') {
            for (const [search, userMessage] of Object.entries(translations)) {
                if (errorMessage.includes(search)) {
                    logger.error(`Error converted to command line message "${userMessage}":`, error);
                    throw new CommandLineError(userMessage);
                }
            }
        }
    }
    throw error;
}
