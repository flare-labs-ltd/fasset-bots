import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { Challenger } from "../../../src/actors/Challenger";
import { ORM } from "../../../src/config/orm";
import { ActorEntity, ActorType } from "../../../src/entities/actor";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { createTestOrm } from "../../../test/test.mikro-orm.config";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { createTestAssetContext } from "../../utils/test-asset-context";


describe("Challenger unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let runner: ScopedRunner;
    let challengerAddress: string;
    let orm: ORM;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await createTestOrm({ schemaUpdate: 'recreate' });
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        runner = new ScopedRunner();
        challengerAddress = accounts[10];
    });

    it("Should create challenger", async () => {
        const challenger = await Challenger.create(runner, orm.em, context, challengerAddress);
        expect(challenger.address).to.eq(challengerAddress);
    });

    it("Should read agent from entity", async () => {
        const challengerEnt = await orm.em.findOneOrFail(ActorEntity, { address: challengerAddress, type: ActorType.CHALLENGER } as FilterQuery<ActorEntity>);
        const challengerBot = await Challenger.fromEntity(runner, context, challengerEnt);
        expect(challengerBot.address).to.eq(challengerAddress);
    });

});