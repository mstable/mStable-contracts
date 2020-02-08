contract("Masset", () => {
    beforeEach("create masset");

    describe("mint", () => {
        context("when the basket is healthy", () => {
            context("when the basket is under the limit", () => {});

            context("when the basket exceeds the limit", () => {});
        });

        context("when the basket is not healthy", () => {
            it("reverts");
        });
    });

    describe("mintTo", () => {
        context("when the basket is healthy", () => {
            context("when the basket is under the limit", () => {
                context("when the recipient is an EOA", () => {});

                context("when the recipient is a contract ", () => {});

                context("when the recipient is the zero address", () => {});
            });

            context("when the basket exceeds the limit", () => {});
        });

        context("when the basket is not healthy", () => {
            it("reverts");
        });
    });

    describe("redeem", () => {});

    describe("redeemTo", () => {});

    describe("completeRecol", () => {});
});
