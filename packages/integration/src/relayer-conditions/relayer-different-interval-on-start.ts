import { abi as priceFeedAbi } from "@redstone-finance/on-chain-relayer/artifacts/contracts/mocks/PriceFeedWithRoundsMock.sol/PriceFeedWithRoundsMock.json";
import { PriceFeedWithRounds } from "@redstone-finance/on-chain-relayer/typechain-types";
import { RedstoneCommon } from "@redstone-finance/utils";
import { ethers } from "ethers";
import {
  configureCleanup,
  debug,
  deployMockAdapter,
  deployMockPriceFeed,
  GatewayInstance,
  HardhatInstance,
  OracleNodeInstance,
  RelayerInstance,
  setMockPrices,
  startAndWaitForGateway,
  startAndWaitForHardHat,
  startAndWaitForOracleNode,
  startRelayer,
  stopGateway,
  stopHardhat,
  stopOracleNode,
  stopRelayer,
  verifyPricesOnChain,
  waitForDataAndDisplayIt,
} from "../framework/integration-test-framework";

const hardhatInstance: HardhatInstance = { instanceId: "1" };
const relayerInstance: RelayerInstance = { instanceId: "1" };
const gatewayInstance: GatewayInstance = { instanceId: "1" };
const oracleNodeInstance: OracleNodeInstance = { instanceId: "1" };

const stopAll = () => {
  debug("stopAll called");
  stopRelayer(relayerInstance);
  stopHardhat(hardhatInstance);
  stopOracleNode(oracleNodeInstance);
  stopGateway(gatewayInstance);
};

const main = async () => {
  await startAndWaitForGateway(gatewayInstance, { directOnly: true });
  setMockPrices(
    {
      BTC: 16000,
      __DEFAULT__: 42,
    },
    oracleNodeInstance
  );
  await startAndWaitForOracleNode(oracleNodeInstance, [gatewayInstance]);
  await waitForDataAndDisplayIt(gatewayInstance);
  await startAndWaitForHardHat(hardhatInstance);

  const adapterContract = await deployMockAdapter();
  const adapterContractAddress = adapterContract.address;
  const priceFeedContract = await deployMockPriceFeed(adapterContractAddress);
  const priceFeedContractAddress = priceFeedContract.address;

  // iteration of relayer happen every ~10 seconds
  // time since last update is set on every 6 seconds
  // so on every relayer iteration we should publish new timestamp
  startRelayer(relayerInstance, {
    cacheServiceInstances: [gatewayInstance],
    adapterContractAddress,
    intervalInMs: 10_000,
    updateTriggers: {
      timeSinceLastUpdateInMilliseconds: 6_000,
    },
    isFallback: false,
    temporaryUpdatePriceInterval: 20_000,
  });

  // first update should take ~30 seconds
  // then 10 seconds each for 30 seconds should result in 3 update
  // in summary there should happend 4 updates in 1 min
  console.log("Waiting 60 seconds, for relayer");
  await RedstoneCommon.sleep(RedstoneCommon.minToMs(1));

  const priceFeed = new ethers.Contract(
    priceFeedContractAddress,
    priceFeedAbi,
    new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545")
  ) as PriceFeedWithRounds;

  const currentRound = (await priceFeed.latestRound()).toNumber();
  if (!(currentRound === 3 || currentRound === 4)) {
    throw new Error(
      `Expected round id should be 3 or 4, but equals ${currentRound.toString()}`
    );
  }

  await verifyPricesOnChain(adapterContract, priceFeedContract, {
    BTC: 16000,
  });

  process.exit();
};

configureCleanup(stopAll);

void main();
