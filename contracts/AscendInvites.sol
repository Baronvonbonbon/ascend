// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * AscendInvites — a rendezvous point for starting a co-op game.
 *
 * WHY THIS EXISTS. Co-op runs over WebRTC, which needs the two browsers to swap an SDP offer and
 * answer before a peer link can form. Until now players did that by copying two long base64 blobs
 * back and forth by hand. The intent was to use the Polkadot app's contact messaging instead, but
 * that messaging API is not documented for third-party apps — so this contract does the same job
 * with primitives that are documented: address-addressed storage anyone can read.
 *
 * You invite an address; they see it in their inbox and accept. One click each.
 *
 * WHAT GOES ON CHAIN, AND WHAT DOES NOT. Only the WebRTC handshake — a deflate-compressed SDP
 * blob, a few kilobytes, written once and never read again after the link forms. Everything the
 * game actually does (moves, chat, world state) stays on the direct peer link, exactly as before.
 * Nothing here touches gameplay.
 *
 * PRIVACY. SDP is public. It carries your candidate IP addresses, which is already true of the
 * copy/paste flow, but there it was visible only to whoever you handed the code to; here it is
 * visible to anyone reading the chain. That is a real trade-off and the UI says so plainly.
 * Invites expire, and either party can clear one.
 */
contract AscendInvites {
    struct Invite {
        address from;
        uint40  at;
        bytes   offer;   // compressed SDP offer
    }

    /** How long an unanswered invite is worth showing. Handshakes are useless once stale. */
    uint40 public constant TTL = 1 hours;
    /** A refusal to become a storage dump: a compressed SDP is a couple of KB. */
    uint16 public constant MAX_BLOB = 8192;
    /** Bounded so `inbox()` is always one cheap `eth_call`, never an unbounded scan. */
    uint8  public constant MAX_PENDING = 8;

    mapping(address => Invite[]) private _inbox;          // recipient => pending invites
    mapping(bytes32 => bytes)    private _answers;        // key(from,to) => compressed SDP answer

    event Invited(address indexed to, address indexed from);
    event Accepted(address indexed from, address indexed to);

    function _key(address from, address to) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(from, to));
    }

    /** Offer to play. Replaces any previous invite from you, so a retry never stacks up. */
    function invite(address to, bytes calldata offer) external {
        require(to != address(0) && to != msg.sender, "bad recipient");
        require(offer.length > 0 && offer.length <= MAX_BLOB, "bad offer");

        Invite[] storage box = _inbox[to];
        for (uint256 i = 0; i < box.length; i++) {
            if (box[i].from == msg.sender) {                       // supersede your own
                box[i].offer = offer;
                box[i].at = uint40(block.timestamp);
                delete _answers[_key(msg.sender, to)];             // the old answer is meaningless now
                emit Invited(to, msg.sender);
                return;
            }
        }
        if (box.length >= MAX_PENDING) {
            // Evict the oldest — otherwise a stranger could wedge someone's inbox shut.
            uint256 oldest = 0;
            for (uint256 i = 1; i < box.length; i++) if (box[i].at < box[oldest].at) oldest = i;
            box[oldest] = box[box.length - 1];
            box.pop();
        }
        box.push(Invite({ from: msg.sender, at: uint40(block.timestamp), offer: offer }));
        emit Invited(to, msg.sender);
    }

    /** Answer an invite. The inviter polls `answerFor` and the peer link forms directly. */
    function accept(address from, bytes calldata answer) external {
        require(answer.length > 0 && answer.length <= MAX_BLOB, "bad answer");
        _answers[_key(from, msg.sender)] = answer;
        _remove(msg.sender, from);
        emit Accepted(from, msg.sender);
    }

    /** Turn down an invite, or withdraw one you sent. */
    function decline(address from) external { _remove(msg.sender, from); }
    function withdraw(address to) external { _remove(to, msg.sender); delete _answers[_key(msg.sender, to)]; }

    function _remove(address owner, address from) private {
        Invite[] storage box = _inbox[owner];
        for (uint256 i = 0; i < box.length; i++) {
            if (box[i].from == from) { box[i] = box[box.length - 1]; box.pop(); return; }
        }
    }

    /** Pending, unexpired invites for `who`. One call, bounded by MAX_PENDING. */
    function inbox(address who) external view returns (Invite[] memory out) {
        Invite[] storage box = _inbox[who];
        uint256 live;
        for (uint256 i = 0; i < box.length; i++) if (block.timestamp <= box[i].at + TTL) live++;
        out = new Invite[](live);
        uint256 j;
        for (uint256 i = 0; i < box.length; i++) if (block.timestamp <= box[i].at + TTL) out[j++] = box[i];
    }

    /** The answer `to` left for `from`, or empty if they have not accepted yet. */
    function answerFor(address from, address to) external view returns (bytes memory) {
        return _answers[_key(from, to)];
    }
}
