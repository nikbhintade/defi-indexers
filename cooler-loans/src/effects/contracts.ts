/**
 * Typed wrappers around `tryContractCall` for every eth_call the original
 * subgraph performed. Each wrapper documents the corresponding subgraph call.
 *
 * Pinning policy (per CONVENTIONS.md): immutable metadata (decimals, token
 * addresses, factory, version, kernel module lookup) is unpinned; state reads
 * (balances, receivables, prices, positions, previewRedeem, treasury balances)
 * are pinned to the event block.
 *
 * Tuple-returning calls (getLoan/getRequest/accountPosition/loanToValues) are
 * decoded by viem to arrays; in mock mode the mock returns the same array shape.
 */
import type { EffectCaller } from "envio";
import { tryContractCall } from "./calls";

type EC = EffectCaller | null;

const lower = (a: string | null): string | null => (a === null ? null : a.toLowerCase());

// ===================== Cooler =====================

/** Cooler.owner() — borrower address. Immutable, unpinned. */
export const coolerOwner = async (ec: EC, cooler: string) =>
  lower(await tryContractCall<string>(ec, cooler, "function owner() view returns (address)", "owner", []));

/** Cooler.collateral() — collateral token. Immutable, unpinned. */
export const coolerCollateral = async (ec: EC, cooler: string) =>
  lower(await tryContractCall<string>(ec, cooler, "function collateral() view returns (address)", "collateral", []));

/** Cooler.debt() — debt token. Immutable, unpinned. */
export const coolerDebt = async (ec: EC, cooler: string) =>
  lower(await tryContractCall<string>(ec, cooler, "function debt() view returns (address)", "debt", []));

export type CoolerRequest = {
  amount: bigint;
  interest: bigint;
  loanToCollateral: bigint;
  duration: bigint;
  active: boolean;
  requester: string;
};

const REQUEST_SIG =
  "function getRequest(uint256 reqID) view returns (uint256 amount, uint256 interest, uint256 loanToCollateral, uint256 duration, bool active, address requester)";

/** Cooler.getRequest(reqID). State read, pinned. */
export const coolerGetRequest = async (
  ec: EC,
  cooler: string,
  reqID: bigint,
  block: number,
): Promise<CoolerRequest | null> => {
  const r = await tryContractCall<readonly [bigint, bigint, bigint, bigint, boolean, string]>(
    ec,
    cooler,
    REQUEST_SIG,
    "getRequest",
    [reqID],
    block,
  );
  if (r === null) return null;
  return {
    amount: r[0],
    interest: r[1],
    loanToCollateral: r[2],
    duration: r[3],
    active: r[4],
    requester: r[5].toLowerCase(),
  };
};

export type CoolerLoanData = {
  // Note: `request` nested tuple flattened — we only need request.duration.
  requestDuration: bigint;
  principal: bigint;
  interestDue: bigint;
  collateral: bigint;
  expiry: bigint;
  lender: string;
  recipient: string;
  callback: boolean;
};

const LOAN_SIG =
  "function getLoan(uint256 loanID) view returns ((uint256 amount, uint256 interest, uint256 loanToCollateral, uint256 duration, bool active, address requester) request, uint256 principal, uint256 interestDue, uint256 collateral, uint256 expiry, address lender, address recipient, bool callback)";

/** Cooler.getLoan(loanID). State read, pinned. */
export const coolerGetLoan = async (
  ec: EC,
  cooler: string,
  loanID: bigint,
  block: number,
): Promise<CoolerLoanData | null> => {
  const r = await tryContractCall<
    readonly [
      readonly [bigint, bigint, bigint, bigint, boolean, string],
      bigint,
      bigint,
      bigint,
      bigint,
      string,
      string,
      boolean,
    ]
  >(ec, cooler, LOAN_SIG, "getLoan", [loanID], block);
  if (r === null) return null;
  return {
    requestDuration: r[0][3],
    principal: r[1],
    interestDue: r[2],
    collateral: r[3],
    expiry: r[4],
    lender: r[5].toLowerCase(),
    recipient: r[6].toLowerCase(),
    callback: r[7],
  };
};

// ===================== Clearinghouse (V1 / V1.1) =====================

export const clearinghouseGohm = async (ec: EC, ch: string) =>
  lower(await tryContractCall<string>(ec, ch, "function gohm() view returns (address)", "gohm", []));
export const clearinghouseDai = async (ec: EC, ch: string) =>
  lower(await tryContractCall<string>(ec, ch, "function dai() view returns (address)", "dai", []));
