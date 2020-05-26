from signature import Signature

ERC20_FX_SIGNATURES = [
    Signature("transfer", ["address", "uint256"], ["bool"]),
    Signature("approve", ["address", "uint256"], ["bool"]),
    Signature("transferFrom", ["address", "address", "uint256"], ["bool"]),
    Signature("allowance", ["address", "address"], ["uint256"]),
    Signature("balanceOf", ["address"], ["uint256"]),
]

ALLOWANCE_FRONTRUN_FX_SIGNATURES = [
    Signature("increaseAllowance", ["address", "uint256"], ["bool"]),
    Signature("decreaseAllowance", ["address", "uint256"], ["bool"]),
]

ERC20_EVENT_SIGNATURES = [
    Signature("Transfer", ["address", "address", "uint256"]),
    Signature("Approval", ["address", "address", "uint256"]),
]

ERC20_GETTERS = [
    Signature("totalSupply", [], ["uint256"]),
    Signature("decimals", [], ["uint8"]),
    Signature("symbol", [], ["string"]),
    Signature("name", [], ["string"]),
]

ERC20_EVENT_BY_FX = {
    "transfer": ERC20_EVENT_SIGNATURES[0],
    "approve": ERC20_EVENT_SIGNATURES[1],
    "transferFrom": ERC20_EVENT_SIGNATURES[0],
    "allowance": {},
    "balanceOf": {},
}

ALLOWANCE_FRONTRUN_EVENT_BY_FX = {
    "increaseAllowance": ERC20_EVENT_SIGNATURES[1], 
    "decreaseAllowance": ERC20_EVENT_SIGNATURES[1],
}
