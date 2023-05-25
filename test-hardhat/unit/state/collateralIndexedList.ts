import { expect } from "chai";
import { CollateralIndexedList, CollateralTypeId, collateralTokensEqual, isClass1Collateral, isPoolCollateral } from "../../../src/state/CollateralIndexedList";
import { CollateralClass, CollateralType } from "../../../src/fasset/AssetManagerTypes";
import { toBIPS } from "../../../src/utils/helpers";


describe("Collateral indexed list unit tests", async () => {
    const elt0 = { collateralClass: CollateralClass.POOL, token: "token0" };
    const elt1 = { collateralClass: CollateralClass.CLASS1, token: "token1" };
    const elt2 = { collateralClass: CollateralClass.CLASS1, token: "token2" };

    function createIndexList() {
        const indexedList: CollateralIndexedList<CollateralTypeId> = new CollateralIndexedList();
        indexedList.set(elt0, elt0);
        indexedList.set(elt1, elt1);
        indexedList.set(elt2, elt2);
        return indexedList;
    }

    it("Should create collateral indexed list", async () => {
        const indexedList = createIndexList();
        expect(indexedList).to.not.be.null;
        expect(indexedList.list).to.not.be.null;
        expect(indexedList.index).to.not.be.null;
        expect(indexedList.list[0].collateralClass).to.eq(elt0.collateralClass);
        expect(indexedList.list[1].collateralClass).to.eq(elt1.collateralClass);
        expect(indexedList.list[2].collateralClass).to.eq(elt2.collateralClass);
        expect(indexedList.list[0].collateralClass).to.eq(elt0.collateralClass);
        expect(indexedList.list[1].collateralClass).to.eq(elt1.collateralClass);
        expect(indexedList.list[2].collateralClass).to.eq(elt2.collateralClass);
        indexedList.set(elt0, elt1);
        expect(indexedList.list[0].collateralClass).to.eq(elt1.collateralClass);
    });

    it("Should get elements of collateral indexed list", async () => {
        const indexedList = createIndexList();
        expect(indexedList).to.not.be.null;
        expect(indexedList.list).to.not.be.null;
        expect(indexedList.index).to.not.be.null;

        expect(indexedList.get(elt0).collateralClass).to.eq(elt0.collateralClass);
        expect(indexedList.get(elt0.collateralClass, elt0.token).collateralClass).to.eq(elt0.collateralClass);
        const fn0 = () => {
            return indexedList.get({ collateralClass: "tokenClass100", token: "token100" });
        };
        expect(fn0).to.throw(`Value is null or undefined`);
        const fn1 = () => {
            return indexedList.get("tokenClass100", "token100");
        };
        expect(fn1).to.throw(`Value is null or undefined`);

        expect(indexedList.getOptional(elt0)?.collateralClass).to.eq(elt0.collateralClass);
        expect(indexedList.getOptional(elt0.collateralClass, elt0.token)?.collateralClass).to.eq(elt0.collateralClass);

        expect(indexedList.getOptional({ collateralClass: "tokenClass100", token: "token100" })).to.be.undefined;
        expect(indexedList.getOptional("tokenClass100", "token100")).to.be.undefined;
    });

    it("Should iterate through collateral indexed list", async () => {
        const indexedList = createIndexList();
        expect(indexedList).to.not.be.null;
        expect(indexedList.list).to.not.be.null;
        expect(indexedList.index).to.not.be.null;

        for (const item of indexedList) {
            if(item.token === elt0.token) {
                expect(item.collateralClass).to.eq(elt0.collateralClass);
            }
            if(item.token === elt1.token) {
                expect(item.collateralClass).to.eq(elt1.collateralClass);
            }
            if(item.token === elt2.token) {
                expect(item.collateralClass).to.eq(elt2.collateralClass);
            }
        }
    });

    it("Should compare collateral tokens", async () => {
        const indexedList = createIndexList();
        expect(indexedList).to.not.be.null;
        expect(indexedList.list).to.not.be.null;
        expect(indexedList.index).to.not.be.null;

        expect(collateralTokensEqual(elt0, elt1)).to.be.false;
        expect(collateralTokensEqual(elt0, elt0)).to.be.true;
    });

    it("Should check class collateral", async () => {
        const poolCollateral: CollateralType = {
            collateralClass: CollateralClass.POOL,
            token: "address",
            decimals: 18,
            validUntil: 0,  // not deprecated
            directPricePair: false,
            assetFtsoSymbol: "symbol",
            tokenFtsoSymbol: "NAT",
            minCollateralRatioBIPS: toBIPS(2.2),
            ccbMinCollateralRatioBIPS: toBIPS(1.9),
            safetyMinCollateralRatioBIPS: toBIPS(2.3),
        };
        const usdcCollateral: CollateralType = {
            collateralClass: CollateralClass.CLASS1,
            token: "address",
            decimals: 18,
            validUntil: 0,  // not deprecated
            directPricePair: false,
            assetFtsoSymbol: "symbol",
            tokenFtsoSymbol: "USDC",
            minCollateralRatioBIPS: toBIPS(1.4),
            ccbMinCollateralRatioBIPS: toBIPS(1.3),
            safetyMinCollateralRatioBIPS: toBIPS(1.5),
        };

        expect(isPoolCollateral(poolCollateral)).to.be.true;
        expect(isClass1Collateral(usdcCollateral)).to.be.true;
    });

});
