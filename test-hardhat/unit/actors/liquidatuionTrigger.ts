import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { LiquidationTrigger } from "../../../src/actors/LiquidationTrigger";
import { ORM } from "../../../src/config/orm";
import { ActorEntity, ActorType } from "../../../src/entities/actor";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/utils/test-bot-config";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { createTestAssetContext } from "../../utils/test-asset-context";


describe("Liquidation trigger unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let liquidationTriggerAddress: string;
    let orm: ORM;
    let runner: ScopedRunner;
    let state: TrackedState;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        liquidationTriggerAddress = accounts[10];
        runner = new ScopedRunner();
        state = new TrackedState();
    });

    it("Should create liquidationTrigger", async () => {
        const liquidationTrigger = await LiquidationTrigger.create(runner, orm.em, context, liquidationTriggerAddress, state);
        expect(liquidationTrigger.address).to.eq(liquidationTriggerAddress);
    });

    it("Should read liquidationTrigger from entity", async () => {
        const liquidationTriggerEnt = await orm.em.findOneOrFail(ActorEntity, { address: liquidationTriggerAddress, type: ActorType.LIQUIDATION_TRIGGER } as FilterQuery<ActorEntity>);
        const liquidationTrigger = await LiquidationTrigger.fromEntity(runner, context, liquidationTriggerEnt, state);
        expect(liquidationTrigger.address).to.eq(liquidationTriggerAddress);
    });

});