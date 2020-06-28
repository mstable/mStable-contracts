#!/bin/bash

# To allow `ctrl + c` to exit from the script
trap "exit" INT

# Run sol-merger on all contracts. The command needs all contracts
../node_modules/sol-merger/dist/bin/sol-merger.js "../contracts/**/*.sol" ../_flat

MOCK='Mock'

# Loop each file present in `flat` folder
for filename in ../_flat/*.sol; do
	
	name=${filename##*/}

	# Remove any file which contains "Mock" in filename
	if [[ "$name" == *"$MOCK"* ]]; then		
    	rm $filename
    fi
done
