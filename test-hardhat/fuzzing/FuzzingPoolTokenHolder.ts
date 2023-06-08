import { isPoolCollateral } from "../../src/state/CollateralIndexedList";
import { artifacts } from "../../src/utils/artifacts";
import { EventScope } from "../../src/utils/events/ScopedEvents";
import { requireNotNull } from "../../src/utils/helpers";
import { CollateralPoolInstance, CollateralPoolTokenInstance } from "../../typechain-truffle";
import { AsyncLock, formatBN, getLotSize, randomBN, randomChoice } from "../test-utils/fuzzing-utils";
import { FuzzingRunner } from "./FuzzingRunner";

const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');

enum TokenExitType { MAXIMIZE_FEE_WITHDRAWAL, MINIMIZE_FEE_DEBT, KEEP_RATIO }

interface PoolInfo {
    pool: CollateralPoolInstance;
    poolToken: CollateralPoolTokenInstance;
}

export class FuzzingPoolTokenHolder {
    constructor(
        public runner: FuzzingRunner,
        public address: string,
    ) { }

    lock = new AsyncLock();

    poolInfo?: PoolInfo;

    async enter(scope: EventScope) {
        await this.lock.run(async () => {
            if (!this.poolInfo) {
                const agent = randomChoice(Array.from(this.runner.commonTrackedState.agents.values()));
                const collateralPool = await CollateralPool.at(agent.collateralPoolAddress);
                const poolTokenAddress = await collateralPool.poolToken();
                const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
                this.poolInfo = {
                    pool: collateralPool,
                    poolToken: collateralPoolToken
                };
            }
            const natPrice = requireNotNull(this.runner.commonTrackedState.prices.collateralPrices.list.find(p => isPoolCollateral(p.collateral)));
            const lotSizeWei = natPrice.convertUBAToTokenWei(getLotSize(await this.runner.context.assetManager.getSettings()));
            const amount = randomBN(lotSizeWei.muln(3));
            this.runner.comment(`${this.runner.eventFormatter.formatAddress(this.address)}: entering pool ${this.runner.eventFormatter.formatAddress(this.poolInfo.pool.address)} (${formatBN(amount)})`);
            await this.poolInfo.pool.enter(0, false, { from: this.address, value: amount })
                .catch(e => scope.exitOnExpectedError(e, []));
        });
    }

    async exit(scope: EventScope, full: boolean) {
        await this.lock.run(async () => {
            if (!this.poolInfo) return;
            const balance = await this.poolInfo.poolToken.balanceOf(this.address);
            const amount = full ? balance : randomBN(balance);
            const exitAmount = amount.eq(balance) ? 'full' : `${formatBN(amount)} / ${formatBN(balance)}`;
            this.runner.comment(`${this.runner.eventFormatter.formatAddress(this.address)}: exiting pool ${this.runner.eventFormatter.formatAddress(this.poolInfo.pool.address)} (${exitAmount})`);
            await this.poolInfo.pool.exit(amount, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['collateral ratio falls below exitCR']));
            // if full exit was performed, we can later join different pool
            if (amount.eq(balance)) {
                this.poolInfo = undefined;
            }
        });
    }
}

