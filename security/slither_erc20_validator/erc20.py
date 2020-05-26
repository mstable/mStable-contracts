#!/usr/bin/env python3
import sys
import collections
from slither.slither import Slither
from slither.slithir.operations.event_call import EventCall
from slither.slithir.operations.index import Index as IndexOperation
from slither.slithir.operations.binary import Binary as BinaryOperation
from slither.slithir.operations.solidity_call import SolidityCall as SolidityCallOperation
from slither.solc_parsing.variables.state_variable import StateVariableSolc
from slither.core.solidity_types.mapping_type import MappingType
from constants import (
    ERC20_EVENT_SIGNATURES,
    ERC20_FX_SIGNATURES,
    ERC20_GETTERS,
    ERC20_EVENT_BY_FX,
    ALLOWANCE_FRONTRUN_FX_SIGNATURES,
    ALLOWANCE_FRONTRUN_EVENT_BY_FX
)
from log import (
    log_matches,
    log_event_per_function,
    log_modifiers_per_function,
    log_approve_checking_balance
)


def is_visible(function):
    """Check if function's visibility is external or public"""
    return is_public(function) or is_external(function)


def is_external(function):
    """Check if function's visibility is external"""
    return function.visibility == "external"


def is_public(element):
    """Check if element's (Function or Event) visibility is public"""
    return element.visibility == "public"

def is_interface(contract):
    """Check if contract is interface"""
    return contract.contract_kind == "interface"


def verify_signatures(elements, expected_signatures):
    """
    Compares a list of elements (functions or events) and expected signatures.
    Returns a list of tuples containing (Signature, matching object or None)
    """
    return [(sig, sig.find_match(elements)) for sig in expected_signatures]


def verify_getters(state_variables, functions, expected_getters):
    """
    Checks whether a list of getters is present
    either as public state variables or as visible functions.

    Parameters
    ----------
    state_variables : list

    functions : list(slither.core.declarations.Function)

    expected_getters : list(Signature)

    Returns
    -------
    generator : containing tuples (Signature, bool)
    """
    for getter in expected_getters:
        # Check in state variables. If none is found, check in functions.
        if (
            any(name_and_return_match(v, getter) and is_public(v) for v in state_variables) or
            getter.find_match(functions)
        ):
            yield (getter, True)
        else:
            yield (getter, False)


def verify_event_calls(erc20_fx_matches, events_by_function):
    """
    Checks if functions found emit the expected given events

    Parameters
    ----------
    erc20_fx_matches : list
        List of tuples (Signature, slither.core.declarations.Function or None)

    events_by_function: dict
        Dict containing function's name as key,
        and event's Signature as value (i.e. {function_name: Signature})
    Returns
    -------
    generator
        Generator of tuples (Signature, bool)
    """
    for match in erc20_fx_matches:
        # Check if function was found and function is expected to emit event
        function = match[1]
        if function and events_by_function[match[0].name]:
            yield (match[0], emits_event(function, events_by_function[function.name]))


def verify_custom_modifiers(erc20_fx_matches):
    """
    Checks if ERC20 functions found have any custom modifier

    Parameters
    ----------
    erc20_fx_matches : list
        List of tuples (Signature, slither.core.declarations.Function or None)

    Returns
    -------
    generator
        Generator of tuples (Signature, list(slither.core.declarations.Modifier))
    """
    for match in erc20_fx_matches:
        # Check whether function was found and has modifiers
        function = match[1]
        if function and function.modifiers:
            yield (match[0], function.modifiers)           


def name_and_return_match(variable, signature):
    """
    Checks that a variable's name and type match a signature
    
    Parameters
    ----------
    variable: slither.solc_parsing.variables.state_variable.StateVariableSolc

    signature : Signature

    Returns
    -------
    bool
    """
    return (variable.name == signature.name and
            str(variable.type) == signature.returns[0])


def get_visible_functions(functions):
    """
    Filters a list of functions, keeping the visible ones

    Parameters
    ----------
    functions : list(slither.core.declarations.Function)

    Returns
    -------
    list(slither.core.declarations.Function)
    """
    return [f for f in functions if is_visible(f)]


def get_implemented_functions(functions):
    """
    Filters a list of functions, keeping those whose declaring contract is NOT an interface

    Parameters
    ----------
    functions : list(slither.core.declarations.Function)

    Returns
    -------
    list(slither.core.declarations.Function)
    """
    return [f for f in functions if not is_interface(f.contract_declarer)]


def is_event_call(obj):
    """Returns True if given object is an instance of Slither's EventCall class. False otherwise."""
    return isinstance(obj, EventCall)


def get_events(function):
    """
    Get a generator to iterate over the events emitted by a function

    Parameters
    ----------
    function : slither.core.declarations.Function

    Returns
    -------
    generator
    """
    for node in getattr(function, 'nodes', []):
        for ir in node.irs:
            if is_event_call(ir):
                yield ir


