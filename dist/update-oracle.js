"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
exports.updateOraclePrices = updateOraclePrices;
exports.getUnderlyingPrice = getUnderlyingPrice;
exports.getAssetPrice = getAssetPrice;
const ethers_1 = require("ethers");
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const AWS = __importStar(require("aws-sdk"));
// Load environment variables from .env file
dotenv_1.default.config();
// Oracle contract ABI (simplified to just what we need)
const ORACLE_ABI = [
    {
        inputs: [
            { internalType: "bytes[]", name: "priceUpdateData", type: "bytes[]" },
        ],
        name: "updatePythPrices",
        outputs: [],
        stateMutability: "payable",
        type: "function",
    },
    {
        inputs: [],
        name: "pyth",
        outputs: [{ internalType: "contract IPyth", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ internalType: "address", name: "cToken", type: "address" }],
        name: "getUnderlyingPrice",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ internalType: "address", name: "asset", type: "address" }],
        name: "assetPrices",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
];
// Pyth ABI for getUpdateFee
const PYTH_ABI = [
    {
        inputs: [{ internalType: "bytes[]", name: "data", type: "bytes[]" }],
        name: "getUpdateFee",
        outputs: [{ internalType: "uint256", name: "updateFee", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
];
// Configuration - Update these values with your actual deployment
const ORACLE_ADDRESS = "0xdefE2f4D1Bf069C7167f9b093F2ee9f01D557812"; // Your deployed SimplePriceOracle address
const PRIVATE_KEY = process.env.PRIVATE_KEY_TEST; // Load from environment variable
const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc"; // Arbitrum Sepolia RPC URL
const UPDATE_INTERVAL_MS = 45000; // 45 seconds
// Price Feed IDs
const ETH_USD_PRICE_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const USDC_USD_PRICE_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
// Helper function to format errors safely
function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
// Schedule next invocation
async function scheduleNextInvocation() {
    try {
        const lambda = new AWS.Lambda();
        await lambda
            .invoke({
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME || "pythOracleUpdater",
            InvocationType: "Event", // async invocation
            Payload: JSON.stringify({}),
        })
            .promise();
        console.log(`Scheduled next execution in ${UPDATE_INTERVAL_MS / 1000} seconds`);
    }
    catch (error) {
        console.error("Failed to schedule next execution:", error);
    }
}
async function updateOraclePrices() {
    try {
        console.log("Starting price update process...");
        console.log("Lambda execution environment initialized");
        console.log("RPC URL:", RPC_URL);
        console.log("Oracle Address:", ORACLE_ADDRESS);
        // Check if private key exists
        if (!PRIVATE_KEY) {
            throw new Error("PRIVATE_KEY_TEST environment variable is not set. Please set it in Lambda configuration.");
        }
        // Setup provider and wallet
        const provider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers_1.ethers.Wallet(PRIVATE_KEY, provider);
        console.log("Wallet address:", wallet.address);
        // Check wallet balance
        const balance = await provider.getBalance(wallet.address);
        console.log(`Wallet balance: ${ethers_1.ethers.formatEther(balance)} ETH`);
        // Create oracle contract instance
        const oracleContract = new ethers_1.ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, wallet);
        console.log("Fetching price updates from Hermes...");
        // Get price updates for ETH/USD and USDC/USD directly using axios to call Hermes API
        const priceIds = [ETH_USD_PRICE_ID, USDC_USD_PRICE_ID];
        const hermesUrl = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${ETH_USD_PRICE_ID}&ids[]=${USDC_USD_PRICE_ID}`;
        const hermesResponse = await axios_1.default.get(hermesUrl);
        console.log("Hermes API response received");
        // Properly convert hex strings to bytes arrays
        const rawData = hermesResponse.data.binary.data;
        const priceUpdateData = rawData.map((hexString) => {
            // Add 0x prefix if it doesn't exist
            if (!hexString.startsWith("0x")) {
                hexString = "0x" + hexString;
            }
            return hexString; // ethers.js will handle the conversion to BytesLike
        });
        console.log(`Retrieved price updates for ${priceIds.length} price feeds`);
        // Get the Pyth oracle address from our oracle contract
        const pythAddress = await oracleContract.pyth();
        console.log(`Pyth Oracle address: ${pythAddress}`);
        // Create contract instance for the Pyth oracle
        const pythContract = new ethers_1.ethers.Contract(pythAddress, PYTH_ABI, provider);
        // Get update fee
        const updateFee = await pythContract.getUpdateFee(priceUpdateData);
        console.log(`Update fee: ${updateFee.toString()} wei`);
        // Send transaction to update prices
        const tx = await oracleContract.updatePythPrices(priceUpdateData, {
            value: updateFee,
        });
        console.log(`Transaction sent! Hash: ${tx.hash}`);
        console.log(`Explorer URL: https://sepolia.arbiscan.io/tx/${tx.hash}`);
        // Wait for transaction to be mined
        const receipt = await tx.wait();
        console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
        return { success: true, hash: tx.hash };
    }
    catch (error) {
        console.error("Error updating oracle prices:", error);
        return { success: false, error: formatError(error) };
    }
}
// Function to get underlying price for a cToken
async function getUnderlyingPrice(cTokenAddress) {
    try {
        console.log(`Getting price for cToken: ${cTokenAddress}`);
        // Setup provider
        const provider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
        // Create oracle contract instance (read-only)
        const oracleContract = new ethers_1.ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);
        // Call getUnderlyingPrice
        const price = await oracleContract.getUnderlyingPrice(cTokenAddress);
        console.log(`Retrieved price: ${ethers_1.ethers.formatUnits(price, 18)} (18 decimals)`);
        return { success: true, price: price.toString() };
    }
    catch (error) {
        console.error("Error getting underlying price:", error);
        return { success: false, error: formatError(error) };
    }
}
// Function to get price for a direct asset address using assetPrices
async function getAssetPrice(assetAddress) {
    try {
        console.log(`Getting price for asset: ${assetAddress}`);
        // Setup provider
        const provider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
        // Create oracle contract instance (read-only)
        const oracleContract = new ethers_1.ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);
        // Call assetPrices
        const price = await oracleContract.assetPrices(assetAddress);
        console.log(`Retrieved price: ${ethers_1.ethers.formatUnits(price, 18)} (18 decimals)`);
        return { success: true, price: price.toString() };
    }
    catch (error) {
        console.error("Error getting asset price:", error);
        return { success: false, error: formatError(error) };
    }
}
// Lambda Handler function - this is the entry point for AWS Lambda
const handler = async (event) => {
    console.log("Lambda event received:", JSON.stringify(event));
    const isScheduledEvent = event.source === "aws.events";
    try {
        // Default action is to update prices
        let result;
        // Check for command in the event
        if (event.command === "price" && event.address) {
            result = await getUnderlyingPrice(event.address);
        }
        else if (event.command === "asset-price" && event.address) {
            result = await getAssetPrice(event.address);
        }
        else {
            // Default: update oracle prices
            result = await updateOraclePrices();
        }
        // Schedule the next invocation (only if this is not a manual test)
        if (process.env.AWS_EXECUTION_ENV && !event.noReschedule) {
            await scheduleNextInvocation();
        }
        return {
            statusCode: 200,
            body: JSON.stringify(result),
        };
    }
    catch (error) {
        console.error("Error in Lambda handler:", error);
        // Even if there's an error, schedule the next run
        if (process.env.AWS_EXECUTION_ENV && !event.noReschedule) {
            await scheduleNextInvocation();
        }
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                error: formatError(error),
            }),
        };
    }
};
exports.handler = handler;
// Run the function if this file is executed directly
if (require.main === module) {
    // Get command line args to determine which function to run
    const args = process.argv.slice(2);
    if (args[0] === "price" && args[1]) {
        // If "price" command is specified with a cToken address, get the price
        getUnderlyingPrice(args[1])
            .then(() => process.exit(0))
            .catch((error) => {
            console.error(error);
            process.exit(1);
        });
    }
    else if (args[0] === "asset-price" && args[1]) {
        // If "asset-price" command is specified with an asset address, get the price
        getAssetPrice(args[1])
            .then(() => process.exit(0))
            .catch((error) => {
            console.error(error);
            process.exit(1);
        });
    }
    else {
        // Default: update oracle prices
        updateOraclePrices()
            .then(() => process.exit(0))
            .catch((error) => {
            console.error(error);
            process.exit(1);
        });
    }
}
