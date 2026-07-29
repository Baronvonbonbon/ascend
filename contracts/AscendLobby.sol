// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * AscendLobby — an open table. Say you are looking for a game; anyone can offer to join.
 *
 * WHAT THIS DELIBERATELY DOES NOT HOLD. No SDP, no ICE candidates, no IP addresses, nothing about
 * a game in progress. A listing is three fields: who, what they call themselves, and when. Joining
 * does NOT happen here — pressing Play sends a normal sealed invite through AscendInvites, so the
 * WebRTC handshake stays encrypted end-to-end and the two players' network addresses are seen only
 * by each other.
 *
 * What a listing unavoidably reveals is that a given address wants to play, and roughly when.
 * Opening a table is a signed transaction, so that much is inherent; a player who does not want it
 * known simply does not open one, and invites by address instead.
 *
 * Reads are a single bounded `eth_call`, for the same reason as the rest of the contracts here:
 * a player on Pine-RPC has no historical state and cannot reconstruct anything from logs.
 */
contract AscendLobby {
    struct Table {
        address host;
        bytes32 name;   // self-chosen display name, UTF-8, right-padded
        uint40  at;     // opened at
    }

    /** A table goes stale on its own, so a closed tab does not leave a ghost behind. */
    uint40 public constant TTL = 30 minutes;
    /** Bounded so `tables()` is always one cheap call. */
    uint16 public constant MAX = 64;

    Table[MAX] private _tables;
    uint16 public len;

    event Opened(address indexed host, bytes32 name);
    event Closed(address indexed host);

    function _live(Table storage t) private view returns (bool) {
        return t.host != address(0) && block.timestamp <= uint256(t.at) + TTL;
    }

    /** Open (or refresh) your table. One per address — re-opening replaces, never stacks. */
    function open(bytes32 name) external {
        uint16 reuse = type(uint16).max;
        uint16 oldest = 0;

        for (uint16 i = 0; i < len; i++) {
            Table storage t = _tables[i];
            if (t.host == msg.sender) {                       // refresh in place
                t.name = name;
                t.at = uint40(block.timestamp);
                emit Opened(msg.sender, name);
                return;
            }
            if (reuse == type(uint16).max && !_live(t)) reuse = i;   // first expired slot
            if (t.at < _tables[oldest].at) oldest = i;
        }

        uint16 slot;
        if (reuse != type(uint16).max) slot = reuse;
        else if (len < MAX) { slot = len; unchecked { len++; } }
        else slot = oldest;                                   // full and all live — evict the eldest

        _tables[slot] = Table({ host: msg.sender, name: name, at: uint40(block.timestamp) });
        emit Opened(msg.sender, name);
    }

    /** Take your table down. Expiry does this anyway; this is for leaving deliberately. */
    function close() external {
        for (uint16 i = 0; i < len; i++) {
            if (_tables[i].host == msg.sender) {
                delete _tables[i];
                emit Closed(msg.sender);
                return;
            }
        }
    }

    /** Every table still within its TTL, newest first is NOT guaranteed — the client sorts. */
    function tables() external view returns (Table[] memory out) {
        uint16 n;
        for (uint16 i = 0; i < len; i++) if (_live(_tables[i])) n++;
        out = new Table[](n);
        uint16 j;
        for (uint16 i = 0; i < len; i++) if (_live(_tables[i])) out[j++] = _tables[i];
    }

    /** Whether `who` currently has a table up — so the UI can show Open or Close. */
    function isOpen(address who) external view returns (bool) {
        for (uint16 i = 0; i < len; i++) if (_tables[i].host == who) return _live(_tables[i]);
        return false;
    }
}
