import { expect } from "chai";
import { TestAssetBotContext, createTestAssetContext } from "../../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../../test/test-utils/TestChainInfo";
import { web3 } from "../../../../src/utils/web3";
import { Web3ContractEventDecoder } from "../../../../src/utils/events/Web3ContractEventDecoder";

describe("Web3 event decoder unit tests", async () => {
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
            logIndex: 4,
            transactionIndex: 0,
            transactionHash: "0xb0aec2df0e08686589a0c37c130fed9347966bbf30770642183d5a949f10e967",
            blockHash: "0xab8d4feed8f41ca471daeee1d1029eea959874f9a77a936e86fc4b692bc5aa87",
            blockNumber: 71,
            address: assetManagerAddress,
            data: "0x0000000000000000000000000000000000000000000000000000000000000045000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000004a817c8000000000000000000000000000000000000000000000000000000000047868c00000000000000000000000000000000000000000000000000000000002faf0800",
            topics: ["0x000000000000000000000000ea6abef9ea06253364bb6cf53065dafd2ca122fc"],
            id: "log_f104578b",
        };
        const eventDecoder = new Web3ContractEventDecoder(
            { assetManager: context.assetManager, ftsoManager: context.ftsoManager },
            { requireKnownAddress: true }
        );
        // set event as anonymous and do some id changes to satisy requirements
        // must make a copy, otherwise later tests break
        const evtType = JSON.parse(
            JSON.stringify(eventDecoder.eventTypes.get("0x48f66332f8d4c9cd3dc39336964f371b632b938e98a5b5c921caa4084cb51064"))
        ) as AbiItem;
        evtType!.anonymous = true;
        evtType!.name = undefined;
        eventDecoder.eventTypes.set("0x000000000000000000000000ea6abef9ea06253364bb6cf53065dafd2ca122fc", evtType!);
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
