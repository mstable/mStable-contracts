#!/bin/bash

################################# REQUIREMENTS ################################# 
# sol-merger must be installed
################################################################################


# To allow `ctrl + c` to exit from the script
trap "exit" INT

# Run sol-merger on all contracts. The command needs all contracts
sol-merger "contracts/**/*.sol" ./flat

MOCK='Mock'

# Loop each file present in `flat` folder
for filename in ./flat/*.sol; do
	
	name=${filename##*/}

	# Remove any file which contains "Mock" in filename
	if [[ "$name" == *"$MOCK"* ]]; then		
    	rm $filename
    fi
done
