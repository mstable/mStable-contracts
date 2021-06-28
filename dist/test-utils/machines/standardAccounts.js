"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StandardAccounts = void 0;
/**
 * @dev Standard accounts
 */
class StandardAccounts {
    async initAccounts(signers) {
        this.all = await Promise.all(signers.map(async (s) => ({
            signer: s,
            address: await s.getAddress(),
        })));
        [
            this.default,
            this.governor,
            this.other,
            this.dummy1,
            this.dummy2,
            this.dummy3,
            this.dummy4,
            this.fundManager,
            this.fundManager2,
            this.mockSavingsManager,
            this.mockInterestValidator,
            this.mockMasset,
        ] = this.all;
        return this;
    }
}
exports.StandardAccounts = StandardAccounts;
exports.default = StandardAccounts;
//# sourceMappingURL=standardAccounts.js.map