/** Port of src/services/user.ts */
import type { EvmOnEventContext, User } from "envio";

/**
 * `getUser`. The subgraph used the checksummed-ish `address.toHexString()`
 * (lowercase) as id and stored the address. We lowercase to match.
 */
export async function getUser(context: EvmOnEventContext, address: string): Promise<User> {
  const id = address.toLowerCase();
  let user = await context.User.get(id);
  if (!user) {
    user = { id, address: id };
    context.User.set(user);
  }
  return user;
}
