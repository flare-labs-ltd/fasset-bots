import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { CcbPreventionTrigger } from "../../../src/actors/CcbPreventionTrigger";
import { ORM } from "../../../src/config/orm";
import { ActorEntity, ActorType } from "../../../src/entities/actor";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { web3 } from "../../../src/utils/web3";
import { createTestOrm } from "../../../test/test.mikro-orm.config";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { createTestAssetContext } from "../../utils/test-asset-context";


describe("Collateral call band prevention trigger unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let ccbPreventionTriggerAddress: string;
    let orm: ORM;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        ccbPreventionTriggerAddress = accounts[10];
    });

    it("Should create ccbPreventionTrigger", async () => {
        const ccbPreventionTrigger = await CcbPreventionTrigger.create(orm.em, context, ccbPreventionTriggerAddress);
        expect(ccbPreventionTrigger.address).to.eq(ccbPreventionTriggerAddress);
    });

    it("Should read ccbPreventionTrigger from entity", async () => {
        const ccbPreventionTriggerEnt = await orm.em.findOneOrFail(ActorEntity, { address: ccbPreventionTriggerAddress, type: ActorType.CCB_PREVENTION_TRIGGER } as FilterQuery<ActorEntity>);
        const ccbPreventionTrigger = await CcbPreventionTrigger.fromEntity(context, ccbPreventionTriggerEnt);
        expect(ccbPreventionTrigger.address).to.eq(ccbPreventionTriggerAddress);
    });    

});