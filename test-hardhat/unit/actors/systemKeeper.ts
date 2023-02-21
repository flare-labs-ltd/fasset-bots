import { FilterQuery } from "@mikro-orm/core/typings";
import { expect } from "chai";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { ORM } from "../../../src/config/orm";
import { ActorEntity, ActorType } from "../../../src/entities/actor";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { TrackedState } from "../../../src/state/TrackedState";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestAssetContext } from "../../test-utils/test-asset-context";


describe("System keeper unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let systemKeeperAddress: string;
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
        systemKeeperAddress = accounts[10];
        runner = new ScopedRunner();
        state = new TrackedState();
    });

    it("Should create system keeper", async () => {
        const systemKeeper = await SystemKeeper.create(runner, orm.em, context, systemKeeperAddress, state);
        expect(systemKeeper.address).to.eq(systemKeeperAddress);
    });

    it("Should read system keeper from entity", async () => {
        const systemKeeperEnt = await orm.em.findOneOrFail(ActorEntity, { address: systemKeeperAddress, type: ActorType.SYSTEM_KEEPER } as FilterQuery<ActorEntity>);
        const systemKeeper = await SystemKeeper.fromEntity(runner, context, systemKeeperEnt, state);
        expect(systemKeeper.address).to.eq(systemKeeperAddress);
    });

});