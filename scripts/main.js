const [scriptName, ...args] = process.argv.slice(4);

// Import TypeScript; it can't be run directly, but Truffle must use
// babel because requiring it works.
const script = require(`./src/${scriptName}.ts`).default;

// Bind the first argument of the script to the global truffle argument,
// with `web3`, `artifacts` and so on, and pass in all CLI arguments.
module.exports = (callback) => {
    script(this, ...args)
        .then(callback)
        .catch(callback);
};