export const clearinghouseSdai = async (ec: EC, ch: string) =>
  lower(await tryContractCall<string>(ec, ch, "function sdai() view returns (address)", "sdai", []));

// Clearinghouse V1.2 token getters
export const clearinghouseReserve = async (ec: EC, ch: string) =>
  lower(await tryContractCall<string>(ec, ch, "function reserve() view returns (address)", "reserve", []));
export const clearinghouseSReserve = async (ec: EC, ch: string) =>
  lower(await tryContractCall<string>(ec, ch, "function sReserve() view returns (address)", "sReserve", []));

/** Clearinghouse_V1_2.VERSION() -> (uint8 major, uint8 minor). Immutable. */
export const clearinghouseVersion = (ec: EC, ch: string) =>
  tryContractCall<readonly [number, number]>(
    ec,
    ch,
    "function VERSION() view returns (uint8, uint8)",
    "VERSION",
    [],
  );

export const clearinghouseInterestRate = (ec: EC, ch: string) =>
  tryContractCall<bigint>(ec, ch, "function INTEREST_RATE() view returns (uint256)", "INTEREST_RATE", []);
export const clearinghouseDuration = (ec: EC, ch: string) =>
  tryContractCall<bigint>(ec, ch, "function DURATION() view returns (uint256)", "DURATION", []);
export const clearinghouseFundCadence = (ec: EC, ch: string) =>
  tryContractCall<bigint>(ec, ch, "function FUND_CADENCE() view returns (uint256)", "FUND_CADENCE", []);
export const clearinghouseFundAmount = (ec: EC, ch: string) =>
  tryContractCall<bigint>(ec, ch, "function FUND_AMOUNT() view returns (uint256)", "FUND_AMOUNT", []);
export const clearinghouseLoanToCollateral = (ec: EC, ch: string) =>
  tryContractCall<bigint>(ec, ch, "function LOAN_TO_COLLATERAL() view returns (uint256)", "LOAN_TO_COLLATERAL", []);
export const clearinghouseFactory = async (ec: EC, ch: string) =>
  lower(await tryContractCall<string>(ec, ch, "function factory() view returns (address)", "factory", []));

// State reads (pinned)
export const clearinghouseActive = (ec: EC, ch: string, block: number) =>
  tryContractCall<boolean>(ec, ch, "function active() view returns (bool)", "active", [], block);
export const clearinghouseFundTime = (ec: EC, ch: string, block: number) =>
  tryContractCall<bigint>(ec, ch, "function fundTime() view returns (uint256)", "fundTime", [], block);
export const clearinghouseInterestReceivables = (ec: EC, ch: string, block: number) =>
  tryContractCall<bigint>(ec, ch, "function interestReceivables() view returns (uint256)", "interestReceivables", [], block);
export const clearinghousePrincipalReceivables = (ec: EC, ch: string, block: number) =>
  tryContractCall<bigint>(ec, ch, "function principalReceivables() view returns (uint256)", "principalReceivables", [], block);

// ===================== ERC20 / ERC4626 =====================

/** ERC20.decimals() — immutable, unpinned. */
export const erc20Decimals = (ec: EC, token: string) =>
  tryContractCall<number>(ec, token, "function decimals() view returns (uint8)", "decimals", []);

/** ERC20/ERC4626.balanceOf(addr) — state, pinned. */
export const balanceOf = (ec: EC, token: string, account: string, block: number) =>
  tryContractCall<bigint>(ec, token, "function balanceOf(address) view returns (uint256)", "balanceOf", [account], block);

/** ERC4626.previewRedeem(shares) — state, pinned. */
export const previewRedeem = (ec: EC, vault: string, shares: bigint, block: number) =>
  tryContractCall<bigint>(ec, vault, "function previewRedeem(uint256) view returns (uint256)", "previewRedeem", [shares], block);

// ===================== Bophades Kernel / TRSRY =====================

/** Kernel.getModuleForKeycode(bytes5) — module lookup. Pinned (module can change). */
export const kernelGetModuleForKeycode = async (ec: EC, kernel: string, keycode: string, block: number) =>
  lower(
    await tryContractCall<string>(
      ec,
      kernel,
      "function getModuleForKeycode(bytes5) view returns (address)",
      "getModuleForKeycode",
      [keycode],
      block,
    ),
  );

/** TRSRY.getReserveBalance(token) — state, pinned. */
export const trsryGetReserveBalance = (ec: EC, trsry: string, token: string, block: number) =>
  tryContractCall<bigint>(ec, trsry, "function getReserveBalance(address) view returns (uint256)", "getReserveBalance", [token], block);

