import { expect } from "chai";
import { CollateralIndexedList, CollateralTypeId } from "../../../src/state/CollateralIndexedList";


describe("Collateral indexed list unit tests", async () => {
    const elt0 = { collateralClass: "collateralClass0", token: "token0" };
    const elt1 = { collateralClass: "tokenClass1", token: "token1" };
    const elt2 = { collateralClass: "tokenClass2", token: "token2" };

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
        expect(indexedList.list[3].collateralClass).to.eq(elt1.collateralClass);
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

});
