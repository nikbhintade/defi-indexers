/** Ported from src/mappings/strategyMappings.ts (Strategy template events). */
import { indexer } from "envio";
import type { Env } from "../utils/types";
import { low } from "../utils/commons";
import { getOrCreateTransactionFromEvent } from "../utils/transaction";
import * as strategyLibrary from "../utils/strategy";

const mkEnv = (event: { block: { number: number } }, context: Env["context"]): Env => ({
  context,
  ec: context.effect,
  block: event.block.number,
});

indexer.onEvent({ contract: "Strategy", event: "Harvested" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "Harvested");
  await strategyLibrary.harvest(
    env,
    event.transaction.from ? low(event.transaction.from) : "",
    low(event.srcAddress),
    BigInt(event.block.timestamp),
    BigInt(event.block.number),
    event.transaction.hash,
    BigInt(event.transaction.transactionIndex),
    event.params.profit,
    event.params.loss,
    event.params.debtPayment,
    event.params.debtOutstanding,
    transaction,
  );
});

indexer.onEvent({ contract: "Strategy", event: "Cloned" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  const transaction = await getOrCreateTransactionFromEvent(context, event, "StrategyCloned");
  await strategyLibrary.strategyCloned(env, low(event.params.clone), low(event.srcAddress), transaction);
});

indexer.onEvent({ contract: "Strategy", event: "SetHealthCheck" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "SetHealthCheck");
  await strategyLibrary.healthCheckSet(env, low(event.srcAddress), low(event.params.healthCheckAddress));
});

indexer.onEvent({ contract: "Strategy", event: "SetDoHealthCheck" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "SetDoHealthCheck");
  await strategyLibrary.doHealthCheckSet(env, low(event.srcAddress), event.params.doHealthCheck);
});

indexer.onEvent({ contract: "Strategy", event: "EmergencyExitEnabled" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "EmergencyExitEnabled");
  await strategyLibrary.emergencyExitEnabled(env, low(event.srcAddress));
});

indexer.onEvent({ contract: "Strategy", event: "UpdatedKeeper" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdatedKeeper");
  await strategyLibrary.updatedKeeper(env, low(event.srcAddress), low(event.params.newKeeper));
});

indexer.onEvent({ contract: "Strategy", event: "UpdatedStrategist" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdatedStrategist");
  await strategyLibrary.updatedStrategist(env, low(event.srcAddress), low(event.params.newStrategist));
});

indexer.onEvent({ contract: "Strategy", event: "UpdatedRewards" }, async ({ event, context }) => {
  const env = mkEnv(event, context);
  await getOrCreateTransactionFromEvent(context, event, "UpdatedRewards");
  await strategyLibrary.updatedRewards(env, low(event.srcAddress), low(event.params.rewards));
});
