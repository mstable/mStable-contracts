const { constants, expectEvent, shouldFail } = require('openzeppelin-test-helpers');
const { ZERO_ADDRESS } = constants;

function shouldBehaveLikeGovernble (instance, owner, [other]) {
  describe('as an Governable', async function () {
    it('should have a Governor', async function () {
      console.log("111");
      console.log(instance);
      const gov = await instance.governor();
      console.log("ddddd: " + gov);
      (await instance.governor()).should.equal(owner);
    });

    it('changes governor after transfer', async function () {
      (await instance.isGovernor({ from: other })).should.be.equal(false);
      const { logs } = await instance.changeGovernor(other, { from: owner });
      expectEvent.inLogs(logs, 'GovernorChanged');

      (await instance.owner()).should.equal(other);
      (await instance.isOwner({ from: other })).should.be.equal(true);
    });

    it('should prevent non-governor from changing governor', async function () {
      await shouldFail.reverting.withMessage(
        instance.changeGovernor(other, { from: other }),
        'Governable: caller is not the Governor'
      );
    });

    it('should guard ownership against stuck state', async function () {
      await shouldFail.reverting.withMessage(
        instance.changeGovernor(ZERO_ADDRESS, { from: owner }),
        'Governable: new Governor is the zero address'
      );
    });
  });
}

module.exports = {
  shouldBehaveLikeGovernble,
};
