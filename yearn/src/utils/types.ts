import type { EvmOnEventContext, EffectCaller } from "envio";

export type Ctx = EvmOnEventContext;

/**
 * A handler-scoped bundle threaded through the ported library functions, in
 * place of the subgraph's implicit `dataSource` / `Contract.bind`.
 *  - context: entity operations + effect runner
 *  - ec: the effect caller (context.effect) for eth_calls
 *  - block: the event block number (used to pin state-dependent reads)
 */
export type Env = {
  context: Ctx;
  ec: EffectCaller;
  block: number;
};
