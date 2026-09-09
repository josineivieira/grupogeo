import { describe, expect, it } from 'vitest';
import { userDto } from './admin';
const role = '4ca1b1f4-35c2-4acb-9840-0cd8dc635e91';
const valid = { name: 'Usuário teste', email: 'teste@example.com', password: 'SenhaTeste@123', roleIds: [role], companyIds: [], branchIds: [], allCompanies: false };
describe('User creation validation', () => {
  it('accepts valid user data without changing the selected roles', () => {
    expect(userDto.parse(valid).roleIds).toEqual([role]);
  });
  it('explains that environment roles do not replace the required profile', () => {
    const result = userDto.safeParse({ ...valid, roleIds: [], environmentRoles: [{ environmentId: role, roleIds: [role] }] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['roleIds'], message: expect.stringContaining('seção Perfis') })]));
  });
  it('keeps password complexity validation and explains each missing requirement', () => {
    const result = userDto.safeParse({ ...valid, password: '1234567890' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(' ');
      expect(messages).toContain('maiúscula');
      expect(messages).toContain('minúscula');
      expect(messages).toContain('símbolo');
    }
  });
});
