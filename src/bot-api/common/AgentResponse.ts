export interface AgentCreateResponse {
    vaultAddress: string,
    ownerAddress: string,
    collateralPoolAddress: string,
    collateralPoolTokenAddress: string,
    underlyingAddress: string
}

export interface AgentBalance{
    balance: string
}