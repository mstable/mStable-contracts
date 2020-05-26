TestMUSDTransferable = artifacts.require("TestMUSDTransferable");


    async function catchRevertThrowReturnFalse(promise) {
    try {
        const ret = await promise;
        assert.equal(balance.valueOf(), false, "Expected revert/throw/or return false");
    } catch (error) {
        // Not considered: 'out of gas', 'invalid JUMP'
        if (!error.message.includes("revert")){
            if (!error.message.includes("invalid opcode")){
                assert(false, "Expected revert/throw/or return false");
            }
        }
        return;
    }
};

async function catchRevertThrow(promise) {
    try {
        await promise;
    } catch (error) {
        // Not considered: 'out of gas', 'invalid JUMP'
        if (!error.message.includes("revert")){
            if (!error.message.includes("invalid opcode")){
                assert(false, "Expected revert/throw/or return false");
            }
        }
        return;
    }
    assert(false, "Expected revert/throw/or return false");
};
contract("TestMUSDTransferable", accounts => {
	let owner = "0x627306090abaB3A6e1400e9345bC60c78a8BEf57";
	let user = "0xf17f52151EbEF6C7334FAD080c5704D77216b732";
	let attacker = "0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef";
	it("The total supply is correctly initialized.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_user = await instance.init_total_supply.call({from: user});
		assert.equal(test_user, true, "Check the constructor of TestMUSDTransferable");
	});
	it("Owner's balance is correctly initialized.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_user = await instance.init_owner_balance.call({from: user});
		assert.equal(test_user, true, "Check the constructor of TestMUSDTransferable");
	});
	it("User's balance is correctly initialized.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_user = await instance.init_user_balance.call({from: user});
		assert.equal(test_user, true, "Check the constructor of TestMUSDTransferable");
	});
	it("Attacker's balance is correctly initialized.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_user = await instance.init_attacker_balance.call({from: user});
		assert.equal(test_user, true, "Check the constructor of TestMUSDTransferable");
	});
	it("All the users have a positive balance.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_owner = await instance.init_caller_balance.call({from: owner});
		assert.equal(test_owner, true, "Check the constructor of TestMUSDTransferable");
		let test_user = await instance.init_caller_balance.call({from: user});
		assert.equal(test_user, true, "Check the constructor of TestMUSDTransferable");
		let test_attacker = await instance.init_caller_balance.call({from: attacker});
		assert.equal(test_attacker, true, "Check the constructor of TestMUSDTransferable");
	});
	it("The total supply is the user and owner balance.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_user = await instance.init_total_supply_is_balances.call({from: user});
		assert.equal(test_user, true, "Check the constructor of TestMUSDTransferable");
	});
});
