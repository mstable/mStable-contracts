#!/bin/bash

################################# REQUIREMENTS ################################# 
# Flattened contract files must be present under `flat` folder.
# Slither must be installed
################################################################################

# To allow `ctrl + c` to exit from the script
trap "exit" INT

# Run flattener
./run-flattener.sh

# Create the folder if it not exist
mkdir -p ./slither/slither-report

# Loop each file present in `flat` folder and run slither on it
# Slither report of each file will be created under `slither-report` folder
for filename in ../_flat/*.sol; do
	
	name=${filename##*/}
  	slither $filename --print human-summary 2>&1 | sed 's/\x1B\[[0-9;]\+[A-Za-z]//g' | tee ./slither/slither-report/$name.log
   	slither $filename 2>&1 | sed 's/\x1B\[[0-9;]\+[A-Za-z]//g' | tee ./slither/slither-report/$name-default.log
done

# Run the default slither on all contracts
slither . 2>&1 | sed 's/\x1B\[[0-9;]\+[A-Za-z]//g' | tee ./slither-report/slither.log