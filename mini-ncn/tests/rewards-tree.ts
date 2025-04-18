import { PublicKey } from "@solana/web3.js";
import { MerkleTree, hash } from "./merkle-tree";

export type RewardsNode = {
  user: PublicKey;
  amount: bigint;
}

export function buildRewardsTree(nodes: RewardsNode[]) {
  const tree = new MerkleTree(nodes.map(({user, amount}) => {
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(amount, 0);
    return hash(user.toBuffer(), amountBuffer);
  }));
  
  return tree;
}
