/** What a player may do beyond their own profile, in the order their tags show. */
export const ROLES = ["admin"] as const;
export type Role = (typeof ROLES)[number];
