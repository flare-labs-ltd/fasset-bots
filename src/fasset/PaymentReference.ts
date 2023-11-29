import { BNish, toBN, toHex } from "../utils/helpers";

export namespace PaymentReference {
    export const TYPE_SHIFT = 192;
    export const LOW_BITS_MASK = toBN(1).shln(TYPE_SHIFT).subn(1);

    // common prefix 0x464250526641 = hex('FBPRfA' - Flare Bridge Payment Reference / fAsset)

    export const MINTING = toBN("0x4642505266410001").shln(TYPE_SHIFT);
    export const REDEMPTION = toBN("0x4642505266410002").shln(TYPE_SHIFT);
    export const ANNOUNCED_WITHDRAWAL = toBN("0x4642505266410003").shln(TYPE_SHIFT);
    export const TOPUP = toBN("0x4642505266410011").shln(TYPE_SHIFT);
    export const SELF_MINT = toBN("0x4642505266410012").shln(TYPE_SHIFT);
    export const ADDRESS_OWNERSHIP = toBN("0x4642505266410013").shln(TYPE_SHIFT);

    export function minting(id: BNish): string {
        return toHex(toBN(id).or(MINTING), 32);
    }

    export function redemption(id: BNish): string {
        return toHex(toBN(id).or(REDEMPTION), 32);
    }

    export function announcedWithdrawal(id: BNish): string {
        return toHex(toBN(id).or(ANNOUNCED_WITHDRAWAL), 32);
    }

    export function topup(address: string): string {
        return toHex(toBN(address).or(TOPUP), 32);
    }

    export function selfMint(address: string): string {
        return toHex(toBN(address).or(SELF_MINT), 32);
    }

    export function addressOwnership(address: string): string {
        return toHex(toBN(address).or(ADDRESS_OWNERSHIP), 32);
    }

    export function isValid(reference: string | null): reference is string {
        return reference != null && /^0x464250526641[0-9a-zA-Z]{52}$/.test(reference);
    }

    export function decodeId(reference: string) {
        return toBN(reference).and(LOW_BITS_MASK);
    }

    export function decodeType(reference: string) {
        return toBN(reference).shrn(TYPE_SHIFT).and(toBN(0xffff)).toNumber();
    }
}
