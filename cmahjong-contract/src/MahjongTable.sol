// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

/// @title MahjongTable — multi-token escrow & settlement for cMahjong (4 players) on Celo.
/// @notice The blockchain here acts purely as a *cashier + notary*:
///         it holds the buy-in, anchors fairness (commit–reveal seed), and pays out
///         prizes based on the signed final ranking. The game logic
///         (tiles, turns, move validation) runs OFFCHAIN.
///
/// The buy-in currency is chosen per-game from an owner-managed ALLOWLIST:
/// cUSD / USDC / USDT (ERC20, with different decimals) or native CELO (sentinel address(0)).
///
/// Payouts use the PULL-PAYMENT pattern (credit + `withdraw`) to stay safe against griefing
/// (a single player cannot brick settlement) and reentrancy, and to behave uniformly for
/// both native and ERC20 tokens.
///
/// This contract is UPGRADEABLE (UUPS): deployed behind an ERC1967Proxy, only the owner
/// may upgrade the implementation (`_authorizeUpgrade`).
///
/// One-game flow:
///   1. createGame  — organizer picks the token (must be allowlisted), buy-in, server, payout weights, deadlines.
///   2. joinGame    — 4 players deposit the buy-in (ERC20: approve first; native: send msg.value) + commitment.
///   3. revealSeed  — each player opens their secret; the collective seed = hash(all secrets).
///   4. (offchain)  — the game is played, the server computes the 1st..4th ranking.
///   5. settle      — all four players sign the ranking (EIP-712) → prizes are credited.
///      settleByServer — fallback after the deadline: the server attests the ranking (anti rage-quit).
///   6. withdraw    — winners / refund recipients withdraw their balance at any time.
contract MahjongTable is Initializable, EIP712Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    /// @dev Reentrancy guard backed by transient storage (EVM Cancun). It does not use
    ///      a permanent storage slot, so it is automatically upgrade-safe.
    ///      Slot = keccak256("cmahjong.reentrancyGuard.transient").
    modifier nonReentrant() {
        assembly {
            if tload(0x643119965bca0d2c9b966ba98ba1c1e0328dc1a5f0f036b5266e1fcd4e795809) {
                mstore(0x00, 0x3ee5aeb5) // ReentrancyGuardReentrantCall()
                revert(0x1c, 0x04)
            }
            tstore(0x643119965bca0d2c9b966ba98ba1c1e0328dc1a5f0f036b5266e1fcd4e795809, 1)
        }
        _;
        assembly {
            tstore(0x643119965bca0d2c9b966ba98ba1c1e0328dc1a5f0f036b5266e1fcd4e795809, 0)
        }
    }

    /// @dev Sentinel for native CELO across the whole contract (token == address(0)).
    address public constant NATIVE = address(0);

    uint8 public constant SEATS = 4;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_RAKE_BPS = 1_000; // cap the house cut at 10%

    enum Status {
        None, // not yet created
        Open, // waiting for 4 players to join + commit
        Revealing, // table full, waiting for everyone to reveal their secret
        Playing, // seed ready, game running offchain
        Settled, // prizes already credited
        Cancelled // cancelled (timeout) + stakes returned
    }

    struct Game {
        address token; // buy-in currency (address(0) = native CELO)
        uint256 buyIn; // buy-in per player (token's smallest unit)
        address server; // offchain game engine operator (for fallback settle)
        Status status;
        uint8 joined; // number of players who have joined
        uint8 revealedCount; // number of players who have revealed
        uint64 commitDeadline; // deadline for the game to fill up
        uint64 revealWindow; // reveal duration after the table fills
        uint64 settleWindow; // settle duration after the seed is ready
        uint64 revealDeadline; // set when the table fills
        uint64 settleDeadline; // set when the seed is ready
        bytes32 seed; // collective seed produced by the reveals
        uint16[SEATS] payoutBps; // payout weights for ranks 1..4 (sum = 10000)
        address[SEATS] players; // players in join order
        bytes32[SEATS] commitments;
        bytes32[SEATS] secrets;
        bool[SEATS] revealed;
    }

    /// @dev EIP-712 struct that gets signed: the final result of a game.
    ///      rankingHash = keccak256(abi.encodePacked(ranking)) with ranking[0] = 1st place.
    bytes32 private constant RESULT_TYPEHASH = keccak256("GameResult(uint256 gameId,bytes32 rankingHash)");

    uint16 public rakeBps; // current house cut (bps)

    /// @notice Tokens allowed as a buy-in (address(0) = native CELO).
    mapping(address => bool) public tokenAllowed;

    /// @notice Withdrawable balances: token => account => amount.
    mapping(address => mapping(address => uint256)) public credits;

    uint256 public gameCount;
    mapping(uint256 => Game) private games;

    /// @dev Reserved space for future variables to keep upgrades safe against storage layout changes.
    uint256[50] private __gap;

    event RakeUpdated(uint16 rakeBps);
    event TokenAllowed(address indexed token, bool allowed);
    event GameCreated(uint256 indexed gameId, address indexed organizer, address token, uint256 buyIn, address server);
    event PlayerJoined(uint256 indexed gameId, address indexed player, uint8 seat);
    event GameFilled(uint256 indexed gameId, uint64 revealDeadline);
    event SecretRevealed(uint256 indexed gameId, address indexed player);
    event SeedReady(uint256 indexed gameId, bytes32 seed, uint64 settleDeadline);
    event GameSettled(uint256 indexed gameId, address[SEATS] ranking, uint256[SEATS] payouts, bool byServer);
    event GameCancelled(uint256 indexed gameId, Status fromStatus);
    event Credited(address indexed token, address indexed account, uint256 amount);
    event Withdrawn(address indexed token, address indexed account, uint256 amount);

    error InvalidBuyIn();
    error InvalidServer();
    error InvalidPayoutWeights();
    error InvalidWindow();
    error TokenNotAllowed();
    error BadValue();
    error WrongStatus();
    error DeadlinePassed();
    error DeadlineNotReached();
    error TableFull();
    error AlreadyJoined();
    error NotAPlayer();
    error AlreadyRevealed();
    error BadReveal();
    error InvalidRanking();
    error BadSignature();
    error RakeTooHigh();
    error NothingToWithdraw();
    error NativeTransferFailed();
    error ReentrancyGuardReentrantCall();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param initialOwner  Owner/house (rake recipient, allowlist manager, upgrade authority).
    /// @param _rakeBps      Initial house cut (bps, max 1000 = 10%).
    /// @param initialTokens Tokens to allowlist immediately (include address(0) for native CELO).
    function initialize(address initialOwner, uint16 _rakeBps, address[] memory initialTokens) external initializer {
        __EIP712_init("cMahjong", "1");
        __Ownable_init(initialOwner);

        if (_rakeBps > MAX_RAKE_BPS) revert RakeTooHigh();
        rakeBps = _rakeBps;
        for (uint256 i; i < initialTokens.length; ++i) {
            tokenAllowed[initialTokens[i]] = true;
            emit TokenAllowed(initialTokens[i], true);
        }
    }

    /// @dev Only the owner may upgrade the implementation (UUPS requirement).
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setRakeBps(uint16 _rakeBps) external onlyOwner {
        if (_rakeBps > MAX_RAKE_BPS) revert RakeTooHigh();
        rakeBps = _rakeBps;
        emit RakeUpdated(_rakeBps);
    }

    /// @notice Add/remove a token from the allowlist. address(0) = native CELO.
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    /// @param token        Buy-in currency (must be allowlisted; address(0) = native CELO).
    /// @param buyIn        Buy-in per player (token's smallest unit).
    /// @param server       Offchain engine operator (fallback settle).
    /// @param payoutBps    Payout weights for ranks 1..4, must sum to 10000.
    /// @param commitWindow Seconds until the table must be full.
    /// @param revealWindow Seconds for the reveal phase after the table fills.
    /// @param settleWindow Seconds for the cooperative settle phase before the server may fall back.
    function createGame(
        address token,
        uint256 buyIn,
        address server,
        uint16[SEATS] calldata payoutBps,
        uint64 commitWindow,
        uint64 revealWindow,
        uint64 settleWindow
    ) external returns (uint256 gameId) {
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        if (buyIn == 0) revert InvalidBuyIn();
        if (server == address(0)) revert InvalidServer();
        if (commitWindow == 0 || revealWindow == 0 || settleWindow == 0) revert InvalidWindow();

        uint256 sum;
        for (uint256 i; i < SEATS; ++i) {
            sum += payoutBps[i];
        }
        if (sum != BPS_DENOMINATOR) revert InvalidPayoutWeights();

        gameId = ++gameCount;
        Game storage g = games[gameId];
        g.token = token;
        g.buyIn = buyIn;
        g.server = server;
        g.status = Status.Open;
        g.payoutBps = payoutBps;
        g.revealWindow = revealWindow;
        g.settleWindow = settleWindow;
        g.commitDeadline = uint64(block.timestamp) + commitWindow;

        emit GameCreated(gameId, msg.sender, token, buyIn, server);
    }

    /// @notice Join the table: deposit the buy-in + commit a secret.
    ///         ERC20: `approve` first, send msg.value = 0.
    ///         Native: send msg.value = buyIn.
    /// @param commitment keccak256(abi.encodePacked(gameId, msg.sender, secret)).
    function joinGame(uint256 gameId, bytes32 commitment) external payable nonReentrant {
        Game storage g = games[gameId];
        if (g.status != Status.Open) revert WrongStatus();
        if (block.timestamp > g.commitDeadline) revert DeadlinePassed();
        if (g.joined >= SEATS) revert TableFull();
        if (_isPlayer(g, msg.sender)) revert AlreadyJoined();

        uint8 seat = g.joined;
        g.players[seat] = msg.sender;
        g.commitments[seat] = commitment;
        g.joined = seat + 1;

        _pullStake(g.token, g.buyIn);
        emit PlayerJoined(gameId, msg.sender, seat);

        if (g.joined == SEATS) {
            g.status = Status.Revealing;
            g.revealDeadline = uint64(block.timestamp) + g.revealWindow;
            emit GameFilled(gameId, g.revealDeadline);
        }
    }

    /// @notice Open a secret to build the collective seed.
    function revealSeed(uint256 gameId, bytes32 secret) external {
        Game storage g = games[gameId];
        if (g.status != Status.Revealing) revert WrongStatus();
        if (block.timestamp > g.revealDeadline) revert DeadlinePassed();

        uint8 seat = _seatOf(g, msg.sender);
        if (g.revealed[seat]) revert AlreadyRevealed();
        if (keccak256(abi.encodePacked(gameId, msg.sender, secret)) != g.commitments[seat]) {
            revert BadReveal();
        }

        g.revealed[seat] = true;
        g.secrets[seat] = secret;
        g.revealedCount += 1;
        emit SecretRevealed(gameId, msg.sender);

        if (g.revealedCount == SEATS) {
            bytes32 seed = keccak256(abi.encodePacked(g.secrets[0], g.secrets[1], g.secrets[2], g.secrets[3]));
            g.seed = seed;
            g.status = Status.Playing;
            g.settleDeadline = uint64(block.timestamp) + g.settleWindow;
            emit SeedReady(gameId, seed, g.settleDeadline);
        }
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Cooperative settle: all four players sign the same ranking.
    /// @param ranking    ranking[0] = 1st place ... ranking[3] = last place (a permutation of the players).
    /// @param signatures 4 EIP-712 signatures from the four players (any order).
    function settle(uint256 gameId, address[SEATS] calldata ranking, bytes[SEATS] calldata signatures) external {
        Game storage g = games[gameId];
        if (g.status != Status.Playing) revert WrongStatus();
        _requireValidRanking(g, ranking);

        bytes32 digest = _resultDigest(gameId, ranking);

        // Ensure the four signers are four distinct players.
        bool[SEATS] memory seen;
        for (uint256 i; i < SEATS; ++i) {
            address signer = ECDSA.recover(digest, signatures[i]);
            uint8 seat = _seatOf(g, signer); // reverts NotAPlayer if not a player
            if (seen[seat]) revert BadSignature();
            seen[seat] = true;
        }

        _settlePayout(gameId, g, ranking, false);
    }

    /// @notice Fallback after settleDeadline: the server attests the ranking (anti rage-quit).
    function settleByServer(uint256 gameId, address[SEATS] calldata ranking, bytes calldata serverSig) external {
        Game storage g = games[gameId];
        if (g.status != Status.Playing) revert WrongStatus();
        if (block.timestamp <= g.settleDeadline) revert DeadlineNotReached();
        _requireValidRanking(g, ranking);

        bytes32 digest = _resultDigest(gameId, ranking);
        if (ECDSA.recover(digest, serverSig) != g.server) revert BadSignature();

        _settlePayout(gameId, g, ranking, true);
    }

    // ---------------------------------------------------------------------
    // Cancellation / forfeit
    // ---------------------------------------------------------------------

    /// @notice Cancel a table that never filled after commitDeadline; credit the buy-in refund.
    function cancelUnfilled(uint256 gameId) external {
        Game storage g = games[gameId];
        if (g.status != Status.Open) revert WrongStatus();
        if (block.timestamp <= g.commitDeadline) revert DeadlineNotReached();

        g.status = Status.Cancelled;
        uint256 n = g.joined;
        for (uint256 i; i < n; ++i) {
            _credit(g.token, g.players[i], g.buyIn);
        }
        emit GameCancelled(gameId, Status.Open);
    }

    /// @notice After revealDeadline passes without everyone revealing: players who stalled the game
    ///         FORFEIT their stake, split evenly among the players who did reveal. If nobody
    ///         revealed, all buy-ins are returned.
    function cancelUnrevealed(uint256 gameId) external {
        Game storage g = games[gameId];
        if (g.status != Status.Revealing) revert WrongStatus();
        if (block.timestamp <= g.revealDeadline) revert DeadlineNotReached();

        g.status = Status.Cancelled;
        address token = g.token;
        uint256 revealedCount = g.revealedCount;
        uint256 buyIn = g.buyIn;

        if (revealedCount == 0) {
            for (uint256 i; i < SEATS; ++i) {
                _credit(token, g.players[i], buyIn);
            }
        } else {
            uint256 forfeitPool = (SEATS - revealedCount) * buyIn;
            uint256 share = forfeitPool / revealedCount;
            uint256 distributed;
            for (uint256 i; i < SEATS; ++i) {
                if (g.revealed[i]) {
                    _credit(token, g.players[i], buyIn + share);
                    distributed += share;
                }
            }
            // leftover from the split (dust) goes to the house rake
            if (forfeitPool > distributed) _credit(token, owner(), forfeitPool - distributed);
        }
        emit GameCancelled(gameId, Status.Revealing);
    }

    // ---------------------------------------------------------------------
    // Withdraw (pull payment)
    // ---------------------------------------------------------------------

    /// @notice Withdraw the caller's entire `token` balance (address(0) = native CELO).
    function withdraw(address token) external nonReentrant {
        uint256 amount = credits[token][msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credits[token][msg.sender] = 0;
        _send(token, msg.sender, amount);
        emit Withdrawn(token, msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getGame(uint256 gameId) external view returns (Game memory) {
        return games[gameId];
    }

    function getPlayers(uint256 gameId) external view returns (address[SEATS] memory) {
        return games[gameId].players;
    }

    function getSeed(uint256 gameId) external view returns (bytes32) {
        return games[gameId].seed;
    }

    function creditOf(address token, address account) external view returns (uint256) {
        return credits[token][account];
    }

    /// @notice Compute the commitment to send when calling joinGame (helper for frontend/backend).
    function commitmentOf(uint256 gameId, address player, bytes32 secret) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(gameId, player, secret));
    }

    /// @notice EIP-712 digest that players/server must sign to settle.
    function resultDigest(uint256 gameId, address[SEATS] calldata ranking) external view returns (bytes32) {
        return _resultDigest(gameId, ranking);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _settlePayout(uint256 gameId, Game storage g, address[SEATS] calldata ranking, bool byServer) private {
        g.status = Status.Settled; // effects before interactions (credits)

        address token = g.token;
        uint256 pot = g.buyIn * SEATS;
        uint256 rake = (pot * rakeBps) / BPS_DENOMINATOR;
        uint256 distributable = pot - rake;

        uint256[SEATS] memory payouts;
        uint256 paid;
        for (uint256 i; i < SEATS; ++i) {
            uint256 amount = (distributable * g.payoutBps[i]) / BPS_DENOMINATOR;
            payouts[i] = amount;
            paid += amount;
        }
        // rake + rounding dust goes to the house
        uint256 houseCut = rake + (distributable - paid);
        if (houseCut > 0) _credit(token, owner(), houseCut);

        for (uint256 i; i < SEATS; ++i) {
            if (payouts[i] > 0) _credit(token, ranking[i], payouts[i]);
        }
        emit GameSettled(gameId, ranking, payouts, byServer);
    }

    /// @dev Pull the stake in: native via msg.value, ERC20 via transferFrom.
    function _pullStake(address token, uint256 amount) private {
        if (token == NATIVE) {
            if (msg.value != amount) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    function _credit(address token, address to, uint256 amount) private {
        credits[token][to] += amount;
        emit Credited(token, to, amount);
    }

    /// @dev Send out: native via call, ERC20 via safeTransfer.
    function _send(address token, address to, uint256 amount) private {
        if (token == NATIVE) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function _resultDigest(uint256 gameId, address[SEATS] calldata ranking) private view returns (bytes32) {
        bytes32 rankingHash = keccak256(abi.encodePacked(ranking));
        bytes32 structHash = keccak256(abi.encode(RESULT_TYPEHASH, gameId, rankingHash));
        return _hashTypedDataV4(structHash);
    }

    function _requireValidRanking(Game storage g, address[SEATS] calldata ranking) private view {
        // ranking must be an exact permutation of the four players (all players, no duplicates).
        bool[SEATS] memory seen;
        for (uint256 i; i < SEATS; ++i) {
            uint8 seat = _seatOf(g, ranking[i]); // reverts NotAPlayer if not a player
            if (seen[seat]) revert InvalidRanking();
            seen[seat] = true;
        }
    }

    function _isPlayer(Game storage g, address who) private view returns (bool) {
        for (uint256 i; i < g.joined; ++i) {
            if (g.players[i] == who) return true;
        }
        return false;
    }

    function _seatOf(Game storage g, address who) private view returns (uint8) {
        for (uint8 i; i < SEATS; ++i) {
            if (g.players[i] == who) return i;
        }
        revert NotAPlayer();
    }
}
