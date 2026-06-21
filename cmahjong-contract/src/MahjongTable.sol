// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title MahjongTable — escrow & settlement multi-token untuk cMahjong (4 pemain) di Celo.
/// @notice Blockchain di sini hanya berperan sebagai *kasir + notaris*:
///         menahan buy-in, meng-anchor fairness (commit–reveal seed), dan mencairkan
///         hadiah berdasarkan ranking akhir yang ditandatangani. Logika permainan
///         (tiles, giliran, validasi move) berjalan OFFCHAIN.
///
/// Mata uang buy-in dipilih per-game dari ALLOWLIST yang dikelola owner:
/// cUSD / USDC / USDT (ERC20, decimals berbeda) atau CELO native (sentinel address(0)).
///
/// Pencairan memakai pola PULL-PAYMENT (kredit + `withdraw`) agar aman dari griefing
/// (satu pemain tak bisa nge-brick settlement) & reentrancy, serta seragam untuk
/// native maupun ERC20.
///
/// Alur 1 game:
///   1. createGame  — organizer pilih token (harus di-allowlist), buy-in, server, bobot payout, deadline.
///   2. joinGame    — 4 pemain setor buy-in (ERC20: approve dulu; native: kirim msg.value) + commitment.
///   3. revealSeed  — tiap pemain buka secret; seed kolektif = hash(semua secret).
///   4. (offchain)  — game dimainkan, server menghitung ranking 1st..4th.
///   5. settle      — keempat pemain menandatangani ranking (EIP-712) → hadiah dikreditkan.
///      settleByServer — fallback setelah deadline: server meng-attest ranking (anti rage-quit).
///   6. withdraw    — pemenang/penerima refund menarik saldonya kapan saja.
contract MahjongTable is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Sentinel untuk CELO native di seluruh kontrak (token == address(0)).
    address public constant NATIVE = address(0);

    uint8 public constant SEATS = 4;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_RAKE_BPS = 1_000; // cap house cut di 10%

    enum Status {
        None,       // belum dibuat
        Open,       // menunggu 4 pemain join + commit
        Revealing,  // sudah penuh, menunggu semua reveal secret
        Playing,    // seed siap, game berjalan offchain
        Settled,    // hadiah sudah dikreditkan
        Cancelled   // dibatalkan (timeout) + stake dikembalikan
    }

    struct Game {
        address token;            // mata uang buy-in (address(0) = CELO native)
        uint256 buyIn;            // buy-in per pemain (satuan terkecil token)
        address server;           // operator game engine offchain (untuk fallback settle)
        Status status;
        uint8 joined;             // jumlah pemain yang sudah join
        uint8 revealedCount;      // jumlah pemain yang sudah reveal
        uint64 commitDeadline;    // batas waktu game terisi penuh
        uint64 revealWindow;      // durasi reveal setelah penuh
        uint64 settleWindow;      // durasi settle setelah seed siap
        uint64 revealDeadline;    // di-set saat penuh
        uint64 settleDeadline;    // di-set saat seed siap
        bytes32 seed;             // seed kolektif hasil reveal
        uint16[SEATS] payoutBps;  // bobot payout untuk rank 1..4 (sum = 10000)
        address[SEATS] players;   // pemain berdasarkan urutan join
        bytes32[SEATS] commitments;
        bytes32[SEATS] secrets;
        bool[SEATS] revealed;
    }

    /// @dev Struct EIP-712 yang ditandatangani: hasil akhir sebuah game.
    ///      rankingHash = keccak256(abi.encodePacked(ranking)) dengan ranking[0]=juara 1.
    bytes32 private constant RESULT_TYPEHASH =
        keccak256("GameResult(uint256 gameId,bytes32 rankingHash)");

    uint16 public rakeBps; // house cut saat ini (bps)

    /// @notice Token yang boleh dipakai sebagai buy-in (address(0) = CELO native).
    mapping(address => bool) public tokenAllowed;

    /// @notice Saldo yang bisa ditarik: token => akun => jumlah.
    mapping(address => mapping(address => uint256)) public credits;

    uint256 public gameCount;
    mapping(uint256 => Game) private games;

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

    /// @param initialOwner  Owner/house (penerima rake, pengelola allowlist).
    /// @param _rakeBps      House cut awal (bps, maks 1000 = 10%).
    /// @param initialTokens Daftar token yang langsung di-allowlist (sertakan address(0) untuk CELO native).
    constructor(address initialOwner, uint16 _rakeBps, address[] memory initialTokens)
        EIP712("cMahjong", "1")
        Ownable(initialOwner)
    {
        if (_rakeBps > MAX_RAKE_BPS) revert RakeTooHigh();
        rakeBps = _rakeBps;
        for (uint256 i; i < initialTokens.length; ++i) {
            tokenAllowed[initialTokens[i]] = true;
            emit TokenAllowed(initialTokens[i], true);
        }
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setRakeBps(uint16 _rakeBps) external onlyOwner {
        if (_rakeBps > MAX_RAKE_BPS) revert RakeTooHigh();
        rakeBps = _rakeBps;
        emit RakeUpdated(_rakeBps);
    }

    /// @notice Tambah/cabut token dari allowlist. address(0) = CELO native.
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    /// @param token        Mata uang buy-in (harus di-allowlist; address(0) = CELO native).
    /// @param buyIn        Buy-in per pemain (satuan terkecil token).
    /// @param server       Operator engine offchain (fallback settle).
    /// @param payoutBps    Bobot payout rank 1..4, harus berjumlah 10000.
    /// @param commitWindow Detik sampai meja harus terisi penuh.
    /// @param revealWindow Detik untuk fase reveal setelah penuh.
    /// @param settleWindow Detik untuk fase settle kooperatif sebelum server boleh fallback.
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
        for (uint256 i; i < SEATS; ++i) sum += payoutBps[i];
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

    /// @notice Join meja: setor buy-in + commit secret.
    ///         ERC20: `approve` dulu, kirim msg.value = 0.
    ///         Native: kirim msg.value = buyIn.
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

    /// @notice Buka secret untuk membentuk seed kolektif.
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
            bytes32 seed =
                keccak256(abi.encodePacked(g.secrets[0], g.secrets[1], g.secrets[2], g.secrets[3]));
            g.seed = seed;
            g.status = Status.Playing;
            g.settleDeadline = uint64(block.timestamp) + g.settleWindow;
            emit SeedReady(gameId, seed, g.settleDeadline);
        }
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Settle kooperatif: keempat pemain menandatangani ranking yang sama.
    /// @param ranking    ranking[0] = juara 1 ... ranking[3] = juru kunci (permutasi para pemain).
    /// @param signatures 4 tanda tangan EIP-712 dari keempat pemain (urutan bebas).
    function settle(uint256 gameId, address[SEATS] calldata ranking, bytes[SEATS] calldata signatures)
        external
    {
        Game storage g = games[gameId];
        if (g.status != Status.Playing) revert WrongStatus();
        _requireValidRanking(g, ranking);

        bytes32 digest = _resultDigest(gameId, ranking);

        // Pastikan keempat penandatangan adalah para pemain yang berbeda.
        bool[SEATS] memory seen;
        for (uint256 i; i < SEATS; ++i) {
            address signer = ECDSA.recover(digest, signatures[i]);
            uint8 seat = _seatOf(g, signer); // revert NotAPlayer bila bukan pemain
            if (seen[seat]) revert BadSignature();
            seen[seat] = true;
        }

        _settlePayout(gameId, g, ranking, false);
    }

    /// @notice Fallback setelah settleDeadline: server meng-attest ranking (anti rage-quit).
    function settleByServer(uint256 gameId, address[SEATS] calldata ranking, bytes calldata serverSig)
        external
    {
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

    /// @notice Batalkan meja yang tak penuh setelah commitDeadline; kreditkan refund buy-in.
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

    /// @notice Setelah revealDeadline lewat tanpa semua reveal: pemain yang menahan game
    ///         FORFEIT stake-nya, dibagi rata ke pemain yang sudah reveal. Bila tak ada
    ///         satu pun yang reveal, kembalikan semua buy-in.
    function cancelUnrevealed(uint256 gameId) external {
        Game storage g = games[gameId];
        if (g.status != Status.Revealing) revert WrongStatus();
        if (block.timestamp <= g.revealDeadline) revert DeadlineNotReached();

        g.status = Status.Cancelled;
        address token = g.token;
        uint256 revealedCount = g.revealedCount;
        uint256 buyIn = g.buyIn;

        if (revealedCount == 0) {
            for (uint256 i; i < SEATS; ++i) _credit(token, g.players[i], buyIn);
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
            // sisa pembagian (dust) masuk ke rake house
            if (forfeitPool > distributed) _credit(token, owner(), forfeitPool - distributed);
        }
        emit GameCancelled(gameId, Status.Revealing);
    }

    // ---------------------------------------------------------------------
    // Withdraw (pull payment)
    // ---------------------------------------------------------------------

    /// @notice Tarik seluruh saldo `token` (address(0) = CELO native) milik pemanggil.
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

    /// @notice Hitung commitment yang harus dikirim saat joinGame (helper untuk frontend/backend).
    function commitmentOf(uint256 gameId, address player, bytes32 secret) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(gameId, player, secret));
    }

    /// @notice Digest EIP-712 yang harus ditandatangani pemain/server untuk settle.
    function resultDigest(uint256 gameId, address[SEATS] calldata ranking) external view returns (bytes32) {
        return _resultDigest(gameId, ranking);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _settlePayout(uint256 gameId, Game storage g, address[SEATS] calldata ranking, bool byServer)
        private
    {
        g.status = Status.Settled; // effects sebelum interactions (kredit)

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
        // rake + dust pembulatan masuk ke house
        uint256 houseCut = rake + (distributable - paid);
        if (houseCut > 0) _credit(token, owner(), houseCut);

        for (uint256 i; i < SEATS; ++i) {
            if (payouts[i] > 0) _credit(token, ranking[i], payouts[i]);
        }
        emit GameSettled(gameId, ranking, payouts, byServer);
    }

    /// @dev Tarik stake masuk: native lewat msg.value, ERC20 lewat transferFrom.
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

    /// @dev Kirim keluar: native lewat call, ERC20 lewat safeTransfer.
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
        // ranking harus permutasi tepat dari keempat pemain (semua pemain, tanpa duplikat).
        bool[SEATS] memory seen;
        for (uint256 i; i < SEATS; ++i) {
            uint8 seat = _seatOf(g, ranking[i]); // revert NotAPlayer bila bukan pemain
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
