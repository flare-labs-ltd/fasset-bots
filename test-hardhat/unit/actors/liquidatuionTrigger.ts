import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { LiquidationTrigger } from "../../../src/actors/LiquidationTrigger";
import { ORM } from "../../../src/config/orm";
import { ActorEntity, ActorType } from "../../../src/entities/actor";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { createTestOrm } from "../../../test/test.mikro-orm.config";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { createTestAssetContext } from "../../utils/test-asset-context";


describe("Liquidation trigger unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let liquidationTriggerAddress: string;
    let orm: ORM;
    let runner: ScopedRunner;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        liquidationTriggerAddress = accounts[10];
        runner = new ScopedRunner();
    });

    it("Should create liquidationTrigger", async () => {
        const liquidationTrigger = await LiquidationTrigger.create(runner, orm.em, context, liquidationTriggerAddress);
        expect(liquidationTrigger.address).to.eq(liquidationTriggerAddress);
    });

    it("Should read liquidationTrigger from entity", async () => {
        const liquidationTriggerEnt = await orm.em.findOneOrFail(ActorEntity, { address: liquidationTriggerAddress, type: ActorType.LIQUIDATION_TRIGGER } as FilterQuery<ActorEntity>);
        const liquidationTrigger = await LiquidationTrigger.fromEntity(runner, context, liquidationTriggerEnt);
        expect(liquidationTrigger.address).to.eq(liquidationTriggerAddress);
    });    

});