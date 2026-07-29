// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * AscendRuns — the Hall of the Fallen, on chain.
 *
 * Two things live here: an ascension leaderboard, and a rolling record of the recently fallen
 * that other players' dungeons draw graves and bones from.
 *
 * DESIGN CONSTRAINT, and the reason this contract looks the way it does: clients may reach the
 * chain through Pine-RPC, a smoldot light client with NO historical state — `eth_getLogs` only
 * serves a small window collected since that client connected. A leaderboard rebuilt by scanning
 * events would therefore be empty for every new player. So both reads are BOUNDED ARRAYS held in
 * storage and returned by a single `eth_call` at `latest`. Events are emitted too, but purely so
 * a real indexer can be added later — nothing on the read path depends on them.
 *
 * Trust model, stated plainly: runs are self-reported and signed by the player. Anyone can forge
 * a submission; the cost of doing so is gas. `seed` and `runHash` are recorded so a verifier can
 * later replay a run off-chain and mark it honest, without needing a storage migration.
 */
contract AscendRuns {
    struct Run {
        address player;     // msg.sender at submission
        bytes32 name;       // display name, UTF-8, right-padded
        uint64  seed;       // the run's master seed
        bytes32 runHash;    // keccak of the full input log — enables later replay verification
        uint32  turns;
        uint16  depth;      // depth at the end
        uint16  maxDepth;   // deepest reached
        bool    ascended;
        uint40  at;         // block timestamp
        bytes32 bonesCid;   // blake2b-256 of the bones blob on the Bulletin chain (0 = none)
    }

    uint16 public constant BOARD_MAX = 32;   // leaderboard slots, insertion-sorted, best first
    uint16 public constant BONES_MAX = 256;  // ring buffer of the recently fallen

    Run[BOARD_MAX] private _board;
    uint16 public boardLen;

    Run[BONES_MAX] private _bones;
    uint16 public bonesHead;   // next write position
    uint16 public bonesLen;    // saturates at BONES_MAX

    uint64 public totalRuns;
    uint64 public totalAscensions;

    event RunRecorded(
        address indexed player,
        bool indexed ascended,
        uint16 maxDepth,
        uint32 score,
        bytes32 bonesCid
    );

    /** Ascension outranks any depth; depth is the tiebreak. Ties resolve to whoever arrived first. */
    function scoreOf(Run memory r) public pure returns (uint32) {
        return (r.ascended ? 1_000_000 : 0) + uint32(r.maxDepth) * 1_000;
    }

    function submitRun(
        bytes32 name,
        uint64 seed,
        bytes32 runHash,
        uint32 turns,
        uint16 depth,
        uint16 maxDepth,
        bool ascended,
        bytes32 bonesCid
    ) external {
        Run memory r = Run({
            player: msg.sender,
            name: name,
            seed: seed,
            runHash: runHash,
            turns: turns,
            depth: depth,
            maxDepth: maxDepth,
            ascended: ascended,
            at: uint40(block.timestamp),
            bonesCid: bonesCid
        });

        _recordBones(r);
        _considerForBoard(r);

        unchecked { totalRuns++; if (ascended) totalAscensions++; }
        emit RunRecorded(msg.sender, ascended, maxDepth, scoreOf(r), bonesCid);
    }

    /** O(1). Oldest bones are simply overwritten — the pool is meant to be a recent window. */
    function _recordBones(Run memory r) private {
        _bones[bonesHead] = r;
        bonesHead = (bonesHead + 1) % BONES_MAX;
        if (bonesLen < BONES_MAX) { unchecked { bonesLen++; } }
    }

    /**
     * Insertion into a fixed 32-slot board. The early-out means a run that does not place costs
     * one comparison rather than a scan, which is the common case by a wide margin.
     */
    function _considerForBoard(Run memory r) private {
        uint32 s = scoreOf(r);
        uint16 n = boardLen;
        if (n == BOARD_MAX && s <= scoreOf(_board[BOARD_MAX - 1])) return;

        uint16 i = n < BOARD_MAX ? n : BOARD_MAX - 1; // the slot that falls off the end
        while (i > 0 && scoreOf(_board[i - 1]) < s) {
            _board[i] = _board[i - 1];
            unchecked { i--; }
        }
        _board[i] = r;
        if (n < BOARD_MAX) { unchecked { boardLen = n + 1; } }
    }

    /** The whole board, best first. One call, no log scan — safe on a light client. */
    function leaderboard() external view returns (Run[] memory out) {
        out = new Run[](boardLen);
        for (uint16 i = 0; i < boardLen; i++) out[i] = _board[i];
    }

    /** The `count` most recent runs, newest first. Caller bounds the size; we clamp to what exists. */
    function recentBones(uint16 count) external view returns (Run[] memory out) {
        if (count > bonesLen) count = bonesLen;
        out = new Run[](count);
        for (uint16 i = 0; i < count; i++) {
            // walk backwards from the write head, wrapping
            uint16 idx = (bonesHead + BONES_MAX - 1 - i) % BONES_MAX;
            out[i] = _bones[idx];
        }
    }
}
