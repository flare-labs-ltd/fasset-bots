const secretPatterns = [
    /(^|\b)(0x)?[0-9a-fA-F]{64}(\b|$)/g, // secp256k1
    /(^|\b)[6Q][1-9A-HJ-NP-Za-km-z]{50,51}(\b|$)/g, // base58 doge
    /(^|\b)[5KL][1-9A-HJ-NP-Za-km-z]{50,51}(\b|$)/g // base58 btc
  ]

export function redact(text: string | object): string {
    if (typeof text === 'object') {
        return redactObject(text)
    } else if (typeof text === 'string') {
        return _redact(text)
    }
    return text
}

export function redactObject(obj: object): string {
    return _redact(JSON.stringify(obj))
}

function _redact(text: string): string {
    return secretPatterns.reduce((acc, pattern) => acc.replace(pattern, '***'), text)
}