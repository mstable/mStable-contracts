pragma solidity ^0.5.12;

import { ArrayHelpers } from "./ArrayHelpers.sol";


/**
  * @title DictionaryAtoB
  * @dev Provides functionality for managing a Dictionary (mapping) of bytes to addresses
  */
library DictionaryAtoB {

    using ArrayHelpers for address[];
    using DictionaryAtoB for AddressToBytes32;

    /** @dev Struct containing list of all keys, and their corresponding mapping */
    struct AddressToBytes32 {
        address[] keys;
        mapping(address => bytes32) keysToValues;
    }

    /**
      * @dev Add a address > value entry to the Dictionary
      * @param self This is the struct reference on which to execute the addition
      * @param _key Address key to add
      * @param _value Value (address)
      */
    function add(AddressToBytes32 storage self, address _key, bytes32 _value)
    internal {
        if (_value == bytes32(0x0)) {
            remove(self, _key);
            return;
        }

        if (self.keysToValues[_key] == bytes32(0x0)) {
            self.keys.push(_key);
        }

        self.keysToValues[_key] = _value;
    }

    /**
      * @dev Add many address > value entries to the Dictionary
      * @param self This is the struct reference on which to execute the addition
      * @param _keys Addr keys to add
      * @param _values Values (bytes32)
      */
    function addMany(AddressToBytes32 storage self, address[] memory _keys, bytes32[] memory _values)
    internal {
        uint256 keyLen = _keys.length;
        uint256 valLen = _values.length;
        require(keyLen == valLen, "Arrays must be same length");
        require(keyLen > 0, "Array must contain some value");

        for(uint256 i = 0; i < keyLen; i++){
            self.add(_keys[i], _values[i]);
        }
    }

    /**
      * @dev (Internal) Fetch the value of a given key
      * @param self This is the struct reference on which to execute the get
      * @param _key Key for which to retrieve value
      * @return Value of the Dictionary entry
      */
    function get(AddressToBytes32 storage self, address _key)
    internal
    view
    returns (bytes32) {
        return self.keysToValues[_key];
    }

    /**
      * @dev (Internal) Fetch all the values of this Dictionary
      * @param self This is the struct reference on which to execute the get
      * @return Address[] - All values of the dictionary
      */
    function values(AddressToBytes32 storage self)
    internal
    view
    returns (bytes32[] memory result) {
        result = new bytes32[](self.keys.length);

        for(uint256 i = 0; i < result.length; i++) {
            result[i] = self.keysToValues[self.keys[i]];
        }

        return result;
    }

    /**
      * @dev (Internal) Does this dictionary contain a specific key?
      * @param self This is the struct reference on which to execute the check
      * @param _key Key for which to check presence
      * @return bool - This key exists
      */
    function contains(AddressToBytes32 storage self, address _key)
    internal
    view
    returns (bool) {
        return self.keysToValues[_key] != bytes32(0x0);
    }

    /**
      * @dev (Internal) Remove a particular key from a Dictionary
      * @param self This is the struct reference on which to execute the removal
      * @param _key Key to remove
      */
    function remove(AddressToBytes32 storage self, address _key)
    internal {
        if(self.keysToValues[_key] != bytes32(0x0)) {
            self.keys.removeOne(_key);
            delete self.keysToValues[_key];
        }
    }
}