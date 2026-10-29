import { describe, it, expect } from 'vitest';
import { passwordProblem } from './password.js';

describe('password policy (T0.16)', () => {
  it('needs 8+ chars with letters and digits, not the username', () => {
    expect(passwordProblem('abc123')).toMatch(/สั้นเกินไป/);
    expect(passwordProblem('abcdefgh')).toMatch(/ทั้งตัวอักษรและตัวเลข/);
    expect(passwordProblem('12345678')).toMatch(/ทั้งตัวอักษรและตัวเลข/);
    expect(passwordProblem('Admin1234', 'admin1234')).toMatch(/ไม่เหมือนรหัสผู้ใช้/);
    expect(passwordProblem('รหัสผ่าน2569')).toBeNull();   // ตัวอักษรไทยนับเป็นตัวอักษร
    expect(passwordProblem('buddy1234')).toBeNull();
  });
});
