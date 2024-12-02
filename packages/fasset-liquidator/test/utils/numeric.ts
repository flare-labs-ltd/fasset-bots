import * as crypto from 'crypto'
import { FASSET_MAX_BIPS } from '../constants'


export function abs(x: bigint): bigint {
    return x < 0 ? -x : x
}

export function mulFactor(x: bigint, factor: number): bigint {
    return x * BigInt(Math.floor(Number(FASSET_MAX_BIPS) * factor)) / FASSET_MAX_BIPS
}

// not really uniformly random, but it'll do
export function randBigInt(min: bigint, max: bigint): bigint {
    const diff = max - min
    const bitlen = diff.toString(2).length
    const bytelen = Math.ceil(bitlen / 8)
    const randbytes = BigInt("0x" + crypto.randomBytes(bytelen).toString('hex'))
    return min + randbytes % diff
}

export function randBigIntInRadius(center: bigint, radius: bigint): bigint {
    const min = center - radius
    const max = center + radius
    return randBigInt(min, max)
}

export function randBigIntInRelRadius(center: bigint, radiusPerc: number): bigint {
    const radius = center * BigInt(radiusPerc) / BigInt(100)
    return randBigIntInRadius(center, radius)
}

export function isqrt(value: bigint) {
    if (value < BigInt(2)) {
        return value;
    }
    if (value < BigInt(16)) {
        return BigInt(Math.sqrt(Number(value)) | 0);
    }
    let x0, x1;
    if (value < BigInt(4503599627370496)) {//1n<<52n
        x1 = BigInt(Math.sqrt(Number(value)) | 0) - BigInt(3);
    } else {
        const vlen = value.toString().length;
        if (!(vlen & 1)) {
            x1 = BigInt(10) ** (BigInt(vlen / 2));
        } else {
            x1 = BigInt(4) * BigInt(10) ** (BigInt((vlen / 2) | 0));
        }
    }
    do {
        x0 = x1;
        x1 = ((value / x0) + x0) >> BigInt(1);
    } while ((x0 !== x1 && x0 !== (x1 - BigInt(1))));
    return x0;
}