def emits_event(function, expected_event):
    """
    Recursively check whether a function emits an event
    
    Parameters
    ----------
    function : slither.core.declarations.Function

    expected_event : Signature

    Returns
    -------
    bool
    """
    for event in get_events(function):
        if (
            event.name == expected_event.name and 
            all(str(arg.type) == expected_event.args[i] for i, arg in enumerate(event.arguments))
        ):
            return True

    # Event is not fired in function, so check internal calls to other functions
    if any(emits_event(f, expected_event) for f in getattr(function, 'internal_calls', [])):
        return True

    # Event is not fired in function nor in internal calls
    return False


def local_var_is_sender(local_variable):
    """
    Returns True if the passed local variable's value is the msg.sender address,
    recursively checking for previous assignments. Returns False otherwise.

    Parameters
    ----------
    local_variable : slither.core.declarations.solidity_variables.SolidityVariableComposed

    Returns
    -------
    bool
    """
    
    if local_variable.name == 'msg.sender':
        return True
    else:
        try:
            # Recursively check for msg.sender assignment
            return local_var_is_sender(local_variable.expression.value)
        except AttributeError:
            return False


def checks_sender_balance_in_require(node):
    """
    Verifies if a state mapping is being accessed with msg.sender index
    inside a require statement and compared to another value, in the given node.
    Returns True if it finds such operation. False otherwise.

    Parameters
    ----------
    node : slither.solc_parsing.cfg.node.NodeSolc

    Returns
    -------
    bool
    """
    # First check we're in a require clause
    if any(call.name == 'require(bool)' for call in node.internal_calls):

        # Now check that the operations done in the node are the expected
        expected_operations = {IndexOperation, BinaryOperation, SolidityCallOperation}
        if len(node.irs) == len(expected_operations) and {type(ir) for ir in node.irs} == expected_operations:
            for ir in node.irs:
                # Verify that a state mapping is being accessed with msg.sender index
                if isinstance(ir, IndexOperation):
                    reading_mapping_in_state = (
                        isinstance(ir.variable_left, StateVariableSolc) and
                        isinstance(ir.variable_left.type, MappingType)
                    )
                    index_is_sender = local_var_is_sender(ir.variable_right)
                    if reading_mapping_in_state and index_is_sender:
                        return True                

    return False


def run(filename, contract_name):
    """Executes script"""

    # Init Slither
    slither = Slither(filename)

    # Get an instance of the contract to be analyzed
    contract = slither.get_contract_from_name(contract_name)
    if not contract:
        print(f"Contract {contract_name} not found")
        print("Either you mispelled the contract's name or solc cannot compile the contract.")
        exit(-1)

    # Obtain all visible functions, filtering out any that comes from an interface contract
    visible_functions = get_visible_functions(
        get_implemented_functions(contract.functions)
    )

    erc20_fx_matches = verify_signatures(visible_functions, ERC20_FX_SIGNATURES)

    print("== ERC20 functions definition ==")
    log_matches(erc20_fx_matches)

    print("\n== Custom modifiers ==")
    log_modifiers_per_function(
        verify_custom_modifiers(erc20_fx_matches)
    )

    print("\n== ERC20 events ==")
    log_matches(
        verify_signatures(contract.events, ERC20_EVENT_SIGNATURES),
        log_return=False
    )
    log_event_per_function(
        verify_event_calls(erc20_fx_matches, ERC20_EVENT_BY_FX),
        ERC20_EVENT_BY_FX
    )

    print("\n== ERC20 getters ==")
    log_matches(
        verify_getters(
            contract.state_variables,
            visible_functions,
            ERC20_GETTERS
        )
    )

    print("\n== Allowance frontrunning mitigation ==")
    frontrun_fx_matches = verify_signatures(visible_functions, ALLOWANCE_FRONTRUN_FX_SIGNATURES)
    log_matches(frontrun_fx_matches)
    log_event_per_function(
        verify_event_calls(frontrun_fx_matches, ALLOWANCE_FRONTRUN_EVENT_BY_FX),
        ALLOWANCE_FRONTRUN_EVENT_BY_FX,
        must=False
    )

    
    print("\n== Balance check in approve function ==")
    approve_signature = ERC20_FX_SIGNATURES[1].to_string(with_return=False, with_spaces=False)
    approve_function = contract.get_function_from_signature(approve_signature)
    is_checking_balance = any(checks_sender_balance_in_require(node) for node in approve_function.nodes)
    log_approve_checking_balance(is_checking_balance)        


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print('Usage: python erc20.py <contract.sol> <contract-name>')
        exit(-1)

    FILE_NAME = sys.argv[1]
    CONTRACT_NAME = sys.argv[2]

    run(FILE_NAME, CONTRACT_NAME)
