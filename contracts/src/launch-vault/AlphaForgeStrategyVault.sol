// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { AlphaForgeVault } from "../AlphaForgeVault.sol";
import { StrategyPass } from "../StrategyPass.sol";
import { IAlphaForgeReferenceFeed } from "../AlphaForgeTestStock.sol";

/// @notice A fixed-supply test substitute for TSLA or AMZN, not a real share or stock token.
contract AlphaForgeStrategyTestStock is ERC20 {
    constructor(bool tsla, uint256 supply, address recipient)
        ERC20(
            tsla ? "AlphaForge Test TSLA" : "AlphaForge Test AMZN",
            tsla ? "AF-TEST-TSLA" : "AF-TEST-AMZN"
        )
    {
        require(
            block.chainid == 46630 && supply != 0 && recipient != address(0), "TEST_CONFIGURATION"
        );
        _mint(recipient, supply);
    }
}

/// @notice Source-confirmed regular-session window and test-stock price. No real stock custody.
/// @dev Keeper publishes UTC bounds from the data provider's calendar, including DST/early close.
contract AlphaForgeStrategyReferenceFeed is IAlphaForgeReferenceFeed {
    address public immutable keeper;
    bytes32 public immutable referenceIdentity;
    uint256 private quote;
    uint64 private observed;
    bytes32 private digest;
    uint64 public regularOpen;
    uint64 public regularClose;
    uint64 public calendarObservedAt;
    bytes32 public calendarDigest;
    event ReferenceUpdated(uint256 usdcRaw, uint64 observedAt, bytes32 indexed sourceDigest);
    event SessionUpdated(
        uint64 regularOpen, uint64 regularClose, uint64 observedAt, bytes32 indexed sourceDigest
    );

    constructor(address keeper_, bytes32 identity) {
        require(
            block.chainid == 46630 && keeper_ != address(0) && identity != bytes32(0),
            "TEST_REFERENCE_IDENTITY"
        );
        keeper = keeper_;
        referenceIdentity = identity;
    }

    function update(uint256 price_, uint64 at, bytes32 source) external {
        require(msg.sender == keeper && price_ != 0 && source != bytes32(0), "KEEPER_REFERENCE");
        require(
            at <= block.timestamp && at > observed && block.timestamp - at <= 60,
            "FRESH_REFERENCE_REQUIRED"
        );
        quote = price_;
        observed = at;
        digest = source;
        emit ReferenceUpdated(price_, at, source);
    }

    function updateSession(uint64 opens, uint64 closes, uint64 at, bytes32 source) external {
        require(msg.sender == keeper && source != bytes32(0), "KEEPER_CALENDAR");
        require(
            at <= block.timestamp && at >= calendarObservedAt && block.timestamp - at <= 60,
            "FRESH_CALENDAR_REQUIRED"
        );
        require(
            (opens == 0 && closes == 0) || (opens < closes && closes - opens <= 8 hours),
            "REGULAR_SESSION_BOUNDS"
        );
        regularOpen = opens;
        regularClose = closes;
        calendarObservedAt = at;
        calendarDigest = source;
        emit SessionUpdated(opens, closes, at, source);
    }

    function executionAllowed() external view returns (bool) {
        return calendarDigest != bytes32(0) && calendarObservedAt <= block.timestamp
            && block.timestamp - calendarObservedAt <= 60 && regularOpen <= block.timestamp
            && block.timestamp < regularClose;
    }

    function price() external view returns (uint256, uint64, bytes32) {
        return (quote, observed, digest);
    }
}

interface IStrategySessionFeed {
    function executionAllowed() external view returns (bool);
}

