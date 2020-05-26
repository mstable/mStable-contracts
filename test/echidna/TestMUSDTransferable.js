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
	it("The address 0x0 should not receive tokens.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_user = await instance.echidna_zero_always_empty_ERC20Properties.call({from: user});
		assert.equal(test_user, true);
	});
	it("Allowance can be changed.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_owner = await instance.echidna_approve_overwrites.call({from: owner});
		assert.equal(test_owner, true);
		let test_user = await instance.echidna_approve_overwrites.call({from: user});
		assert.equal(test_user, true);
		let test_attacker = await instance.echidna_approve_overwrites.call({from: attacker});
		assert.equal(test_attacker, true);
	});
	it("Balance of one user must be less or equal to the total supply.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_owner = await instance.echidna_less_than_total_ERC20Properties.call({from: owner});
		assert.equal(test_owner, true);
		let test_user = await instance.echidna_less_than_total_ERC20Properties.call({from: user});
		assert.equal(test_user, true);
		let test_attacker = await instance.echidna_less_than_total_ERC20Properties.call({from: attacker});
		assert.equal(test_attacker, true);
	});
	it("Balance of the Echidna users must be less or equal to the total supply.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_user = await instance.echidna_totalSupply_consistant_ERC20Properties.call({from: user});
		assert.equal(test_user, true);
	});
	it("No one should be able to send tokens to the address 0x0 (transfer).", async () => {
		let instance = await TestMUSDTransferable.deployed();
		await catchRevertThrowReturnFalse(instance.echidna_revert_transfer_to_zero_ERC20PropertiesTransferable.call({from: owner}));
		await catchRevertThrowReturnFalse(instance.echidna_revert_transfer_to_zero_ERC20PropertiesTransferable.call({from: user}));
		await catchRevertThrowReturnFalse(instance.echidna_revert_transfer_to_zero_ERC20PropertiesTransferable.call({from: attacker}));
	});
	it("No one should be able to send tokens to the address 0x0 (transferFrom).", async () => {
		let instance = await TestMUSDTransferable.deployed();
		await catchRevertThrowReturnFalse(instance.echidna_revert_transferFrom_to_zero_ERC20PropertiesTransferable.call({from: owner}));
		await catchRevertThrowReturnFalse(instance.echidna_revert_transferFrom_to_zero_ERC20PropertiesTransferable.call({from: user}));
		await catchRevertThrowReturnFalse(instance.echidna_revert_transferFrom_to_zero_ERC20PropertiesTransferable.call({from: attacker}));
	});
	it("Self transferFrom works.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_owner = await instance.echidna_self_transferFrom_ERC20PropertiesTransferable.call({from: owner});
		assert.equal(test_owner, true);
		let test_user = await instance.echidna_self_transferFrom_ERC20PropertiesTransferable.call({from: user});
		assert.equal(test_user, true);
		let test_attacker = await instance.echidna_self_transferFrom_ERC20PropertiesTransferable.call({from: attacker});
		assert.equal(test_attacker, true);
	});
	it("transferFrom works.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_owner = await instance.echidna_self_transferFrom_to_other_ERC20PropertiesTransferable.call({from: owner});
		assert.equal(test_owner, true);
		let test_user = await instance.echidna_self_transferFrom_to_other_ERC20PropertiesTransferable.call({from: user});
		assert.equal(test_user, true);
		let test_attacker = await instance.echidna_self_transferFrom_to_other_ERC20PropertiesTransferable.call({from: attacker});
		assert.equal(test_attacker, true);
	});
	it("Self transfer works.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_owner = await instance.echidna_self_transfer_ERC20PropertiesTransferable.call({from: owner});
		assert.equal(test_owner, true);
		let test_user = await instance.echidna_self_transfer_ERC20PropertiesTransferable.call({from: user});
		assert.equal(test_user, true);
		let test_attacker = await instance.echidna_self_transfer_ERC20PropertiesTransferable.call({from: attacker});
		assert.equal(test_attacker, true);
	});
	it("transfer works.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		let test_owner = await instance.echidna_transfer_to_other_ERC20PropertiesTransferable.call({from: owner});
		assert.equal(test_owner, true);
		let test_user = await instance.echidna_transfer_to_other_ERC20PropertiesTransferable.call({from: user});
		assert.equal(test_user, true);
		let test_attacker = await instance.echidna_transfer_to_other_ERC20PropertiesTransferable.call({from: attacker});
		assert.equal(test_attacker, true);
	});
	it("Cannot transfer more than the balance.", async () => {
		let instance = await TestMUSDTransferable.deployed();
		await catchRevertThrowReturnFalse(instance.echidna_revert_transfer_to_user_ERC20PropertiesTransferable.call({from: owner}));
		await catchRevertThrowReturnFalse(instance.echidna_revert_transfer_to_user_ERC20PropertiesTransferable.call({from: user}));
		await catchRevertThrowReturnFalse(instance.echidna_revert_transfer_to_user_ERC20PropertiesTransferable.call({from: attacker}));
	});
});
