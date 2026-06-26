// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @title  AscendBank
/// @notice A tiny on-chain purse for Ascend. Players deposit native PAS, then
///         spend it at in-dungeon shops **gaslessly**: the player signs an
///         EIP-712 `Spend` authorization and a relay submits it (paying gas).
///         Spent PAS stays in the contract as shop revenue (owner-withdrawable).
contract AscendBank {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public spendNonce;
    address public owner;

    bytes32 public constant SPEND_TYPEHASH =
        keccak256("Spend(address user,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 private immutable _DOMAIN_SEPARATOR;

    event Deposit(address indexed user, uint256 amount);
    event Spent(address indexed user, uint256 amount, address indexed submitter);

    constructor() {
        owner = msg.sender;
        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AscendBank"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    receive() external payable { _deposit(msg.sender, msg.value); }
    function deposit() external payable { _deposit(msg.sender, msg.value); }
    function depositFor(address user) external payable { _deposit(user, msg.value); }

    function _deposit(address user, uint256 amount) internal {
        require(amount > 0, "zero");
        balanceOf[user] += amount;
        emit Deposit(user, amount);
    }

    /// @notice Gasless spend. The user signs `Spend(user,amount,nonce,deadline)`
    ///         on this contract's EIP-712 domain; anyone (the relay) submits it.
    function spendBySig(address user, uint256 amount, uint256 deadline, bytes calldata sig) external {
        require(block.timestamp <= deadline, "expired");
        require(balanceOf[user] >= amount, "insufficient");
        uint256 nonce = spendNonce[user];
        bytes32 structHash = keccak256(abi.encode(SPEND_TYPEHASH, user, amount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, structHash));
        require(_recover(digest, sig) == user && user != address(0), "bad sig");
        spendNonce[user] = nonce + 1;
        balanceOf[user] -= amount;
        emit Spent(user, amount, msg.sender);
    }

    /// @notice Owner withdraws accumulated shop revenue.
    function ownerWithdraw(uint256 amount, address payable to) external {
        require(msg.sender == owner, "not owner");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "xfer");
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
