#!/bin/bash

################################# REQUIREMENTS ################################# 
# Flattened contract files must be present under `flat` folder.
# Slither must be installed
################################################################################

# To allow `ctrl + c` to exit from the script
trap "exit" INT

# Create the folder if it not exist
mkdir -p slither-report

MOCK='Mock'

# Loop each file present in `flat` folder and run slither on it
# Slither report of each file will be created under `slither-report` folder
for filename in ../flat/*.sol; do
	
	name=${filename##*/}

	if [[ "$name" != *"$MOCK"* ]]; then		
    	slither $filename --print human-summary 2>&1 | tee slither-report/$name.log
    fi
done

# Run the default slither on all contracts
slither .. 2>&1 | tee slither-report/slither.log