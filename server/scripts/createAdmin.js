/**
 * Creates (or resets) the first admin account.
 *   npm run create-admin
 * Prompts for username / full name / password — nothing is written to a file.
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import { pool, query } from '../src/db.js';

const rl = readline.createInterface({ input: stdin, output: stdout });

async function askHidden(prompt) {
  // Mask keystrokes so the password isn't left on screen or in scrollback.
  const onData = (char) => {
    if (['\n', '\r', ''].includes(char.toString())) return;
    stdout.write('\x1B[2K\x1B[200D' + prompt + '*'.repeat(rl.line.length));
  };
  stdin.on('data', onData);
  const answer = await rl.question(prompt);
  stdin.off('data', onData);
  stdout.write('\n');
  return answer;
}

async function main() {
  console.log('\n--- Create admin account ---\n');

  const username = (await rl.question('Username: ')).trim();
  if (!username) throw new Error('Username is required');

  const fullName = (await rl.question('Full name: ')).trim() || username;

  const password = await askHidden('Password (min 8 chars): ');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const confirm = await askHidden('Confirm password: ');
  if (password !== confirm) throw new Error('Passwords do not match');

  const hash = await bcrypt.hash(password, 12);

  const { rows: existing } = await query(
    'SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL',
    [username]
  );

  if (existing.length) {
    await query(
      `UPDATE users
          SET password_hash = $1, role = 'admin', is_active = TRUE,
              must_change_password = FALSE, full_name = $2
        WHERE id = $3`,
      [hash, fullName, existing[0].id]
    );
    console.log(`\nUpdated existing user "${username}" to admin with a new password.`);
  } else {
    await query(
      `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
       VALUES ($1, $2, $3, 'admin', FALSE)`,
      [username, hash, fullName]
    );
    console.log(`\nAdmin "${username}" created.`);
  }
}

main()
  .catch((err) => {
    console.error('\nFailed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await pool.end();
  });
