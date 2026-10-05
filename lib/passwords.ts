// Password rules for staff and students choosing their own password.
const COMMON = new Set([
  '1234567890', '12345678910', '0987654321', '1111111111', '0000000000', '1234512345', '1122334455', '9876543210',
  'password12', 'password123', 'password1234', 'passw0rd123', 'qwertyuiop', 'qwerty1234', 'qwerty12345', '1q2w3e4r5t',
  'iloveyou123', 'welcome123', 'welcome1234', 'letmein123', 'admin12345', 'administrator', 'abcdefghij', 'abc1234567',
  'changeme123', 'stint12345', 'stintacademy', 'stint@1234', 'stint@12345', 'india12345', 'hyderabad123', 'football123',
  'sunshine123', 'princess123', 'monkey12345', 'dragon12345', 'baseball123', 'superman123', 'trustno1234', 'computer123',
]);

/** Returns a plain-language problem with the password, or null when it is fine. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || /^(stint|password|qwerty|welcome)[\W_]*\d*$/i.test(pw)) return 'That password is too common. Pick something harder to guess.';
  return null;
}
