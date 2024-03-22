import { expect } from "chai";
import { TestAssetBotContext, createTestAssetContext } from "../../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../../test/test-utils/TestChainInfo";
import { web3 } from "../../../../src/utils/web3";
import { Web3ContractEventDecoder } from "../../../../src/utils/events/Web3ContractEventDecoder";
import { AbiItem } from "web3-utils";

describe("Web3 event decoder unit tests",  () => {
    let context: TestAssetBotContext;
    let accounts: string[];

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
    });

    it("Should filter out one event", async () => {
        const eventDecoder = new Web3ContractEventDecoder(
            { assetManager: context.assetManager, ftsoManager: context.ftsoManager },
            { filter: ["RewardEpochFinalized"], requireKnownAddress: true }
        );
        expect(eventDecoder.eventTypes.size).to.eq(1);
    });

    it("Should handle anonymous event", async () => {
        const assetManagerAddress = context.assetManager.address;
        const rawEvent = {
            removed: false,
            logIndex: 0,
            transactionIndex: 0,
            transactionHash: "0x453b338dd87494bcd2a9c2f3ca3fda717fef1d4d882d53666fd7d7e4f40cdf7f",
            blockHash: "0xabeb07002dd9e2fc4d76c847d3829957bbb80fea576bd41bb18895654b8ed10f",
            blockNumber: 81,
            address: assetManagerAddress,
            data: "0x00000000000000000000000000000000000000000000000000000000000000020000000000000000000000006f35c791c8e6a2fb92fcee0b7c8609bb7f6dde2d0000000000000000000000000000000000000000000000000000000065b23737",
            topics: ["0x0a93c441628a8345854526201d5fec9110fe2e4ad5a0822eb6eda950864075e6"],
            id: "log_4059b9da",
        };
        const eventDecoder = new Web3ContractEventDecoder({ assetManager: context.assetManager, ftsoManager: context.ftsoManager }, { requireKnownAddress: true });
        // set event as anonymous and do some id changes to satisy requirements
        // must make a copy, otherwise later tests break
        const evtType = JSON.parse(JSON.stringify(eventDecoder.eventTypes.get("0xfa93c441628a8345854526201d5fec9110fe2e4ad5a0822eb6eda950864075e6"))) as AbiItem;
        evtType!.anonymous = true;
        evtType!.name = undefined;
        eventDecoder.eventTypes.set("0x0a93c441628a8345854526201d5fec9110fe2e4ad5a0822eb6eda950864075e6", evtType!);
        // decode event
        const decode = eventDecoder.decodeEvent(rawEvent);
        expect(decode?.event).eq("<unknown>");
        // change address
        const otherAddress = context.assetFtso.address;
        rawEvent.address = otherAddress;
        const decode2 = eventDecoder.decodeEvent(rawEvent);
        expect(decode2).to.be.null;
    });
});
