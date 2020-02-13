const { ZEPPELIN_LOCATION } = require("../helper.js");
const { assertRevert } = require(ZEPPELIN_LOCATION + 'openzeppelin-solidity/test/helpers/assertRevert');

const Claimable = artifacts.require('Claimable');

function shouldBehaveLikeClaimable (accounts) {

  it('should have an owner', async function () {
    const owner = await claimable.owner();
    assert.isTrue(owner !== 0);
  });

  it('changes pendingOwner after transfer', async function () {
    const newOwner = accounts[1];
    await claimable.transferOwnership(newOwner);
    const pendingOwner = await claimable.pendingOwner();

    assert.isTrue(pendingOwner === newOwner);
  });

  it('should prevent to claimOwnership from no pendingOwner', async function () {
    await assertRevert(claimable.claimOwnership({ from: accounts[2] }));
  });

  it('should prevent non-owners from transfering', async function () {
    const other = accounts[2];
    const owner = await claimable.owner.call();

    assert.isTrue(owner !== other);
    await assertRevert(claimable.transferOwnership(other, { from: other }));
  });

  describe('after initiating a transfer', function () {
    let newOwner;

    beforeEach(async function () {
      newOwner = accounts[1];
      await claimable.transferOwnership(newOwner);
    });

    it('changes allow pending owner to claim ownership', async function () {
      await claimable.claimOwnership({ from: newOwner });
      const owner = await claimable.owner();

      assert.isTrue(owner === newOwner);
    });
  });
};

module.exports = { shouldBehaveLikeClaimable };
