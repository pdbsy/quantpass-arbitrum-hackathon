import { Interface, keccak256, toUtf8Bytes } from 'ethers';

/** Dedicated ABI; no M3 Vault selector or storage identifier is repurposed. */
export const tradingAbi = Object.freeze([
  'function owner() view returns(address)',
  'function strategyCreator() view returns(address)',
  'function strategyId() view returns(bytes32)',
  'function strategyRef() view returns(bytes32)',
  'function pass() view returns(address)',
  'function afUsdc() view returns(address)',
  'function router() view returns(address)',
  'function passLocker() view returns(address)',
  'function maxPriceAge() view returns(uint32)',
  'function stocks(uint256) view returns(address)',
  'function feeds(uint256) view returns(address)',
  'function trackedPosition(address) view returns(uint256)',
  'function grant() view returns(address executor,uint64 expiresAt,uint32 liquidationWindow,uint256 maxOrderUsdc,uint256 maxTotalBuyUsdc,uint16 maxSlippageBps)',
  'function grantVersion() view returns(uint256)',
  'function stateVersion() view returns(uint256)',
  'function principalBasis() view returns(uint256)',
  'function idleCash() view returns(uint256)',
  'function runtimeCash() view returns(uint256)',
  'function runtimeUnits() view returns(uint256)',
  'function totalBuyUsdc() view returns(uint256)',
  'function openTrackedPositionCount() view returns(uint256)',
  'function closed() view returns(bool)',
  'function liquidating() view returns(bool)',
  'function liquidationUntil() view returns(uint64)',
  'function lowerUnitNav() view returns(uint256)',
  'function upperUnitNav() view returns(uint256)',
  'function lowerPrice(uint256) view returns(uint256)',
  'function upperPrice(uint256) view returns(uint256)',
  'function runtimeEquity() view returns(uint256)',
  'function unitNav() view returns(uint256)',
  'function realizedProfit() view returns(uint256)',
  'function deposit(uint256)',
  'function allocate(uint256)',
  'function deallocate(uint256)',
  'function withdraw(uint256)',
  'function stop()',
  'function revokeExecutor()',
  'function close()',
  'function rescueUntrackedToken(address)',
  'function rescueNative()',
  'function checkRisk() returns(bool)',
  'function authorizeExecutor((address executor,uint64 expiresAt,uint32 liquidationWindow,uint256 maxOrderUsdc,uint256 maxTotalBuyUsdc,uint16 maxSlippageBps) next)',
  'function setBounds(uint256 lower,uint256 upper,uint256[3] priceLower,uint256[3] priceUpper)',
  'function execute((address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint64 deadline,uint256 expectedVersion) action) returns(uint256)',
  'event Deposited(uint256 amountUsdc,uint256 principalBasis,uint256 lockedPass)',
  'event CapitalChanged(bool allocated,uint256 amountUsdc,uint256 units,uint256 stateVersion)',
  'event Withdrawn(uint256 amountUsdc,uint256 principalExited,uint256 principalBasis)',
  'event GrantAuthorized(uint256 indexed grantVersion,address indexed executor,uint64 expiresAt)',
  'event LiquidationStarted(uint64 until,uint256 stateVersion)',
  'event RiskOrderCancelled(uint256 indexed stateVersion)',
  'event SwapExecuted(uint256 indexed stateVersion,uint256 indexed grantVersion,address indexed stock,bool buy,uint256 input,uint256 output)',
  'event BoundsChanged(uint256 stateVersion)',
  'event Closed(uint256 returnedUsdc,uint256 unlockedPass)',
  'event DustRescued(address indexed token,uint256 amount)',
]);
export const tradingInterface = new Interface(tradingAbi);
export const tradingAbiVersion = 'alphaforge-trading-v1';
export const tradingAbiHash = keccak256(toUtf8Bytes(tradingInterface.formatJson()));
export const tokenInterface = new Interface([
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
  'function decimals() view returns(uint8)',
  'function approve(address,uint256) returns(bool)',
  'function strategyId() view returns(bytes32)',
  'function lockedBalance() view returns(uint256)',
]);
export const feedInterface = new Interface([
  'event ReferenceUpdated(uint256 usdcRaw,uint64 observedAt,bytes32 indexed sourceDigest)',
  'function price() view returns(uint256,uint64,bytes32)',
  'function keeper() view returns(address)',
  'function referenceIdentity() view returns(bytes32)',
  'function update(uint256,uint64,bytes32)',
]);
export const factoryInterface = new Interface([
  'function getPool(address,address,uint24) view returns(address)',
]);
export const quoterInterface = new Interface([
  'function factory() view returns(address)',
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);
export const venueInterface = new Interface(['function factory() view returns(address)']);
export const poolInterface = new Interface([
  'function factory() view returns(address)',
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function fee() view returns(uint24)',
]);
