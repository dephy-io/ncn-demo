import { PublicKey } from "@solana/web3.js";
import { MerkleTree, hash } from "./account-compression";

export type RewardsNode = {
  operator: PublicKey;
  amount: bigint;
}

export function buildRewardsTree(nodes: RewardsNode[]) {
  const tree = new MerkleTree(nodes.map(node => {
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(node.amount, 0);
    return hash(node.operator.toBuffer(), amountBuffer);
  }));
  
  return tree;
}
