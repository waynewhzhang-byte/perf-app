import bcrypt from 'bcryptjs';

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** Imported employees with no stored password use their employee number once as the initial password. */
export async function verifyEmployeePassword(
  employeeNo: string,
  plain: string,
  passwordHash: string,
): Promise<boolean> {
  if (!passwordHash) return plain === employeeNo;
  return verifyPassword(plain, passwordHash);
}