/// @notice Separately funded test-stock inventory; never owns user Vaults or PASS LP capital.
/// @dev Prices are explicit operator test references, independent of the PASS market price.
contract AlphaForgeStockReserve is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable owner;
    address public immutable usdc;
    address public immutable stock;
    IAlphaForgeReferenceFeed public immutable feed;
    uint32 public immutable maxPriceAge;
    bool public paused;
    event Funded(address indexed token, uint256 amount);
    event Swapped(address indexed trader, bool buy, uint256 input, uint256 output);
    event ReserveWithdrawn(address indexed token, uint256 amount);

    constructor(address owner_, address usdc_, address stock_, address feed_, uint32 age) {
        require(
            block.chainid == 46630 && owner_ != address(0) && usdc_ != stock_
                && usdc_.code.length != 0 && stock_.code.length != 0 && feed_.code.length != 0
                && IERC20Metadata(usdc_).decimals() == 6 && IERC20Metadata(stock_).decimals() == 18
                && age != 0 && age <= 60,
            "CONFIGURATION"
        );
        owner = owner_;
        usdc = usdc_;
        stock = stock_;
        feed = IAlphaForgeReferenceFeed(feed_);
        maxPriceAge = age;
    }

    function setPaused(bool next) external {
        require(msg.sender == owner, "OWNER_PAUSE");
        paused = next;
    }

    function price() public view returns (uint256 value) {
        uint64 at;
        bytes32 digest;
        (value, at, digest) = feed.price();
        require(
            value != 0 && digest != bytes32(0) && at <= block.timestamp
                && block.timestamp - at <= maxPriceAge,
            "STALE_REFERENCE"
        );
    }

    function fund(address token, uint256 amount) external nonReentrant {
        require(
            msg.sender == owner && (token == usdc || token == stock) && amount != 0, "OWNER_FUNDING"
        );
        _pull(token, msg.sender, amount);
        emit Funded(token, amount);
    }

    function withdrawReserve(address token, uint256 amount) external nonReentrant {
        require(msg.sender == owner && (token == usdc || token == stock), "OWNER_WITHDRAWAL");
        _send(token, owner, amount);
        emit ReserveWithdrawn(token, amount);
    }

    function swap(bool buy, uint256 input, uint256 minimum, uint64 deadline)
        external
        nonReentrant
        returns (uint256 output)
    {
        require(block.chainid == 46630 && input != 0 && deadline >= block.timestamp, "INVALID_SWAP");
        require(
            !paused && IStrategySessionFeed(address(feed)).executionAllowed(),
            "REGULAR_SESSION_REQUIRED"
        );
        output = buy ? Math.mulDiv(input, 1e18, price()) : Math.mulDiv(input, price(), 1e18);
        require(output != 0 && output >= minimum, "MINIMUM_OUTPUT");
        address inToken = buy ? usdc : stock;
        address outToken = buy ? stock : usdc;
        require(IERC20(outToken).balanceOf(address(this)) >= output, "INSUFFICIENT_TEST_RESERVE");
        _pull(inToken, msg.sender, input);
        _send(outToken, msg.sender, output);
        emit Swapped(msg.sender, buy, input, output);
    }

    function _pull(address token, address from, uint256 amount) private {
        uint256 beforeAmount = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(from, address(this), amount);
        require(
            IERC20(token).balanceOf(address(this)) - beforeAmount == amount, "TRANSFER_MISMATCH"
        );
    }

    function _send(address token, address to, uint256 amount) private {
        uint256 beforeAmount = IERC20(token).balanceOf(to);
        IERC20(token).safeTransfer(to, amount);
        require(IERC20(token).balanceOf(to) - beforeAmount == amount, "TRANSFER_MISMATCH");
    }
}

