import { expect } from "chai";
import { AgentB } from "../../../src/fasset-bots/AgentB";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { createTestAgentB, disableMccTraceManager } from "../../test-utils/helpers";
import { CollateralData, CollateralDataFactory, CollateralKind, POOL_TOKEN_DECIMALS } from "../../../src/fasset/CollateralData";
import { artifacts } from "../../../src/utils/artifacts";
import { CollateralClass } from "../../../src/fasset/AssetManagerTypes";
import { toBN } from "../../../src/utils/helpers";
import { TokenPrice } from "../../../src/state/TokenPrice";
import { AMGPrice } from "../../../src/state/CollateralPrice";

const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");

describe("Agent collateral data unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let ownerAddress: string;
    let agentB: AgentB;
    let collateralDataFactory: CollateralDataFactory;
    let class1CD: CollateralData;
    let poolCD: CollateralData;
    let agentPoolTokenCD: CollateralData;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        ownerAddress = accounts[3];
        agentB = await createTestAgentB(context, ownerAddress);
        const agentInfo = await context.assetManager.getAgentInfo(agentB.vaultAddress);
        const collateralPool = await CollateralPool.at(agentInfo.collateralPool);
        const collateralPoolToken = await CollateralPoolToken.at(await collateralPool.poolToken());
        const class1Collateral = await context.assetManager.getCollateralType(CollateralClass.CLASS1, agentInfo.class1CollateralToken);
        const poolCollateral = await context.assetManager.getCollateralType(CollateralClass.POOL, await collateralPool.wNat());
        collateralDataFactory = await CollateralDataFactory.create(await context.assetManager.getSettings());
        class1CD = await collateralDataFactory.class1(class1Collateral, agentB.vaultAddress);
        poolCD = await collateralDataFactory.pool(poolCollateral, collateralPool.address);
        agentPoolTokenCD = await collateralDataFactory.agentPoolTokens(poolCD, collateralPoolToken, agentB.vaultAddress);
    });


    it("Should get collateral 'kind'", async () => {
        agentB = await createTestAgentB(context, ownerAddress);
        expect(class1CD.kind()).to.eq(CollateralKind.CLASS1);
        expect(poolCD.kind()).to.eq(CollateralKind.POOL);
        expect(agentPoolTokenCD.kind()).to.eq(CollateralKind.AGENT_POOL_TOKENS);
        const invalidCollateral = {
            collateralClass: -1 as CollateralClass,
            token: "string",
            decimals: toBN(1),
            validUntil: toBN(1),
            directPricePair: false,
            assetFtsoSymbol: "string",
            tokenFtsoSymbol: "string",
            minCollateralRatioBIPS: toBN(1),
            ccbMinCollateralRatioBIPS: toBN(1),
            safetyMinCollateralRatioBIPS: toBN(1)
        };
        const invalidTP = new TokenPrice(toBN(1), toBN(1), toBN(1));
        const amgPRice = new AMGPrice(toBN(1), toBN(1), toBN(1));
        const invalidCD = new CollateralData(invalidCollateral, toBN(1), invalidTP, undefined, amgPRice);
        const fn = () => {
            return invalidCD.kind();
        };
        expect(fn).to.throw("Invalid collateral kind");
    });

    it("Should get collateral decimals", async () => {
        agentB = await createTestAgentB(context, ownerAddress);
        expect(class1CD.tokenDecimals()).to.eq(class1CD.collateral?.decimals);
        expect(poolCD.tokenDecimals()).to.eq(poolCD.collateral?.decimals);
        expect(agentPoolTokenCD.tokenDecimals()).to.eq(POOL_TOKEN_DECIMALS);
    });

});
