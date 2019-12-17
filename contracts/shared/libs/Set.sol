pragma solidity ^0.5.12;


/**
  * @title Set
  * @dev Basic library to manage a simple set of Bytes32 or Address values
  */
library Set {

  /** @dev Struct containing array of Bytes32 values, and a mapping to quickly check if key exists */
    struct Bytes32 {
        bytes32[] values;
        mapping(bytes32 => bool) has;
    }

    /**
      * @dev Add a bytes entry to the array
      * @param self This is the struct reference on which to execute the addition
      * @param _value Value (bytes32)
      */
    function add(Bytes32 storage self, bytes32 _value) internal {
        if (self.has[_value]) {return;}
        self.has[_value] = true;
        self.values.push(_value);
    }

    /**
      * @dev Remove a bytes entry to the array
      * @param self This is the struct reference on which to execute the removal
      * @param _value Value (bytes32)
      */
    function remove(Bytes32 storage self, bytes32 _value) internal {
        if (!self.has[_value]) {return;}
        delete self.has[_value];
        for(uint i = 0; i < self.values.length; i++) {
            if (self.values[i] == _value) {
                self.values[i] = self.values[self.values.length - 1];
                self.values.length--;
            }
        }
    }

    /** @dev Struct containing array of Address values, and a mapping to quickly check if key exists */
    struct Address {
        address[] values;
        mapping(address => bool) has;
    }

    /**
      * @dev Add an address entry to the array
      * @param self This is the struct reference on which to execute the addition
      * @param _value Value (address)
      */
    function add(Address storage self, address _value) internal {
        if (self.has[_value]) {return;}
        self.has[_value] = true;
        self.values.push(_value);
    }

    /**
      * @dev Remove an address entry from the array
      * @param self This is the struct reference on which to execute the removal
      * @param _value Value (address)
      */
    function remove(Address storage self, address _value) internal {
        if (!self.has[_value]) {return;}
        delete self.has[_value];
        for(uint i = 0; i < self.values.length; i++) {
            if (self.values[i] == _value) {
                self.values[i] = self.values[self.values.length - 1];
                self.values.length--;
            }
        }
    }
}
