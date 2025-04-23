import { PublicKey } from "@solana/web3.js";
import { MerkleTree, hash } from "./merkle-tree";

export type RewardsNode = {
  user: PublicKey;
  amount: bigint;
}

export function hashNode(node: RewardsNode): Buffer {
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(node.amount, 0);
  return hash(node.user.toBuffer(), amountBuffer);
}

export function buildRewardsTree(nodes: RewardsNode[]) {
  return new MerkleTree(nodes.map(hashNode))
}