/** TRSRY.reserveDebt(token, debtor) — state, pinned. */
export const trsryReserveDebt = (ec: EC, trsry: string, token: string, debtor: string, block: number) =>
  tryContractCall<bigint>(ec, trsry, "function reserveDebt(address, address) view returns (uint256)", "reserveDebt", [token, debtor], block);

// ===================== Price feeds / gOHM =====================

export const feedDecimals = (ec: EC, feed: string) =>
  tryContractCall<number>(ec, feed, "function decimals() view returns (uint8)", "decimals", []);
/** ChainlinkPriceFeed.latestAnswer() — state, pinned. */
export const feedLatestAnswer = (ec: EC, feed: string, block: number) =>
  tryContractCall<bigint>(ec, feed, "function latestAnswer() view returns (int256)", "latestAnswer", [], block);
/** gOHM.index() — state, pinned. */
export const gohmIndex = (ec: EC, gohm: string, block: number) =>
  tryContractCall<bigint>(ec, gohm, "function index() view returns (uint256)", "index", [], block);

// ===================== MonoCooler =====================

/** MonoCooler.loanToValues() -> (uint96 maxOriginationLtv, uint96 liquidationLtv). State, pinned. */
export const monoLoanToValues = (ec: EC, addr: string, block: number) =>
  tryContractCall<readonly [bigint, bigint]>(
    ec,
    addr,
    "function loanToValues() view returns (uint96, uint96)",
    "loanToValues",
    [],
    block,
  );

export type MonoAccountPosition = {
  collateral: bigint;
  currentDebt: bigint;
  maxOriginationDebtAmount: bigint;
  liquidationDebtAmount: bigint;
  healthFactor: bigint;
  currentLtv: bigint;
  totalDelegated: bigint;
  numDelegateAddresses: bigint;
  maxDelegateAddresses: bigint;
};

const POSITION_SIG =
  "function accountPosition(address account) view returns (uint256 collateral, uint256 currentDebt, uint256 maxOriginationDebtAmount, uint256 liquidationDebtAmount, uint256 healthFactor, uint256 currentLtv, uint256 totalDelegated, uint256 numDelegateAddresses, uint256 maxDelegateAddresses)";

/** MonoCooler.accountPosition(account). State, pinned. */
export const monoAccountPosition = async (
  ec: EC,
  addr: string,
  account: string,
  block: number,
): Promise<MonoAccountPosition | null> => {
  const r = await tryContractCall<readonly bigint[]>(ec, addr, POSITION_SIG, "accountPosition", [account], block);
  if (r === null) return null;
  return {
    collateral: r[0]!,
    currentDebt: r[1]!,
    maxOriginationDebtAmount: r[2]!,
    liquidationDebtAmount: r[3]!,
    healthFactor: r[4]!,
    currentLtv: r[5]!,
    totalDelegated: r[6]!,
    numDelegateAddresses: r[7]!,
    maxDelegateAddresses: r[8]!,
  };
};

export const monoTotalCollateral = (ec: EC, addr: string, block: number) =>
  tryContractCall<bigint>(ec, addr, "function totalCollateral() view returns (uint128)", "totalCollateral", [], block);
export const monoTotalDebt = (ec: EC, addr: string, block: number) =>
  tryContractCall<bigint>(ec, addr, "function totalDebt() view returns (uint128)", "totalDebt", [], block);
export const monoInterestAccumulatorRay = (ec: EC, addr: string, block: number) =>
  tryContractCall<bigint>(ec, addr, "function interestAccumulatorRay() view returns (uint256)", "interestAccumulatorRay", [], block);
export const monoInterestRateWad = (ec: EC, addr: string, block: number) =>
  tryContractCall<bigint>(ec, addr, "function interestRateWad() view returns (uint96)", "interestRateWad", [], block);
export const monoLtvOracle = async (ec: EC, addr: string, block: number) =>
  lower(await tryContractCall<string>(ec, addr, "function ltvOracle() view returns (address)", "ltvOracle", [], block));
export const monoLiquidationsPaused = (ec: EC, addr: string, block: number) =>
  tryContractCall<boolean>(ec, addr, "function liquidationsPaused() view returns (bool)", "liquidationsPaused", [], block);
export const monoBorrowsPaused = (ec: EC, addr: string, block: number) =>
  tryContractCall<boolean>(ec, addr, "function borrowsPaused() view returns (bool)", "borrowsPaused", [], block);
export const monoTreasuryBorrower = async (ec: EC, addr: string, block: number) =>
  lower(await tryContractCall<string>(ec, addr, "function treasuryBorrower() view returns (address)", "treasuryBorrower", [], block));
