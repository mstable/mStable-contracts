#!/bin/bash

################################# REQUIREMENTS ################################# 
# Flattened contract files must be present under `flat` folder.
# Securify2 must be installed as Docker image 
	# https://app.gitbook.com/@mstable/s/mstable-protocol/security-tools-1/security-tools 
################################################################################

# To allow `ctrl + c` to exit from the script
trap "exit" INT

# Run flattener
./run-flattener.sh

# Create the folder if it not exist
mkdir -p ./securify/securify-report

# Loop each file present in `flat` folder and run slither on it
# Slither report of each file will be created under `slither-report` folder
for filename in ../_flat/*.sol; do
	
	name=${filename##*/}
   	docker run -it -v $PWD/../_flat:/share securify /share/$name 2>&1 | sed 's/\x1B\[[0-9;]\+[A-Za-z]//g' | tee ./securify/securify-report/$name.log
done