/// @notice Reuses reviewed principal/profit/PASS/dust accounting for an owner-isolated All-in strategy.
/// @dev The second base asset slot is the other test stock; execute can only touch targetStock.
contract AlphaForgeStrategyVault is AlphaForgeVault {
    using SafeERC20 for IERC20;

    struct Configuration {
        address owner;
        address creator;
        address pass;
        address usdc;
        address targetStock;
        address otherStock;
        address stockReserve;
        address referenceFeed;
        bytes32 strategyRef;
        uint32 maxPriceAge;
    }

    struct ExecutorGrant {
        address executor;
        uint64 expiresAt;
        uint256 maxOrderUsdc;
        uint256 maxTotalBuyUsdc;
        uint16 maxSlippageBps;
    }
    address public immutable targetStock;
    AlphaForgeStockReserve public immutable stockReserve;
    IAlphaForgeReferenceFeed public immutable referenceFeed;
    uint32 public immutable maxPriceAge;
    ExecutorGrant public grant;
    uint256 public totalBuyUsdc;
    uint256 public executionVersion;
    uint256 public positionCostUsdc;
    int256 public realizedTradingPnl;
    event ExecutorConfigured(address indexed executor, uint64 expiresAt, uint256 version);
    event StrategyExecuted(bool buy, uint256 input, uint256 output, uint256 version);

    constructor(Configuration memory c)
        AlphaForgeVault(
            c.owner,
            c.creator,
            StrategyPass(c.pass).strategyId(),
            c.strategyRef,
            c.pass,
            c.usdc,
            c.targetStock,
            c.otherStock
        )
    {
        require(
            block.chainid == 46630 && c.maxPriceAge != 0 && c.maxPriceAge <= 60
                && c.stockReserve.code.length != 0 && c.referenceFeed.code.length != 0
                && IERC20Metadata(c.targetStock).decimals() == 18,
            "STRATEGY_CONFIGURATION"
        );
        AlphaForgeStockReserve venue = AlphaForgeStockReserve(c.stockReserve);
        require(
            venue.usdc() == c.usdc && venue.stock() == c.targetStock
                && address(venue.feed()) == c.referenceFeed,
            "STOCK_ROUTE"
        );
        targetStock = c.targetStock;
        stockReserve = venue;
        referenceFeed = IAlphaForgeReferenceFeed(c.referenceFeed);
        maxPriceAge = c.maxPriceAge;
    }

    function configureExecutor(ExecutorGrant calldata next)
        external
        onlyOwner
        whenActive
        nonReentrant
    {
        require(
            next.executor != address(0) && next.executor != owner
                && next.expiresAt > block.timestamp && next.maxOrderUsdc != 0
                && next.maxTotalBuyUsdc != 0 && next.maxSlippageBps <= 500,
            "GRANT"
        );
        grant = next;
        totalBuyUsdc = 0;
        ++executionVersion;
        emit ExecutorConfigured(next.executor, next.expiresAt, executionVersion);
    }

    function revokeExecutor() external onlyOwner nonReentrant {
        delete grant;
        ++executionVersion;
        emit ExecutorConfigured(address(0), 0, executionVersion);
    }

    function execute(
        bool buy,
        uint256 input,
        uint256 minOutput,
        uint64 deadline,
        uint256 expectedVersion
    ) external whenActive nonReentrant returns (uint256 output) {
        _validateExecution(buy, input, minOutput, deadline, expectedVersion);
        output = _swap(buy, input, minOutput, deadline);
        uint256 previous = trackedPosition[targetStock];
        if (buy) {
            trackedUsdcBalance -= input;
            totalBuyUsdc += input;
            positionCostUsdc += input;
            _setTrackedPosition(targetStock, previous + output);
        } else {
            uint256 exitedCost = input == previous
                ? positionCostUsdc
                : Math.mulDiv(positionCostUsdc, input, previous);
            positionCostUsdc -= exitedCost;
            realizedTradingPnl += int256(output) - int256(exitedCost);
            trackedUsdcBalance += output;
            _setTrackedPosition(targetStock, previous - input);
        }
        ++executionVersion;
        emit StrategyExecuted(buy, input, output, executionVersion);
    }

    function _validateExecution(
        bool buy,
        uint256 input,
        uint256 minOutput,
        uint64 deadline,
        uint256 expectedVersion
    ) private view {
        require(
            block.chainid == 46630 && input != 0 && deadline >= block.timestamp
                && expectedVersion == executionVersion,
            "EXECUTION_STATE"
        );
        ExecutorGrant memory permission = grant;
        bool directOwner = msg.sender == owner;
        require(
            directOwner
                || (msg.sender == permission.executor
                    && permission.expiresAt >= deadline
                    && permission.expiresAt > block.timestamp),
            "EXECUTOR_PERMISSION"
        );
        uint256 price = stockPrice();
        uint256 notional = buy ? input : Math.mulDiv(input, price, 1e18);
        uint256 expectedOutput = buy ? Math.mulDiv(input, 1e18, price) : notional;
        uint16 slippage = directOwner ? 500 : permission.maxSlippageBps;
        require(
            minOutput != 0 && minOutput >= Math.mulDiv(expectedOutput, 10000 - slippage, 10000),
            "RISK_MINIMUM"
        );
        if (!directOwner) {
            require(
                notional <= permission.maxOrderUsdc
                    && (!buy || totalBuyUsdc + input <= permission.maxTotalBuyUsdc),
                "EXECUTOR_LIMIT"
            );
        }
        require(
            buy ? input <= trackedUsdcBalance : input <= trackedPosition[targetStock],
            "TRACKED_BALANCE"
        );
    }

    function _swap(bool buy, uint256 input, uint256 minOutput, uint64 deadline)
        private
        returns (uint256 output)
    {
        address inToken = buy ? afUsdc : targetStock;
        address outToken = buy ? targetStock : afUsdc;
        uint256 beforeIn = IERC20(inToken).balanceOf(address(this));
        uint256 beforeOut = IERC20(outToken).balanceOf(address(this));
        IERC20(inToken).forceApprove(address(stockReserve), input);
        output = stockReserve.swap(buy, input, minOutput, deadline);
        IERC20(inToken).forceApprove(address(stockReserve), 0);
        require(
            beforeIn >= IERC20(inToken).balanceOf(address(this))
                && beforeIn - IERC20(inToken).balanceOf(address(this)) == input
                && IERC20(outToken).balanceOf(address(this)) - beforeOut == output,
            "SWAP_MISMATCH"
        );
    }

    function stockPrice() public view returns (uint256 price) {
        uint64 at;
        bytes32 digest;
        (price, at, digest) = referenceFeed.price();
        require(
            price != 0 && digest != bytes32(0) && at <= block.timestamp
                && block.timestamp - at <= maxPriceAge,
            "STALE_REFERENCE"
        );
    }

    function equity() public view returns (uint256) {
        uint256 units = trackedPosition[targetStock];
        return trackedUsdcBalance + (units == 0 ? 0 : Math.mulDiv(units, stockPrice(), 1e18));
    }

    function unrealizedPnl() external view returns (int256) {
        uint256 units = trackedPosition[targetStock];
        return
            int256(units == 0 ? 0 : Math.mulDiv(units, stockPrice(), 1e18))
                - int256(positionCostUsdc);
    }
}

