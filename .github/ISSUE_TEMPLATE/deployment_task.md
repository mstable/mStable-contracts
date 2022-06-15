---
name: Deployment
about: Description
issue: Issue LINK

---

## About
A clear and concise description including contracts and networks.[...]

## Checklist
The following tasks must be completed previous to the deployment.
- [ ] Development
- [ ] if upgraded, verify no collisions on storage layout
- [ ] Feature branch passed all CI requirements. 
- [ ] Unit Tests passed
- [ ] Fork Tests passed, (functional tests, integration tests, deployment tests, upgrade tests)
- [ ] Code Coverage passed at https://coveralls.io/ 
- [ ] Deployment hardhat tasks created.
    - [ ] Double check constructor arguments, initialize functions.
- [ ] Deployment 
  - [ ] Proposed upgrade to smart contract (write down encodeFunctionData)
  - [ ] Accept upgrade to smart contract 
- [ ] Verify Etherscan
- [ ] Request labels for Etherscan


## Artifacts 
**Contracts**
 - contracts/**
 
**Unit Tests**
 - test/**

**Fork Tests**
 - test-fork/**

**Tasks**
 - tasks/**
