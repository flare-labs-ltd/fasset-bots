export interface AgentCreateResponse {
    vaultAddress: string,
    ownerAddress: string,
    collateralPoolAddress: string,
    collateralPoolTokenAddress: string,
    underlyingAddress: string
}

export interface AgentBalance {
    balance: string
}

export interface AgentUnderlying {
    paymentReference?: string | null
    transactionHash?: string
    address?: string
    privateKey?: string
}

