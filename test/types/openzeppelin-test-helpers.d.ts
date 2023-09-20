declare module '@openzeppelin/test-helpers' {
  export async function expectRevert(
    response: Promise<Truffle.TransactionResponse<OwnershipTransferred>>,
    message: string
  ): Promise<void>;
}