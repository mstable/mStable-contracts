pragma solidity ^0.5.12;

import { ArrayHelpers } from "./ArrayHelpers.sol";


/**
  * @title Dictionary
  * @dev Provides functionality for managing a Dictionary (mapping) of bytes to addresses
  */
library DictionaryBtoA {

    using ArrayHelpers for bytes32[];
    using DictionaryBtoA for Bytes32ToAddress;

    /** @dev Struct containing list of all keys, and their corresponding mapping */
    struct Bytes32ToAddress {
        bytes32[] keys;
        mapping(bytes32 => address) keysToValues;
    }

    /**
      * @dev Add a bytes > value entry to the Dictionary
      * @param self This is the struct reference on which to execute the addition
      * @param _key Bytes key to add
      * @param _value Value (address)
      */
    function add(Bytes32ToAddress storage self, bytes32 _key, address _value)
    internal {
        if (_value == address(0)) {
            remove(self, _key);
            return;
        }

        if (self.keysToValues[_key] == address(0)) {
            self.keys.push(_key);
        }

        self.keysToValues[_key] = _value;
    }

    /**
      * @dev Add many bytes > value entries to the Dictionary
      * @param self This is the struct reference on which to execute the addition
      * @param _keys Bytes keys to add
      * @param _values Values (addresses)
      */
    function addMany(Bytes32ToAddress storage self, bytes32[] memory _keys, address[] memory _values)
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
    function get(Bytes32ToAddress storage self, bytes32 _key)
    internal
    view
    returns (address) {
        return self.keysToValues[_key];
    }

    /**
      * @dev (Internal) Fetch all the values of this Dictionary
      * @param self This is the struct reference on which to execute the get
      * @return Address[] - All values of the dictionary
      */
    function values(Bytes32ToAddress storage self)
    internal
    view
    returns (address[] memory result) {
        result = new address[](self.keys.length);

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
    function contains(Bytes32ToAddress storage self, bytes32 _key)
    internal
    view
    returns (bool) {
        return self.keysToValues[_key] != address(0);
    }

    /**
      * @dev (Internal) Remove a particular key from a Dictionary
      * @param self This is the struct reference on which to execute the removal
      * @param _key Key to remove
      */
    function remove(Bytes32ToAddress storage self, bytes32 _key)
    internal {
        if(self.keysToValues[_key] != address(0)) {
            self.keys.removeOne(_key);
            delete self.keysToValues[_key];
        }
    }
}