/// @notice User calls createVault; the deployer/issuer cannot choose the user's owner address.
/// @dev Immutable bytecode data. A STOP prefix makes every call inert, including SELFDESTRUCT.
contract AlphaForgeVaultCodePart {
    constructor(bytes memory data) {
        bytes memory inertCode = bytes.concat(hex"00", data);
        assembly ("memory-safe") { return(add(inertCode, 32), mload(inertCode)) }
    }
}

contract AlphaForgeStrategyVaultFactory {
    struct Strategy {
        address creator;
        address pass;
        address usdc;
        address targetStock;
        address otherStock;
        address stockReserve;
        address referenceFeed;
        bytes32 strategyRef;
        uint32 maxPriceAge;
    }
    Strategy[2] private strategies;
    address private immutable firstCodePart;
    address private immutable secondCodePart;
    mapping(address => mapping(uint8 => address)) public vaults;
    mapping(address => mapping(uint8 => uint256)) public generations;
    event VaultCreated(
        address indexed owner, uint8 indexed strategyIndex, address vault, uint256 generation
    );

    constructor(Strategy[2] memory configs) {
        require(
            block.chainid == 46630 && configs[0].pass != configs[1].pass
                && configs[0].targetStock != configs[1].targetStock,
            "STRATEGIES"
        );
        for (uint256 i; i < 2; ++i) {
            require(
                configs[i].pass.code.length != 0 && configs[i].creator != address(0), "IDENTITY"
            );
            strategies[i] = configs[i];
        }
        // The inherited Vault creation code exceeds EIP-170 when embedded in factory
        // runtime. Store it as two inert immutable code chunks, keeping both the
        // factory and chunks below 24,576 bytes without changing compiler settings.
        bytes memory code = type(AlphaForgeStrategyVault).creationCode;
        uint256 midpoint = code.length / 2;
        bytes memory first = new bytes(midpoint);
        bytes memory second = new bytes(code.length - midpoint);
        assembly ("memory-safe") {
            for { let offset := 0 } lt(offset, midpoint) { offset := add(offset, 32) } {
                mstore(add(add(first, 32), offset), mload(add(add(code, 32), offset)))
            }
            for { let offset := 0 } lt(offset, mload(second)) { offset := add(offset, 32) } {
                mstore(
                    add(add(second, 32), offset),
                    mload(add(add(add(code, 32), midpoint), offset))
                )
            }
        }
        firstCodePart = address(new AlphaForgeVaultCodePart(first));
        secondCodePart = address(new AlphaForgeVaultCodePart(second));
    }

    function strategy(uint8 index) external view returns (Strategy memory) {
        require(index < 2, "STRATEGY_INDEX");
        return strategies[index];
    }

    function createVault(uint8 index) external returns (address created) {
        require(block.chainid == 46630 && index < 2, "STRATEGY_INDEX");
        address previous = vaults[msg.sender][index];
        require(
            previous == address(0) || AlphaForgeStrategyVault(payable(previous)).closed(),
            "ACTIVE_VAULT_EXISTS"
        );
        Strategy memory c = strategies[index];
        bytes memory arguments = abi.encode(
            AlphaForgeStrategyVault.Configuration({
                owner: msg.sender,
                creator: c.creator,
                pass: c.pass,
                usdc: c.usdc,
                targetStock: c.targetStock,
                otherStock: c.otherStock,
                stockReserve: c.stockReserve,
                referenceFeed: c.referenceFeed,
                strategyRef: c.strategyRef,
                maxPriceAge: c.maxPriceAge
            })
        );
        bytes memory code = _creationCode();
        bytes memory initcode = bytes.concat(code, arguments);
        assembly ("memory-safe") { created := create(0, add(initcode, 32), mload(initcode)) }
        require(created != address(0), "VAULT_CREATION_FAILED");
        vaults[msg.sender][index] = created;
        uint256 generation = ++generations[msg.sender][index];
        emit VaultCreated(msg.sender, index, created, generation);
    }

    function _creationCode() private view returns (bytes memory code) {
        address first = firstCodePart;
        address second = secondCodePart;
        uint256 firstSize = first.code.length - 1;
        uint256 secondSize = second.code.length - 1;
        code = new bytes(firstSize + secondSize);
        assembly ("memory-safe") {
            extcodecopy(first, add(code, 32), 1, firstSize)
            extcodecopy(second, add(add(code, 32), firstSize), 1, secondSize)
        }
    }
}
