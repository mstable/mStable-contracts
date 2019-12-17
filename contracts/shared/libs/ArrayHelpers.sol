pragma solidity ^0.5.12;

/**
  * @title ArrayHelpers
  * @dev Provides base functionality to manage the adding and removal of items from an array
  */
library ArrayHelpers {

    /**
      * @dev Iterates over and removes a single address from an address[]
      * @param _data Array on which to execute the removal
      * @param _value Value to remove from the array
      */
    function removeOne(address[] storage _data, address _value) internal {
        for(uint i = 0; i < _data.length; i++) {
            if (_data[i] == _value) {
                _data[i] = _data[_data.length - 1];
                _data.length--;
                return;
            }
        }
    }


    /**
      * @dev Checks if a particular value is in an array
      * @param _array Array of addresses to search through
      * @param _value Address to look for
      * @return bool to signal that the value is in the array
      */
    function arrayContainsValue(address[] memory _array, address _value)
    public
    pure
    returns (bool) {
        uint256 arrayLength = _array.length;
        for (uint256 i = 0; i < arrayLength; i++) {
            if (_value == _array[i]) {
                return true;
            }
        }
        return false;
    }

    /**
      * @dev Iterates over and removes a single bytes32 from a bytes32[]
      * @param _data Array on which to execute the removal
      * @param _value Value to remove from the array
      */
    function removeOne(bytes32[] storage _data, bytes32 _value) internal {
        for(uint i = 0; i < _data.length; i++) {
            if (_data[i] == _value) {
                _data[i] = _data[_data.length - 1];
                _data.length--;
                return;
            }
        }
    }
}