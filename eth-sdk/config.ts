import { defineConfig } from "@dethcrypto/eth-sdk"

export default defineConfig({
    contracts: {
        mainnet: {
            bPool: "0x02ec2c01880a0673c76E12ebE6Ff3aAd0A8Da968",
            mBPT: "0xc079E4321ecDc2fD3447BF7db629E0C294FB7A10",
        },
    },
    rpc: {
        mainnet: "https://mainnet.infura.io/v3/a6daf77ef0ae4b60af39259e435a40fe",
        ropsten: "https://ropsten.infura.io/v3/62bdcedba8ba449d9a795ef6310e713c",
        // goerli: 'https://goerli.infura.io/v3/a6daf77ef0ae4b60af39259e435a40fe',
        // kovan: 'https://kovan.infura.io/v3/62bdcedba8ba449d9a795ef6310e713c',
        polygon: "https://rpc-mainnet.matic.quiknode.pro",
        // polygonMumbai:
        //   'https://rpc-mumbai.maticvigil.com/v1/9014a595065319bb6d40417c45281c2608a943c7',
    },
    etherscanKeys: {
        mainnet: "TXNXCG3T5MMAN4WSWICGNW5UEBJXRA7SFH",
    },
})
