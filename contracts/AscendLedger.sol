// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @title  AscendLedger
/// @notice The on-chain Hall of Fame + bones for Ascend. When a run ends (death
///         or ASCENSION) the player signs a `Record` and a relay submits it
///         gaslessly. Anyone can read the runs to render a leaderboard or to
///         drop a fallen hero's "bones" into a future descent.
contract AscendLedger {
    struct Run {
        address player;
        uint16 depth;
        bool won;
        uint64 time;
    }

    Run[] public runs;
    mapping(address => uint256) public recordNonce;

    bytes32 public constant RECORD_TYPEHASH =
        keccak256("Record(address player,uint16 depth,bool won,uint256 nonce,uint256 deadline)");
    bytes32 private immutable _DOMAIN_SEPARATOR;

    event Recorded(address indexed player, uint16 depth, bool won, uint256 index);

    constructor() {
        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AscendLedger"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Record a finished run. The player signs; anyone (the relay) submits.
    function recordBySig(address player, uint16 depth, bool won, uint256 deadline, bytes calldata sig) external {
        require(block.timestamp <= deadline, "expired");
        uint256 nonce = recordNonce[player];
        bytes32 structHash = keccak256(abi.encode(RECORD_TYPEHASH, player, depth, won, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, structHash));
        require(_recover(digest, sig) == player && player != address(0), "bad sig");
        recordNonce[player] = nonce + 1;
        runs.push(Run(player, depth, won, uint64(block.timestamp)));
        emit Recorded(player, depth, won, runs.length - 1);
    }

    function runCount() external view returns (uint256) { return runs.length; }

    /// @notice Read a window of runs [start, start+n) for leaderboards / bones.
    function runsRange(uint256 start, uint256 n) external view returns (Run[] memory out) {
        uint256 len = runs.length;
        if (start >= len) return new Run[](0);
        uint256 end = start + n;
        if (end > len) end = len;
        out = new Run[](end - start);
        for (uint256 i = start; i < end; i++) out[i - start] = runs[i];
    }

    function domainSeparator() external view returns (bytes32) { return _DOMAIN_SEPARATOR; }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "siglen");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
